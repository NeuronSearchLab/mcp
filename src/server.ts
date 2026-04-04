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

// ─── Platform management schemas ──────────────────────────────────────────────

const CreateContextInput = z.object({
  context_name: z.string().min(1).describe('Display name for the context (e.g. "Twitter Feed", "Homepage").'),
  context_key: z.string().optional().describe('URL-safe key. Auto-derived from name if omitted.'),
  context_type: z.enum(['homepage_feed', 'you_may_also_like', 'item_detail_related', 'search_assist', 'campaign_merchandising']).default('homepage_feed').describe('The type of feed surface.'),
  description: z.string().optional().describe('Optional description of this context.'),
  recommendation_type: z.enum(['item_to_item', 'item_to_user', 'user_to_item', 'user_to_user']).default('user_to_item').describe('The recommendation model type.'),
});

const UpdateContextInput = z.object({
  context_id: z.number().int().describe('The context ID to update.'),
  context_name: z.string().min(1).optional().describe('New display name.'),
  context_type: z.enum(['homepage_feed', 'you_may_also_like', 'item_detail_related', 'search_assist', 'campaign_merchandising']).optional(),
  description: z.string().optional(),
  recommendation_type: z.enum(['item_to_item', 'item_to_user', 'user_to_item', 'user_to_user']).optional(),
});

const DeleteContextInput = z.object({
  context_id: z.number().int().describe('The context ID to delete.'),
});

const CreatePipelineInput = z.object({
  name: z.string().min(1).describe('Pipeline display name.'),
  description: z.string().optional().describe('Optional description.'),
  context_id: z.number().int().optional().describe('Context ID to attach this pipeline to.'),
  is_active: z.boolean().default(true).describe('Whether the pipeline is active.'),
});

const UpdatePipelineInput = z.object({
  pipeline_id: z.number().int().describe('The pipeline ID to update.'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  context_id: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const DeletePipelineInput = z.object({
  pipeline_id: z.number().int().describe('The pipeline ID to delete.'),
});

const ListRulesInput = z.object({
  context_id: z.number().int().optional().describe('Optional context ID to filter rules.'),
});

const CreateRuleInput = z.object({
  context_id: z.number().int().optional().describe('Context ID to scope this rule to.'),
  name: z.string().min(1).describe('Rule display name.'),
  description: z.string().optional().describe('Rule description.'),
  priority: z.number().int().min(0).max(1000).default(100).describe('Priority (higher = evaluated first).'),
  rule_type: z.enum(['boost', 'bury', 'pin', 'filter', 'cap', 'diversity']).describe('The type of ranking rule.'),
  conditions: z.array(z.object({
    field: z.string().min(1).describe('Metadata field to match on.'),
    operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'exists', 'not_exists']),
    value: z.union([z.string(), z.number(), z.array(z.string())]).describe('Value to match.'),
  })).min(1).describe('Conditions that items must match.'),
  actions: z.object({
    type: z.enum(['boost', 'bury', 'pin', 'filter', 'cap', 'diversity']),
    weight: z.number().min(0).max(5).optional().describe('Boost/bury multiplier.'),
    pin_position: z.number().int().min(1).optional().describe('Pin position (1-based).'),
    cap_fraction: z.number().min(0).max(1).optional().describe('Max fraction for cap rules.'),
    diversity_field: z.string().optional().describe('Field for diversity grouping.'),
    diversity_max: z.number().int().min(1).optional().describe('Max items per diversity bucket.'),
  }).describe('Action to apply when conditions match.'),
});

const UpdateRuleInput = z.object({
  rule_id: z.number().int().describe('The rule ID to update.'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'exists', 'not_exists']),
    value: z.union([z.string(), z.number(), z.array(z.string())]),
  })).optional(),
  actions: z.object({
    type: z.enum(['boost', 'bury', 'pin', 'filter', 'cap', 'diversity']),
    weight: z.number().min(0).max(5).optional(),
    pin_position: z.number().int().min(1).optional(),
    cap_fraction: z.number().min(0).max(1).optional(),
    diversity_field: z.string().optional(),
    diversity_max: z.number().int().min(1).optional(),
  }).optional(),
});

const DeleteRuleInput = z.object({
  rule_id: z.number().int().describe('The rule ID to delete.'),
});

