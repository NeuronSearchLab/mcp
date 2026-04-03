import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { NeuronClient } from './client.js';

// ─── Input schemas ────────────────────────────────────────────────────────────

const GetRecommendationsInput = z.object({
  user_id: z.string().describe('User identifier (UUID, email, or numeric string).'),
  context_id: z.string().optional().describe('Context ID from the NeuronSearchLab console (controls filters, grouping, and quantity defaults).'),
  limit: z.number().int().min(1).max(200).optional().describe('Number of recommendations to return. Defaults to the context default (usually 20).'),
  surface: z.string().optional().describe('Rerank surface override (e.g. "homepage", "sidebar").'),
});

const GetAutoRecommendationsInput = z.object({
  user_id: z.string().describe('User identifier.'),
  context_id: z.string().optional().describe('Context ID for additional filters.'),
  limit: z.number().int().min(1).max(200).optional().describe('Items per auto-generated section. Defaults to context value.'),
  cursor: z.string().optional().describe('Pagination cursor from a previous auto-recommendations response.'),
  window_days: z.number().int().min(1).optional().describe('Sliding window for "new" content in days.'),
});

const TrackEventInput = z.object({
  event_id: z.number().int().describe('Numeric event type ID, as configured in the admin console (Events page).'),
  user_id: z.string().describe('User who triggered the event.'),
  item_id: z.string().describe('Item that was interacted with.'),
  request_id: z.string().optional().describe('request_id from the recommendations response that led to this event — enables attribution.'),
  session_id: z.string().optional().describe('Session identifier for grouping events within a visit.'),
});

const UpsertItemInput = z.object({
  item_id: z.string().describe('Unique item identifier (UUID or alphanumeric string).'),
  name: z.string().describe('Item title or display name.'),
  description: z.string().describe('Longer text used to generate the embedding — include keywords, category, and key attributes.'),
  metadata: z.record(z.unknown()).optional().describe('Arbitrary key-value pairs (category, price, tags, etc.) returned alongside recommendations.'),
});

const PatchItemInput = z.object({
  item_id: z.string().describe('Item to update.'),
  active: z.boolean().optional().describe('Set to false to exclude the item from future recommendations without deleting it.'),
}).passthrough();

const DeleteItemsInput = z.object({
  item_ids: z.array(z.string()).min(1).max(100).describe('One or more item IDs to permanently remove from the catalogue.'),
});