const ToggleRuleInput = z.object({
  rule_id: z.number().int().describe('The rule ID to toggle.'),
  is_active: z.boolean().describe('Whether the rule should be active.'),
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

function formatList(label: string, items: any[], formatter: (item: any) => string): string {
  if (!items?.length) return `No ${label} found.`;
  const lines = [`Found ${items.length} ${label}:`, ''];
  for (const item of items) lines.push(`• ${formatter(item)}`);
  return lines.join('\n');
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // ── API tools ───────────────────────────────────────────────────────
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

  // ── Platform management tools ───────────────────────────────────────
  {
    name: 'list_contexts',
    description:
      'List all recommendation contexts (feeds) configured for your team. ' +
      'Contexts define how recommendations are scoped, filtered, and grouped.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_context',
    description:
      'Create a new recommendation context (feed). ' +
      'A context defines a feed surface — e.g. a homepage feed, a "you may also like" section, or a search assist panel. ' +
      'After creating a context, create a pipeline and optionally rules to control ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        context_name: { type: 'string', description: 'Display name (e.g. "Twitter Feed", "Homepage").' },
        context_key: { type: 'string', description: 'URL-safe key. Auto-derived from name if omitted.' },
        context_type: {
          type: 'string',
          enum: ['homepage_feed', 'you_may_also_like', 'item_detail_related', 'search_assist', 'campaign_merchandising'],
          description: 'The type of feed surface. Default: homepage_feed.',
        },
        description: { type: 'string', description: 'Optional description.' },
        recommendation_type: {
          type: 'string',
          enum: ['item_to_item', 'item_to_user', 'user_to_item', 'user_to_user'],
          description: 'Recommendation model type. Default: user_to_item.',
        },
      },
      required: ['context_name'],
    },
  },
  {
    name: 'update_context',
    description: 'Update an existing recommendation context.',
    inputSchema: {
      type: 'object',
      properties: {
        context_id: { type: 'number', description: 'The context ID to update.' },
        context_name: { type: 'string', description: 'New display name.' },
        context_type: {
          type: 'string',
          enum: ['homepage_feed', 'you_may_also_like', 'item_detail_related', 'search_assist', 'campaign_merchandising'],
        },
        description: { type: 'string' },
        recommendation_type: {
          type: 'string',
          enum: ['item_to_item', 'item_to_user', 'user_to_item', 'user_to_user'],
        },
      },
      required: ['context_id'],
    },
  },
  {
    name: 'delete_context',
    description: 'Delete a recommendation context. This also removes associated pipelines and rules.',
    inputSchema: {
      type: 'object',
      properties: {
        context_id: { type: 'number', description: 'The context ID to delete.' },
      },
      required: ['context_id'],
    },
  },
  {
    name: 'list_pipelines',
    description:
      'List all ranking pipelines. ' +
      'Pipelines define the sequence of stages (candidate generation, scoring, rules, post-processing) ' +
      'that transform raw candidates into a ranked feed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_pipeline',
    description:
      'Create a new ranking pipeline with default stages. ' +
      'Optionally attach it to a context. The pipeline starts active by default.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pipeline display name.' },
        description: { type: 'string', description: 'Optional description.' },
        context_id: { type: 'number', description: 'Context ID to attach this pipeline to.' },
        is_active: { type: 'boolean', description: 'Whether the pipeline is active. Default: true.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_pipeline',
    description: 'Update an existing ranking pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'The pipeline ID to update.' },
        name: { type: 'string', description: 'New pipeline name.' },
        description: { type: 'string' },
        context_id: { type: 'number', description: 'New context ID to attach.' },
        is_active: { type: 'boolean' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'delete_pipeline',
    description: 'Delete a ranking pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'The pipeline ID to delete.' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'list_rules',
    description:
      'List ranking rules, optionally filtered by context. ' +
      'Rules modify the ranking output — boost, bury, pin, filter, cap, or diversify items.',
    inputSchema: {
      type: 'object',
      properties: {
        context_id: { type: 'number', description: 'Optional context ID to filter rules.' },
      },
    },
  },
  {
    name: 'create_rule',
    description:
      'Create a new ranking rule. Rule types: ' +
      'boost (increase score), bury (decrease score), pin (fix position), ' +
      'filter (remove items), cap (limit fraction), diversity (spread categories). ' +
      'Each rule has conditions (which items match) and an action (what to do).',
    inputSchema: {
      type: 'object',
      properties: {
        context_id: { type: 'number', description: 'Context ID to scope this rule to.' },
        name: { type: 'string', description: 'Rule display name.' },
        description: { type: 'string', description: 'Rule description.' },
        priority: { type: 'number', description: 'Priority (0–1000, higher = first). Default: 100.' },
        rule_type: {
          type: 'string',
          enum: ['boost', 'bury', 'pin', 'filter', 'cap', 'diversity'],
          description: 'The type of ranking rule.',
        },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Metadata field to match.' },
              operator: {
                type: 'string',
                enum: ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'exists', 'not_exists'],
              },
              value: { description: 'Value to match (string, number, or array of strings).' },
            },
            required: ['field', 'operator', 'value'],
          },
          description: 'Conditions that items must match.',
        },
        actions: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['boost', 'bury', 'pin', 'filter', 'cap', 'diversity'] },
            weight: { type: 'number', description: 'Boost/bury multiplier (0–5).' },
            pin_position: { type: 'number', description: 'Pin position (1-based).' },
            cap_fraction: { type: 'number', description: 'Max fraction (0–1) for cap rules.' },
            diversity_field: { type: 'string', description: 'Field for diversity grouping.' },
            diversity_max: { type: 'number', description: 'Max items per diversity bucket.' },
          },
          required: ['type'],
          description: 'Action to apply when conditions match.',
        },
      },
      required: ['name', 'rule_type', 'conditions', 'actions'],
    },
  },
  {
    name: 'update_rule',
    description: 'Update an existing ranking rule.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The rule ID to update.' },
        name: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'number' },
        is_active: { type: 'boolean' },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string', enum: ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'exists', 'not_exists'] },
              value: {},
            },
            required: ['field', 'operator', 'value'],
          },
        },
        actions: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['boost', 'bury', 'pin', 'filter', 'cap', 'diversity'] },
            weight: { type: 'number' },
            pin_position: { type: 'number' },
            cap_fraction: { type: 'number' },
            diversity_field: { type: 'string' },
            diversity_max: { type: 'number' },
          },
          required: ['type'],
        },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'delete_rule',
    description: 'Delete a ranking rule.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The rule ID to delete.' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'toggle_rule',
    description: 'Enable or disable a ranking rule without deleting it.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The rule ID to toggle.' },
        is_active: { type: 'boolean', description: 'Whether the rule should be active.' },
      },
      required: ['rule_id', 'is_active'],
    },
  },
];

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer(client: NeuronClient): Server {
  const server = new Server(
    { name: 'neuronsearchlab', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    try {
      switch (name) {
        // ── API tools ─────────────────────────────────────────────────
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

        // ── Context management ────────────────────────────────────────
        case 'list_contexts': {
          const res = await client.get<any[]>('/contexts');
          const text = formatList('context(s)', res, (c) =>
            `[id: ${c.id}] ${c.context_name ?? c.name} (type: ${c.context_type ?? 'n/a'}, key: ${c.context_key ?? 'n/a'})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_context': {
          const input = CreateContextInput.parse(args);
          const res = await client.post('/contexts', {
            context_name: input.context_name,
            context_key: input.context_key,
            context_type: input.context_type,
            description: input.description,
            recommendation_type: input.recommendation_type,
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Context created.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'update_context': {
          const input = UpdateContextInput.parse(args);
          const { context_id, ...body } = input;
          const res = await client.patch(`/contexts/${context_id}`, body);
          return {
            content: [{
              type: 'text',
              text: `✅ Context ${context_id} updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_context': {
          const input = DeleteContextInput.parse(args);
          await client.delete(`/contexts/${input.context_id}`);
          return {
            content: [{ type: 'text', text: `✅ Context ${input.context_id} deleted.` }],
          };
        }

        // ── Pipeline management ───────────────────────────────────────
        case 'list_pipelines': {
          const res = await client.get<any[]>('/pipelines');
          const text = formatList('pipeline(s)', res, (p) =>
            `[id: ${p.id}] ${p.name} (context: ${p.context_id ?? 'none'}, active: ${p.is_active})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_pipeline': {
          const input = CreatePipelineInput.parse(args);
          const res = await client.post('/pipelines', {
            name: input.name,
            description: input.description,
            context_id: input.context_id,
            is_active: input.is_active,
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Pipeline created.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'update_pipeline': {
          const input = UpdatePipelineInput.parse(args);
          const { pipeline_id, ...body } = input;
          const res = await client.patch(`/pipelines/${pipeline_id}`, body);
          return {
            content: [{
              type: 'text',
              text: `✅ Pipeline ${pipeline_id} updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_pipeline': {
          const input = DeletePipelineInput.parse(args);
          await client.delete(`/pipelines/${input.pipeline_id}`);
          return {
            content: [{ type: 'text', text: `✅ Pipeline ${input.pipeline_id} deleted.` }],
          };
        }

        // ── Rule management ───────────────────────────────────────────
        case 'list_rules': {
          const input = ListRulesInput.parse(args);
          const query: Record<string, string | number | boolean | undefined> = {};
          if (input.context_id !== undefined) query.context_id = input.context_id;
          const res = await client.get<any[]>('/rules', query);
          const text = formatList('rule(s)', res, (r) =>
            `[id: ${r.id}] ${r.name} (type: ${r.rule_type}, active: ${r.is_active}, context: ${r.context_id ?? 'all'})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_rule': {
          const input = CreateRuleInput.parse(args);
          const res = await client.post('/rules', {
            context_id: input.context_id,
            name: input.name,
            description: input.description,
            priority: input.priority,
            rule_type: input.rule_type,
            conditions: input.conditions,
            actions: input.actions,
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Rule created.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'update_rule': {
          const input = UpdateRuleInput.parse(args);
          const { rule_id, ...body } = input;
          const res = await client.patch(`/rules/${rule_id}`, body);
          return {
            content: [{
              type: 'text',
              text: `✅ Rule ${rule_id} updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_rule': {
          const input = DeleteRuleInput.parse(args);
          await client.delete(`/rules/${input.rule_id}`);
          return {
            content: [{ type: 'text', text: `✅ Rule ${input.rule_id} deleted.` }],
          };
        }

        case 'toggle_rule': {
          const input = ToggleRuleInput.parse(args);
          const res = await client.patch(`/rules/${input.rule_id}`, { is_active: input.is_active });
          return {
            content: [{
              type: 'text',
              text: `✅ Rule ${input.rule_id} is now ${input.is_active ? 'active' : 'inactive'}.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
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