const SearchItemsInput = z.object({
  query: z.string().describe('Text to search for across item names, descriptions, and metadata.'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum results to return. Default 20.'),
});

const ExplainRankingInput = z.object({
  item_id: z.string().describe('Item whose ranking you want to understand.'),
  user_id: z.string().optional().describe('User to score against. Omit for a neutral baseline score.'),
  context_id: z.string().optional().describe('Context ID to apply scoring rules from.'),
});

// ─── Response formatters ──────────────────────────────────────────────────────

function formatRecommendations(res: any): string {
  if (!res?.recommendations?.length) {
    return 'No recommendations returned. This can happen if the user has no embedding yet or if all items have been excluded.';
  }

  const lines: string[] = [
    `✅ ${res.recommendations.length} recommendation(s) for user:`,
    `   request_id: ${res.request_id ?? 'n/a'} (pass to track_event for attribution)`,
    `   processing_time: ${res.processing_time_ms ?? '?'}ms`,
    '',
  ];

  for (const [i, rec] of res.recommendations.entries()) {
    lines.push(`${i + 1}. [${rec.entity_id}] ${rec.name} (score: ${rec.score?.toFixed(4)})`);
    if (rec.description) {
      lines.push(`   ${rec.description.substring(0, 120)}${rec.description.length > 120 ? '...' : ''}`);
    }
    if (rec.metadata && Object.keys(rec.metadata).length > 0) {
      const meta = Object.entries(rec.metadata)
        .slice(0, 4)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      lines.push(`   metadata: { ${meta}${Object.keys(rec.metadata).length > 4 ? ', ...' : ''} }`);
    }
  }

  if (res.section) {
    lines.push('', `📦 Section: "${res.section.title}" (id: ${res.section.section_id})`);
  }
  if (res.next_cursor) {
    lines.push('', `📄 More available — pass cursor: "${res.next_cursor}" to get_auto_recommendations`);
  }
  if (res.done) {
    lines.push('', '✅ All sections returned (done: true)');
  }

  return lines.join('\n');
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'get_recommendations',
    description:
      'Fetch personalised recommendations for a user. Returns ranked items with scores. ' +
      'The response includes a request_id — pass it to track_event to enable click-through attribution.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User identifier (UUID, email, or numeric string).' },
        context_id: { type: 'string', description: 'Context ID from the NeuronSearchLab console.' },
        limit: { type: 'number', description: 'Number of items to return (1–200).' },
        surface: { type: 'string', description: 'Rerank surface override (e.g. "homepage").' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_auto_recommendations',
    description:
      'Fetch the next auto-generated recommendation section for a user. ' +
      'Useful for infinite-scroll feeds — each call returns one curated section (e.g. "Trending", "New for you") ' +
      'plus a cursor for the next section. Keep calling until done=true.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User identifier.' },
        context_id: { type: 'string', description: 'Optional context ID.' },
        limit: { type: 'number', description: 'Items per section (1–200).' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
        window_days: { type: 'number', description: 'Days to look back for new content.' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'track_event',
    description:
      'Record a user interaction event (click, view, purchase, etc.). ' +
      'Always pass the request_id from the recommendations call to enable attribution. ' +
      'Event IDs are configured in the NeuronSearchLab admin console under Events.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'number', description: 'Numeric event type ID from the admin console.' },
        user_id: { type: 'string', description: 'User who triggered the event.' },
        item_id: { type: 'string', description: 'Item that was interacted with.' },
        request_id: { type: 'string', description: 'request_id from the recommendations response (for attribution).' },
        session_id: { type: 'string', description: 'Session identifier.' },
      },
      required: ['event_id', 'user_id', 'item_id'],
    },
  },
  {
    name: 'upsert_item',
    description:
      'Add or update an item in the recommendation catalogue. ' +
      'The description field is used to generate the embedding — write it to be rich and descriptive. ' +
      'Use metadata for structured attributes (category, price, tags) that are returned with recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'Unique item identifier.' },
        name: { type: 'string', description: 'Item display name.' },
        description: { type: 'string', description: 'Rich description for embedding generation.' },
        metadata: {
          type: 'object',
          description: 'Arbitrary key-value metadata (category, price, tags, etc.)',
          additionalProperties: true,
        },
      },
      required: ['item_id', 'name', 'description'],
    },
  },
  {
    name: 'patch_item',
    description:
      'Partially update an existing item. ' +
      'Most commonly used to enable (active: true) or disable (active: false) an item ' +
      'without re-uploading the full catalogue entry.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'Item to update.' },
        active: { type: 'boolean', description: 'Set false to exclude from recommendations without deleting.' },
      },
      required: ['item_id'],
      additionalProperties: true,
    },
  },
  {
    name: 'delete_items',
    description:
      'Permanently remove one or more items from the recommendation catalogue. ' +
      'This cannot be undone. To temporarily exclude items, use patch_item with active: false instead.',
    inputSchema: {
      type: 'object',
      properties: {
        item_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of item IDs to delete (max 100 per call).',
        },
      },
      required: ['item_ids'],
    },
  },
  {
    name: 'search_items',
    description:
      'Search the recommendation catalogue by keyword. ' +
      'Returns matching items with their IDs, names, descriptions, and status. ' +
      'Useful for looking up specific items before updating or removing them.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for.' },
        limit: { type: 'number', description: 'Max results to return (default 20).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'explain_ranking',
    description:
      'Explain why a specific item was (or would be) ranked at a particular position for a user. ' +
      'Returns a score breakdown showing embedding similarity and applied rules, ' +
      'plus a pipeline trace showing which stages passed or failed.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'Item to explain.' },
        user_id: { type: 'string', description: 'User to score against. Omit for a neutral baseline.' },
        context_id: { type: 'string', description: 'Context ID to apply scoring rules from.' },
      },
      required: ['item_id'],
    },
  },
];

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer(client: NeuronClient): Server {
  const server = new Server(
    { name: 'neuronsearchlab', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    try {
      switch (name) {
        case 'get_recommendations': {
          const input = GetRecommendationsInput.parse(args);
          const res = await client.get('/recommendations', {
            user_id: input.user_id,
            context_id: input.context_id,
            quantity: input.limit,
            surface: input.surface,
          });
          return { content: [{ type: 'text', text: formatRecommendations(res) }] };
        }

        case 'get_auto_recommendations': {
          const input = GetAutoRecommendationsInput.parse(args);
          const res = await client.get('/recommendations', {
            mode: 'auto',
            user_id: input.user_id,
            context_id: input.context_id,
            quantity: input.limit,
            cursor: input.cursor,
            window_days: input.window_days,
          });
          return { content: [{ type: 'text', text: formatRecommendations(res) }] };
        }

        case 'track_event': {
          const input = TrackEventInput.parse(args);
          const res = await client.post('/events', {
            eventId: input.event_id,
            userId: input.user_id,
            itemId: input.item_id,
            ...(input.request_id && { request_id: input.request_id }),
            ...(input.session_id && { session_id: input.session_id }),
            client_ts: new Date().toISOString(),
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Event tracked successfully.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'upsert_item': {
          const input = UpsertItemInput.parse(args);
          const res = await client.post('/items', {
            itemId: input.item_id,
            name: input.name,
            description: input.description,
            metadata: input.metadata ?? {},
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Item upserted.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'patch_item': {
          const { item_id, ...rest } = PatchItemInput.parse(args);
          if (Object.keys(rest).length === 0) {
            return {
              content: [{ type: 'text', text: '⚠️ No fields provided to update. Specify at least one field (e.g. active: false).' }],
              isError: true,
            };
          }
          const res = await client.patch(`/items/${encodeURIComponent(item_id)}`, rest);
          return {
            content: [{
              type: 'text',
              text: `✅ Item updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_items': {
          const input = DeleteItemsInput.parse(args);
          const body = input.item_ids.length === 1
            ? { itemId: input.item_ids[0] }
            : input.item_ids.map(id => ({ itemId: id }));
          const res = await client.delete('/items', body);
          return {
            content: [{
              type: 'text',
              text: `✅ Deleted ${(res as any)?.deletedCount ?? input.item_ids.length} item(s).\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'search_items': {
          const input = SearchItemsInput.parse(args);
          const res = await client.get('/items/search', {
            q: input.query,
            limit: input.limit ?? 20,
          }) as any;

          if (!res?.items?.length) {
            return { content: [{ type: 'text', text: `No items found matching "${input.query}".` }] };
          }

          const lines = [
            `Found ${res.total ?? res.items.length} item(s) matching "${input.query}":`,
            '',
          ];
          for (const item of res.items) {
            lines.push(`• [${item.entity_id ?? item.itemId ?? item.id}] ${item.name}`);
            if (item.description) {
              lines.push(`  ${item.description.substring(0, 100)}${item.description.length > 100 ? '...' : ''}`);
            }
            lines.push(`  status: ${item.active === false ? 'inactive' : 'active'}`);
          }
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        case 'explain_ranking': {
          const input = ExplainRankingInput.parse(args);
          const res = await client.post('/explain', {
            itemId: input.item_id,
            userId: input.user_id,
            contextId: input.context_id,
          }) as any;

          if (res?.error) {
            return {
              content: [{ type: 'text', text: `❌ Error: ${res.error}` }],
              isError: true,
            };
          }

          const lines: string[] = [
            `📊 Ranking explanation for item: ${input.item_id}`,
            `   User: ${input.user_id ?? 'neutral baseline'}`,
            '',
            `Final score: ${res.finalScore ?? res.score ?? 'n/a'}`,
            '',
            '─── Score breakdown ───',
          ];

          if (res.breakdown) {
            for (const [component, value] of Object.entries(res.breakdown)) {
              lines.push(`  ${component}: ${value}`);
            }
          }

          if (res.appliedRules?.length) {
            lines.push('', '─── Applied rules ───');
            for (const rule of res.appliedRules) {
              const matched = rule.matched ? '✅ matched' : '⬜ no match';
              lines.push(`  ${rule.name} (${rule.type}) — ${matched}`);
            }
          }

          if (res.pipelineTrace?.length) {
            lines.push('', '─── Pipeline trace ───');
            for (const stage of res.pipelineTrace) {
              const icon = stage.status === 'passed' ? '✅' : stage.status === 'partial' ? '⚠️' : '❌';
              lines.push(`  ${icon} ${stage.stage}: ${stage.status}`);
              if (stage.note) lines.push(`     ${stage.note}`);
            }
          }

          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err: any) {
      const isValidationError = err?.name === 'ZodError';
      const message = isValidationError
        ? `Invalid input: ${err.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        : err.message ?? String(err);

      return {
        content: [{ type: 'text', text: `❌ ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
