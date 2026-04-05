import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { NeuronClient } from './client.js';

export type ServerMode = 'public' | 'internal';

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

// ─── Additional pipeline / rule / context schemas ─────────────────────────────

const GetContextInput = z.object({
  context_id: z.number().int().describe('The context ID to retrieve.'),
});

const GetPipelineInput = z.object({
  pipeline_id: z.number().int().describe('The pipeline ID to retrieve.'),
});

const ActivatePipelineInput = z.object({
  pipeline_id: z.number().int().describe('The pipeline ID to activate.'),
});

const DeactivatePipelineInput = z.object({
  pipeline_id: z.number().int().describe('The pipeline ID to deactivate.'),
});

const ClonePipelineInput = z.object({
  pipeline_id: z.number().int().describe('The pipeline ID to clone.'),
  name: z.string().min(1).describe('Name for the cloned pipeline.'),
});

const GetRuleInput = z.object({
  rule_id: z.number().int().describe('The rule ID to retrieve.'),
});

const EnableRuleInput = z.object({
  rule_id: z.number().int().describe('The rule ID to enable.'),
});

const DisableRuleInput = z.object({
  rule_id: z.number().int().describe('The rule ID to disable.'),
});

const ReorderRulesInput = z.object({
  rule_ids: z.array(z.number().int()).min(1).describe('Rule IDs in the desired priority order (first = highest priority).'),
  context_id: z.number().int().optional().describe('Optional context ID to scope the reorder.'),
});

// ─── Segment schemas ──────────────────────────────────────────────────────────

const GetSegmentInput = z.object({
  segment_id: z.number().int().describe('The segment ID to retrieve.'),
});

const CreateSegmentInput = z.object({
  name: z.string().min(1).describe('Segment display name.'),
  description: z.string().optional().describe('Segment description.'),
  conditions: z.array(z.object({
    field: z.string().min(1).describe('User attribute or behavioural field to match.'),
    operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'in', 'not_in', 'exists']),
    value: z.union([z.string(), z.number(), z.array(z.string())]).describe('Value to match.'),
    type: z.enum(['behavioral', 'demographic', 'computed', 'item_interaction']).default('behavioral').describe('Condition category.'),
  })).min(1).describe('Conditions that define segment membership.'),
  is_active: z.boolean().default(true).describe('Whether the segment is active.'),
});

const UpdateSegmentInput = z.object({
  segment_id: z.number().int().describe('The segment ID to update.'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'in', 'not_in', 'exists']),
    value: z.union([z.string(), z.number(), z.array(z.string())]),
    type: z.enum(['behavioral', 'demographic', 'computed', 'item_interaction']).default('behavioral'),
  })).optional(),
});

const DeleteSegmentInput = z.object({
  segment_id: z.number().int().describe('The segment ID to delete.'),
});

const GetSegmentStatsInput = z.object({
  segment_id: z.number().int().describe('The segment ID to get stats for.'),
});

// ─── Experiment (A/B test) schemas ────────────────────────────────────────────

const GetExperimentInput = z.object({
  experiment_id: z.number().int().describe('The experiment ID to retrieve.'),
});

const CreateExperimentInput = z.object({
  name: z.string().min(1).describe('Experiment name.'),
  description: z.string().optional().describe('Experiment description.'),
  variants: z.array(z.object({
    id: z.string().describe('Variant identifier (e.g. "control", "treatment").'),
    name: z.string().describe('Variant display name.'),
    description: z.string().optional(),
    traffic_fraction: z.number().min(0).max(1).describe('Traffic fraction 0–1. All variants must sum to 1.0.'),
    pipeline_id: z.number().int().optional().describe('Pipeline ID assigned to this variant.'),
  })).min(2).describe('At least 2 variants required.'),
});

const UpdateExperimentInput = z.object({
  experiment_id: z.number().int().describe('The experiment ID to update.'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  variants: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    traffic_fraction: z.number().min(0).max(1),
    pipeline_id: z.number().int().optional(),
  })).optional(),
});

const StartExperimentInput = z.object({
  experiment_id: z.number().int().describe('The experiment ID to start.'),
});

const StopExperimentInput = z.object({
  experiment_id: z.number().int().describe('The experiment ID to stop/complete.'),
});

const GetExperimentResultsInput = z.object({
  experiment_id: z.number().int().describe('The experiment ID to get statistical results for.'),
});

// ─── Campaign schemas ─────────────────────────────────────────────────────────

const GetCampaignInput = z.object({
  campaign_id: z.number().int().describe('The campaign ID to retrieve.'),
});

const CreateCampaignInput = z.object({
  name: z.string().min(1).describe('Campaign display name.'),
  description: z.string().optional().describe('Campaign description.'),
  pipeline_id: z.number().int().optional().describe('Pipeline to apply this campaign to.'),
  start_date: z.string().describe('Start datetime in ISO 8601 format (e.g. "2025-06-01T09:00:00Z").'),
  end_date: z.string().describe('End datetime in ISO 8601 format.'),
  rules: z.array(z.object({
    rule_type: z.enum(['boost', 'bury', 'pin', 'filter', 'cap', 'diversity']),
    conditions: z.array(z.object({
      field: z.string(),
      operator: z.string(),
      value: z.union([z.string(), z.number(), z.array(z.string())]),
    })),
    actions: z.object({
      type: z.string(),
      weight: z.number().optional(),
      pin_position: z.number().int().optional(),
      cap_fraction: z.number().optional(),
    }),
  })).optional().describe('Ranking rules to inject during this campaign window.'),
});

const UpdateCampaignInput = z.object({
  campaign_id: z.number().int().describe('The campaign ID to update.'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  is_active: z.boolean().optional(),
});

const DeleteCampaignInput = z.object({
  campaign_id: z.number().int().describe('The campaign ID to delete.'),
});

const ActivateCampaignInput = z.object({
  campaign_id: z.number().int().describe('The campaign ID to activate.'),
});

const PauseCampaignInput = z.object({
  campaign_id: z.number().int().describe('The campaign ID to pause.'),
});

// ─── Training job schemas ─────────────────────────────────────────────────────

const GetTrainingJobInput = z.object({
  job_id: z.string().describe('Training job ID or execution ARN.'),
});

const CreateTrainingJobInput = z.object({
  model_type: z.string().optional().describe('Model type to train (e.g. "nsl-embed-v2"). Defaults to the team default.'),
  config: z.record(z.unknown()).optional().describe('Training configuration overrides.'),
});

const CancelTrainingJobInput = z.object({
  job_id: z.string().describe('Training job ID or execution ARN to cancel.'),
});

// ─── Analytics schemas ────────────────────────────────────────────────────────

const GetRankingMetricsInput = z.object({
  pipeline_id: z.number().int().optional().describe('Filter metrics to a specific pipeline.'),
  context_id: z.number().int().optional().describe('Filter metrics to a specific context.'),
  window: z.enum(['1d', '7d', '30d']).default('7d').describe('Time window for aggregation.'),
});

const GetExperimentMetricsInput = z.object({
  experiment_id: z.number().int().describe('The experiment ID to get live metrics for.'),
});

const GetSegmentMetricsInput = z.object({
  segment_id: z.number().int().describe('The segment ID to get performance metrics for.'),
  window: z.enum(['1d', '7d', '30d']).default('7d').describe('Time window.'),
});

const GetUserAnalyticsInput = z.object({
  user_id: z.string().min(1).describe('The user ID or email to inspect.'),
  context_id: z.string().optional().describe('Optional context ID to scope the analytics.'),
  window: z.enum(['1d', '7d', '30d', '90d']).default('7d').describe('Time window.'),
});

const GetItemAnalyticsInput = z.object({
  item_id: z.string().min(1).describe('The item ID to inspect.'),
  context_id: z.string().optional().describe('Optional context ID to scope the analytics.'),
  window: z.enum(['1d', '7d', '30d', '90d']).default('7d').describe('Time window.'),
});

const CompareItemsInput = z.object({
  item_a_id: z.string().min(1).describe('The first item ID to compare.'),
  item_b_id: z.string().min(1).describe('The second item ID to compare.'),
  context_id: z.string().optional().describe('Optional context ID to scope the analytics.'),
  window: z.enum(['1d', '7d', '30d', '90d']).default('7d').describe('Time window.'),
});

const TopItemsInput = z.object({
  metric: z.enum(['served', 'events']).default('served').describe('Whether to rank by served count or event count.'),
  event_name: z.string().optional().describe('Optional event-name filter when metric=events, for example "watch" or "click".'),
  event_id: z.number().int().optional().describe('Optional numeric event ID filter when metric=events.'),
  context_id: z.string().optional().describe('Optional context ID to scope the analytics.'),
  window: z.enum(['1d', '7d', '30d', '90d']).default('7d').describe('Time window.'),
  limit: z.number().int().min(1).max(50).default(10).describe('Maximum items to return.'),
});

// ─── API key / integration schemas ───────────────────────────────────────────

const CreateApiKeyInput = z.object({
  name: z.string().min(1).describe('API key display name.'),
  environment: z.enum(['production', 'staging', 'development']).default('production').describe('Environment for this key.'),
  scopes: z.array(z.enum(['recommendations', 'events', 'items', 'admin'])).default(['recommendations']).describe('Permissions granted to this key.'),
});

const RevokeApiKeyInput = z.object({
  key_id: z.number().int().describe('The API key ID to revoke.'),
});

// ─── Internal platform API fallback schemas ──────────────────────────────────

const ListPlatformRoutesInput = z.object({
  section: z.enum([
    'ranking',
    'analytics',
    'catalogue',
    'events',
    'models',
    'training',
    'security',
    'team',
    'billing',
  ]).optional().describe('Optional area to focus the route list on.'),
});

const CallPlatformApiInput = z.object({
  path: z.string().min(1).describe('Admin-console API path starting with /api/.'),
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).default('GET').describe('HTTP method to use.'),
  query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Optional query string parameters.'),
  body: z.record(z.unknown()).optional().describe('Optional JSON body for POST/PATCH/PUT/DELETE requests.'),
});

// ─── Response formatters ──────────────────────────────────────────────────────

const SAFE_PLATFORM_API_PREFIXES = [
  '/api/analytics',
  '/api/api-keys',
  '/api/billing',
  '/api/catalogue-ingest',
  '/api/context',
  '/api/events',
  '/api/experiments',
  '/api/explain',
  '/api/integrations',
  '/api/items',
  '/api/models',
  '/api/pipelines',
  '/api/recommendations',
  '/api/rerank-controls',
  '/api/rules',
  '/api/search',
  '/api/security',
  '/api/segments',
  '/api/team',
  '/api/training',
  '/api/training-jobs',
  '/api/users',
  '/api/dashboard',
] as const;

const PLATFORM_ROUTE_GUIDE: Record<string, string[]> = {
  ranking: [
    'GET /api/context -> list recommendation contexts',
    'POST /api/context/create -> create a context',
    'PATCH /api/context/:id -> update a context',
    'GET /api/pipelines -> list pipelines',
    'POST /api/pipelines -> create a pipeline',
    'GET/PATCH/DELETE /api/pipelines/:id -> inspect, update, or delete a pipeline',
    'GET /api/rules -> list rules',
    'POST /api/rules -> create a rule',
    'GET/PATCH/DELETE /api/rules/:id -> inspect, update, or delete a rule',
    'GET/PUT /api/rerank-controls[?contextId=123] -> inspect or save rerank controls',
    'GET /api/explain?item_id=...&user_id=...&context_id=... -> explain ranking for an item',
  ],
  analytics: [
    'GET /api/analytics?preset=7d&context=123 -> aggregate analytics totals',
    'GET /api/analytics/items/:itemId?window=7d -> item analytics',
    'GET /api/analytics/users/:userId?window=7d -> user analytics',
    'GET /api/analytics/items/compare?item_a=...&item_b=... -> item-vs-item comparison',
    'GET /api/analytics/top-items?metric=events&event_name=watch -> top items',
    'GET /api/dashboard?period=7d -> dashboard summary cards and top items',
  ],
  catalogue: [
    'GET /api/items/search?q=... -> search catalogue items',
    'GET /api/items/:itemId -> inspect an item',
    'GET /api/users/:userId -> inspect a user',
    'GET /api/catalogue-ingest -> list ingest configs',
    'POST /api/catalogue-ingest -> create an ingest config',
    'PATCH/DELETE /api/catalogue-ingest/:id -> update or delete an ingest config',
    'POST /api/catalogue-ingest/:id/trigger -> manually trigger ingest',
  ],
  events: [
    'POST /api/events/event-types -> create an event type',
    'PUT /api/events/event-types/:id -> update an event type',
    'POST /api/events/save-values -> bulk save event names/weights',
    'GET /api/events/templates -> list training templates',
    'POST /api/events/templates -> create a training template',
    'PUT/DELETE /api/events/templates/:id -> update or delete a training template',
  ],
  models: [
    'GET /api/models -> list registered models',
    'POST /api/models -> register a model',
    'PATCH/DELETE /api/models/:id -> update or delete a model',
  ],
  training: [
    'GET /api/training-jobs -> list recent training jobs',
    'POST /api/training/start -> start training from a template',
    'POST /api/training-jobs/stop -> stop a running training job',
    'POST /api/training-jobs/approve -> approve a model package',
    'POST /api/training-jobs/promote -> promote a model package to the endpoint',
    'GET /api/training-jobs/logs/:jobName -> fetch recent training logs',
    'GET /api/training-jobs/metrics/:jobName -> fetch final training metrics',
    'GET /api/training-jobs/endpoint -> inspect the deployed endpoint',
  ],
  security: [
    'GET /api/api-keys -> list API keys',
    'POST /api/api-keys -> create an API key',
    'DELETE /api/api-keys/:id -> revoke an API key',
    'GET /api/security/clients -> list SDK OAuth clients',
    'POST /api/security/create-client -> create an SDK OAuth client',
    'PATCH /api/security/update-client -> rename or change environment on an SDK client',
    'POST /api/security/revoke-client -> revoke an SDK client',
    'GET /api/integrations -> list integrations',
    'POST /api/integrations -> connect/disconnect/delete an integration',
  ],
  team: [
    'GET /api/team -> list team members',
    'POST /api/team/invite -> invite a team member by email',
  ],
  billing: [
    'POST /api/billing/portal -> create a billing-portal link',
    'POST /api/billing/change-plan -> change the team billing plan',
  ],
};

function isSafePlatformApiPath(path: string) {
  return SAFE_PLATFORM_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function formatPlatformRoutes(section?: string) {
  const chosenSections = section ? [section] : Object.keys(PLATFORM_ROUTE_GUIDE);
  const lines = [
    'Internal platform API routes available through the admin MCP fallback:',
    '',
    'Use dedicated tools first when they exist. Use call_platform_api for UI capabilities that do not have a first-class MCP tool yet.',
  ];

  for (const key of chosenSections) {
    const entries = PLATFORM_ROUTE_GUIDE[key];
    if (!entries?.length) continue;
    lines.push('', `${key}:`);
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
  }

  return lines.join('\n');
}

function formatPlatformApiResponse(method: string, path: string, res: any) {
  const label = `${method} ${path}`;
  if (res == null) {
    return `✅ ${label}\n\nNo response body returned.`;
  }
  if (typeof res === 'string') {
    return `✅ ${label}\n\n${res}`;
  }
  return `✅ ${label}\n\n${JSON.stringify(res, null, 2)}`;
}

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

function formatEventBreakdown(rows: Array<{ event_name: string; count: number }>) {
  if (!rows.length) return '  No events recorded.';
  return rows.map((row) => `  ${row.event_name}: ${row.count}`).join('\n');
}

function formatItemAnalytics(res: any, itemId: string) {
  const itemLabel = res?.item?.name ? `${res.item.name} (${itemId})` : itemId;
  const lines = [
    `Item analytics for ${itemLabel}`,
    `Window: ${res?.window ?? '7d'}`,
    `Served: ${res?.served_count ?? 0}`,
    `Total events: ${res?.total_event_count ?? 0}`,
    `Clicks: ${res?.click_count ?? 0}`,
    `Watch/View events: ${res?.watch_count ?? 0}`,
    `CTR: ${((res?.click_through_rate ?? 0) * 100).toFixed(2)}%`,
  ];

  if (res?.last_served_at) lines.push(`Last served: ${res.last_served_at}`);
  if (res?.last_event_at) lines.push(`Last event: ${res.last_event_at}`);

  lines.push('', 'Event breakdown:', formatEventBreakdown(res?.event_breakdown ?? []));
  return lines.join('\n');
}

function formatUserAnalytics(res: any, userId: string) {
  const userLabel = res?.user?.name ? `${res.user.name} (${userId})` : userId;
  const lines = [
    `User analytics for ${userLabel}`,
    `Window: ${res?.window ?? '7d'}`,
    `Served: ${res?.served_count ?? 0}`,
    `Total events: ${res?.total_event_count ?? 0}`,
    `Clicks: ${res?.click_count ?? 0}`,
    `CTR: ${((res?.click_through_rate ?? 0) * 100).toFixed(2)}%`,
    `Unique items: ${res?.unique_items ?? 0}`,
    `Unique sessions: ${res?.unique_sessions ?? 0}`,
  ];

  if (res?.last_served_at) lines.push(`Last served: ${res.last_served_at}`);
  if (res?.last_event_at) lines.push(`Last event: ${res.last_event_at}`);

  lines.push('', 'Event breakdown:', formatEventBreakdown(res?.event_breakdown ?? []));
  return lines.join('\n');
}

function formatItemComparison(res: any) {
  const itemA = res?.item_a;
  const itemB = res?.item_b;
  const itemALabel = itemA?.item?.name ? `${itemA.item.name} (${itemA.item?.entity_id ?? 'unknown'})` : itemA?.item?.entity_id ?? 'item_a';
  const itemBLabel = itemB?.item?.name ? `${itemB.item.name} (${itemB.item?.entity_id ?? 'unknown'})` : itemB?.item?.entity_id ?? 'item_b';

  const servedDelta = (itemA?.served_count ?? 0) - (itemB?.served_count ?? 0);
  const clickDelta = (itemA?.click_count ?? 0) - (itemB?.click_count ?? 0);
  const ctrDelta = ((itemA?.click_through_rate ?? 0) - (itemB?.click_through_rate ?? 0)) * 100;

  return [
    `Item comparison (${res?.window ?? '7d'})`,
    '',
    `${itemALabel}`,
    `  Served: ${itemA?.served_count ?? 0}`,
    `  Events: ${itemA?.total_event_count ?? 0}`,
    `  Clicks: ${itemA?.click_count ?? 0}`,
    `  CTR: ${((itemA?.click_through_rate ?? 0) * 100).toFixed(2)}%`,
    '',
    `${itemBLabel}`,
    `  Served: ${itemB?.served_count ?? 0}`,
    `  Events: ${itemB?.total_event_count ?? 0}`,
    `  Clicks: ${itemB?.click_count ?? 0}`,
    `  CTR: ${((itemB?.click_through_rate ?? 0) * 100).toFixed(2)}%`,
    '',
    `Deltas (item A - item B): served=${servedDelta}, clicks=${clickDelta}, ctr=${ctrDelta.toFixed(2)}pp`,
  ].join('\n');
}

function formatTopItems(res: any) {
  const items = Array.isArray(res?.items) ? res.items : [];
  if (!items.length) {
    return `No top items found for metric "${res?.metric ?? 'served'}".`;
  }

  const qualifier = res?.metric === 'events'
    ? `events${res?.event_name ? ` matching "${res.event_name}"` : ''}${res?.event_id != null ? ` (event_id=${res.event_id})` : ''}`
    : 'served count';

  const lines = [`Top items by ${qualifier} (${res?.window ?? '7d'}):`, ''];
  for (const [index, item] of items.entries()) {
    lines.push(`${index + 1}. ${item.name ?? item.item_id} (${item.item_id}) — ${item.count}`);
  }
  return lines.join('\n');
}

function formatTopItemsFallback(primaryRes: any, fallbackRes: any) {
  const primaryMetric = primaryRes?.metric ?? 'served';
  const primaryQualifier = primaryMetric === 'events'
    ? `events${primaryRes?.event_name ? ` matching "${primaryRes.event_name}"` : ''}${primaryRes?.event_id != null ? ` (event_id=${primaryRes.event_id})` : ''}`
    : 'served count';

  const fallbackText = formatTopItems(fallbackRes);
  return [
    `No top items found for ${primaryQualifier} (${primaryRes?.window ?? '7d'}).`,
    '',
    'Using served count instead:',
    '',
    fallbackText,
  ].join('\n');
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

  // ── Additional context ops ─────────────────────────────────────────
  {
    name: 'get_context',
    description: 'Get the full configuration of a specific recommendation context by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        context_id: { type: 'number', description: 'The context ID to retrieve.' },
      },
      required: ['context_id'],
    },
  },

  // ── Additional pipeline ops ────────────────────────────────────────
  {
    name: 'get_pipeline',
    description: 'Get the full configuration of a specific ranking pipeline by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'The pipeline ID to retrieve.' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'activate_pipeline',
    description: 'Activate a ranking pipeline so it begins serving ranked results.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'The pipeline ID to activate.' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'deactivate_pipeline',
    description: 'Deactivate a ranking pipeline so it stops serving results without being deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'The pipeline ID to deactivate.' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'clone_pipeline',
    description: 'Duplicate an existing pipeline with all its stages and configuration. Useful for creating experiment variants or safe copies before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'The pipeline ID to clone.' },
        name: { type: 'string', description: 'Name for the cloned pipeline.' },
      },
      required: ['pipeline_id', 'name'],
    },
  },

  // ── Additional rule ops ────────────────────────────────────────────
  {
    name: 'get_rule',
    description: 'Get the full configuration of a specific ranking rule by ID, including conditions and action.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The rule ID to retrieve.' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'enable_rule',
    description: 'Enable a ranking rule that was previously disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The rule ID to enable.' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'disable_rule',
    description: 'Disable a ranking rule without deleting it. Useful for temporarily pausing rules during debugging or campaigns.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The rule ID to disable.' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'reorder_rules',
    description: 'Set the priority order of rules by providing rule IDs in the desired order. The first rule in the list gets the highest priority and is evaluated first.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Rule IDs in descending priority order (first = highest priority).',
        },
        context_id: { type: 'number', description: 'Optional context ID to scope the reorder.' },
      },
      required: ['rule_ids'],
    },
  },

  // ── Segment tools ──────────────────────────────────────────────────
  {
    name: 'list_segments',
    description: 'List all user segments. Segments group users by shared behaviours or attributes and can be referenced in rules and campaigns.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_segment',
    description: 'Get the full definition of a specific user segment, including all its conditions.',
    inputSchema: {
      type: 'object',
      properties: {
        segment_id: { type: 'number', description: 'The segment ID to retrieve.' },
      },
      required: ['segment_id'],
    },
  },
  {
    name: 'create_segment',
    description:
      'Create a new user segment with membership conditions. ' +
      'Condition types: behavioral (purchase/click history), demographic (age, location), ' +
      'computed (ML scores), item_interaction (affinity to categories or items). ' +
      'Example: power users who purchased 3+ times in 30 days.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Segment display name.' },
        description: { type: 'string', description: 'Segment description.' },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'User field to match (e.g. "purchase_count", "country").' },
              operator: { type: 'string', enum: ['equals', 'not_equals', 'greater_than', 'less_than', 'in', 'not_in', 'exists'] },
              value: { description: 'Value to match.' },
              type: { type: 'string', enum: ['behavioral', 'demographic', 'computed', 'item_interaction'], description: 'Condition category.' },
            },
            required: ['field', 'operator', 'value'],
          },
          description: 'Conditions that define segment membership (all must match).',
        },
        is_active: { type: 'boolean', description: 'Whether the segment is active. Default: true.' },
      },
      required: ['name', 'conditions'],
    },
  },
  {
    name: 'update_segment',
    description: 'Update an existing user segment definition.',
    inputSchema: {
      type: 'object',
      properties: {
        segment_id: { type: 'number', description: 'The segment ID to update.' },
        name: { type: 'string' },
        description: { type: 'string' },
        is_active: { type: 'boolean' },
        conditions: { type: 'array', items: { type: 'object' } },
      },
      required: ['segment_id'],
    },
  },
  {
    name: 'delete_segment',
    description: 'Delete a user segment. Any rules referencing this segment will need to be updated.',
    inputSchema: {
      type: 'object',
      properties: {
        segment_id: { type: 'number', description: 'The segment ID to delete.' },
      },
      required: ['segment_id'],
    },
  },
  {
    name: 'get_segment_stats',
    description: 'Get size and overlap statistics for a user segment — how many users match, percentage of total users, and overlap with other segments.',
    inputSchema: {
      type: 'object',
      properties: {
        segment_id: { type: 'number', description: 'The segment ID to get stats for.' },
      },
      required: ['segment_id'],
    },
  },

  // ── A/B Experiment tools ───────────────────────────────────────────
  {
    name: 'list_experiments',
    description: 'List all A/B experiments with their current status (draft, running, paused, completed).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_experiment',
    description: 'Get the full configuration of a specific A/B experiment including variants, traffic splits, and current metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'number', description: 'The experiment ID to retrieve.' },
      },
      required: ['experiment_id'],
    },
  },
  {
    name: 'create_experiment',
    description:
      'Create a new A/B experiment comparing pipeline variants. ' +
      'Specify 2+ variants with traffic fractions summing to 1.0. ' +
      'Each variant can point to a different pipeline_id. ' +
      'Start it with start_experiment after creating.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Experiment name.' },
        description: { type: 'string', description: 'Experiment description.' },
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Variant ID (e.g. "control", "treatment").' },
              name: { type: 'string', description: 'Display name.' },
              traffic_fraction: { type: 'number', description: 'Traffic fraction 0–1.' },
              pipeline_id: { type: 'number', description: 'Pipeline assigned to this variant.' },
            },
            required: ['id', 'name', 'traffic_fraction'],
          },
          description: 'Variants (minimum 2). Traffic fractions must sum to 1.0.',
        },
      },
      required: ['name', 'variants'],
    },
  },
  {
    name: 'update_experiment',
    description: 'Update an experiment that is in draft status.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'number', description: 'The experiment ID to update.' },
        name: { type: 'string' },
        description: { type: 'string' },
        variants: { type: 'array', items: { type: 'object' } },
      },
      required: ['experiment_id'],
    },
  },
  {
    name: 'start_experiment',
    description: 'Start an A/B experiment. Traffic will begin splitting between variants immediately. The experiment moves from draft to running status.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'number', description: 'The experiment ID to start.' },
      },
      required: ['experiment_id'],
    },
  },
  {
    name: 'stop_experiment',
    description: 'Stop a running A/B experiment and mark it as completed. Results are preserved for analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'number', description: 'The experiment ID to stop.' },
      },
      required: ['experiment_id'],
    },
  },
  {
    name: 'get_experiment_results',
    description: 'Get statistical results for a completed or running experiment — per-variant CTR, conversion rate, revenue per session, sample sizes, and a winner recommendation.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'number', description: 'The experiment ID to get results for.' },
      },
      required: ['experiment_id'],
    },
  },

  // ── Campaign tools ─────────────────────────────────────────────────
  {
    name: 'list_campaigns',
    description: 'List all campaigns — time-bounded rule injections that activate on a schedule (e.g. flash sales, seasonal promotions).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_campaign',
    description: 'Get the full configuration of a specific campaign including start/end dates and injected rules.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'number', description: 'The campaign ID to retrieve.' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'create_campaign',
    description:
      'Create a time-bounded campaign that injects ranking rules between a start and end datetime. ' +
      'Use this for flash sales, seasonal promotions, or any time-limited merchandising. ' +
      'The rules activate automatically at start_date and deactivate at end_date.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign display name.' },
        description: { type: 'string', description: 'Campaign description.' },
        pipeline_id: { type: 'number', description: 'Pipeline to apply this campaign to.' },
        start_date: { type: 'string', description: 'Start datetime in ISO 8601 (e.g. "2025-06-01T09:00:00Z").' },
        end_date: { type: 'string', description: 'End datetime in ISO 8601.' },
        rules: {
          type: 'array',
          items: { type: 'object' },
          description: 'Ranking rules to inject during this campaign window.',
        },
      },
      required: ['name', 'start_date', 'end_date'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update a campaign — change its name, description, or start/end dates.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'number', description: 'The campaign ID to update.' },
        name: { type: 'string' },
        description: { type: 'string' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        is_active: { type: 'boolean' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'delete_campaign',
    description: 'Delete a campaign and its associated rules.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'number', description: 'The campaign ID to delete.' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'activate_campaign',
    description: 'Activate a paused campaign so it starts injecting rules again.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'number', description: 'The campaign ID to activate.' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'pause_campaign',
    description: 'Pause an active campaign, temporarily stopping its rule injections without deleting it.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'number', description: 'The campaign ID to pause.' },
      },
      required: ['campaign_id'],
    },
  },

  // ── Training job tools ─────────────────────────────────────────────
  {
    name: 'list_training_jobs',
    description: 'List recent model training jobs with their status (running, completed, failed). Training jobs re-train the ranking model on new interaction data.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_training_job',
    description: 'Get details and logs for a specific training job.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Training job ID or execution ARN.' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'create_training_job',
    description: 'Trigger a new model training job. The job trains on all available interaction data and replaces the current model when complete.',
    inputSchema: {
      type: 'object',
      properties: {
        model_type: { type: 'string', description: 'Model type to train (e.g. "nsl-embed-v2"). Uses team default if omitted.' },
        config: { type: 'object', description: 'Training configuration overrides.', additionalProperties: true },
      },
    },
  },
  {
    name: 'cancel_training_job',
    description: 'Cancel a running training job.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Training job ID or execution ARN to cancel.' },
      },
      required: ['job_id'],
    },
  },

  // ── Analytics / Metrics tools ──────────────────────────────────────
  {
    name: 'get_ranking_metrics',
    description:
      'Get ranking performance metrics for a pipeline or context: CTR by position, overall CTR, conversion rate, diversity score, catalogue coverage, and revenue per session.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'number', description: 'Filter metrics to a specific pipeline.' },
        context_id: { type: 'number', description: 'Filter metrics to a specific context.' },
        window: { type: 'string', enum: ['1d', '7d', '30d'], description: 'Time window. Default: 7d.' },
      },
    },
  },
  {
    name: 'get_experiment_metrics',
    description: 'Get live metrics for a specific A/B experiment broken down by variant — CTR, conversion rate, revenue per session, and statistical significance.',
    inputSchema: {
      type: 'object',
      properties: {
        experiment_id: { type: 'number', description: 'The experiment ID to get metrics for.' },
      },
      required: ['experiment_id'],
    },
  },
  {
    name: 'get_segment_metrics',
    description: 'Get ranking performance metrics broken down by user segment — useful for understanding how different user groups respond to your ranking configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        segment_id: { type: 'number', description: 'The segment ID to get metrics for.' },
        window: { type: 'string', enum: ['1d', '7d', '30d'], description: 'Time window. Default: 7d.' },
      },
      required: ['segment_id'],
    },
  },
  {
    name: 'get_user_analytics',
    description: 'Get served counts, event breakdown, unique-item activity, and click-through rate for a specific user over a time window.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The user ID or email to inspect.' },
        context_id: { type: 'string', description: 'Optional context ID to scope the analytics.' },
        window: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Time window. Default: 7d.' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_item_analytics',
    description: 'Get served counts, event breakdown, watch/click counts, and click-through rate for a specific item over a time window.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The item ID to inspect.' },
        context_id: { type: 'string', description: 'Optional context ID to scope the analytics.' },
        window: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Time window. Default: 7d.' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'compare_items',
    description: 'Compare two items head-to-head by served count, events, clicks, and click-through rate over the same time window.',
    inputSchema: {
      type: 'object',
      properties: {
        item_a_id: { type: 'string', description: 'The first item ID to compare.' },
        item_b_id: { type: 'string', description: 'The second item ID to compare.' },
        context_id: { type: 'string', description: 'Optional context ID to scope the analytics.' },
        window: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Time window. Default: 7d.' },
      },
      required: ['item_a_id', 'item_b_id'],
    },
  },
  {
    name: 'top_items',
    description: 'List the top items by served count or by matching event activity such as watch or click over a time window. For generic "top item" or "best performing item" questions, prefer metric="served" unless the user explicitly names an event type.',
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['served', 'events'], description: 'Rank by served count or by event count. Default: served. Use "events" when the user explicitly asks about a specific engagement signal such as watch, click, or view.' },
        event_name: { type: 'string', description: 'Optional event-name filter when metric=events, for example "watch".' },
        event_id: { type: 'number', description: 'Optional numeric event ID filter when metric=events.' },
        context_id: { type: 'string', description: 'Optional context ID to scope the analytics.' },
        window: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Time window. Default: 7d.' },
        limit: { type: 'number', description: 'Maximum number of items to return (1-50). Default: 10.' },
      },
    },
  },

  // ── API Key & Integration tools ────────────────────────────────────
  {
    name: 'list_api_keys',
    description: 'List all API keys for the team with their names, scopes, environments, and last-used timestamps.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_api_key',
    description: 'Create a new API key with specified permissions (scopes). The full key is returned once and cannot be retrieved again.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API key display name.' },
        environment: { type: 'string', enum: ['production', 'staging', 'development'], description: 'Environment for this key. Default: production.' },
        scopes: {
          type: 'array',
          items: { type: 'string', enum: ['recommendations', 'events', 'items', 'admin'] },
          description: 'Permissions granted to this key. Default: ["recommendations"].',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'revoke_api_key',
    description: 'Revoke an API key. This immediately invalidates the key and cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        key_id: { type: 'number', description: 'The API key ID to revoke.' },
      },
      required: ['key_id'],
    },
  },
  {
    name: 'list_integrations',
    description: 'List configured third-party integrations (webhooks, data connectors, export targets, etc.).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_platform_routes',
    description:
      'List the internal admin-console API routes that the standalone MCP can reach in internal mode. ' +
      'Use this when the user asks for a UI capability that does not have a dedicated MCP tool yet.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['ranking', 'analytics', 'catalogue', 'events', 'models', 'training', 'security', 'team', 'billing'],
          description: 'Optional area to focus the route list on.',
        },
      },
    },
  },
  {
    name: 'call_platform_api',
    description:
      'Fallback tool for internal mode only. Calls safe admin-console /api routes directly when no dedicated MCP tool exists. ' +
      'Prefer dedicated tools first, and use list_platform_routes when unsure which route to call.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Admin-console API path starting with /api/.' },
        method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP method.' },
        query: { type: 'object', additionalProperties: true, description: 'Optional query string parameters.' },
        body: { type: 'object', additionalProperties: true, description: 'Optional JSON body.' },
      },
      required: ['path'],
    },
  },
];

const ADMIN_TOOL_NAMES = new Set([
  'list_contexts',
  'create_context',
  'update_context',
  'delete_context',
  'list_pipelines',
  'create_pipeline',
  'update_pipeline',
  'delete_pipeline',
  'list_rules',
  'create_rule',
  'update_rule',
  'delete_rule',
  'toggle_rule',
  'get_context',
  'get_pipeline',
  'activate_pipeline',
  'deactivate_pipeline',
  'clone_pipeline',
  'get_rule',
  'enable_rule',
  'disable_rule',
  'reorder_rules',
  'list_segments',
  'get_segment',
  'create_segment',
  'update_segment',
  'delete_segment',
  'get_segment_stats',
  'list_experiments',
  'get_experiment',
  'create_experiment',
  'update_experiment',
  'start_experiment',
  'stop_experiment',
  'get_experiment_results',
  'list_campaigns',
  'get_campaign',
  'create_campaign',
  'update_campaign',
  'delete_campaign',
  'activate_campaign',
  'pause_campaign',
  'list_training_jobs',
  'get_training_job',
  'create_training_job',
  'cancel_training_job',
  'get_ranking_metrics',
  'get_experiment_metrics',
  'get_segment_metrics',
  'get_user_analytics',
  'get_item_analytics',
  'compare_items',
  'top_items',
  'list_api_keys',
  'create_api_key',
  'revoke_api_key',
  'list_integrations',
  'list_platform_routes',
  'call_platform_api',
]);

function getExportedTools(mode: ServerMode) {
  if (mode === 'internal') {
    return TOOLS.filter((tool) => [
      'search_items',
      'explain_ranking',
      'list_contexts',
      'create_context',
      'update_context',
      'get_context',
      'list_pipelines',
      'create_pipeline',
      'update_pipeline',
      'delete_pipeline',
      'activate_pipeline',
      'deactivate_pipeline',
      'clone_pipeline',
      'get_pipeline',
      'list_rules',
      'create_rule',
      'update_rule',
      'delete_rule',
      'toggle_rule',
      'enable_rule',
      'disable_rule',
      'get_rule',
      'get_ranking_metrics',
      'list_segments',
      'get_segment',
      'create_segment',
      'update_segment',
      'delete_segment',
      'list_experiments',
      'get_experiment',
      'create_experiment',
      'update_experiment',
      'start_experiment',
      'stop_experiment',
      'get_experiment_results',
      'list_training_jobs',
      'get_training_job',
      'create_training_job',
      'cancel_training_job',
      'get_user_analytics',
      'get_item_analytics',
      'compare_items',
      'top_items',
      'list_api_keys',
      'create_api_key',
      'revoke_api_key',
      'list_integrations',
      'list_platform_routes',
      'call_platform_api',
    ].includes(tool.name));
  }

  return TOOLS.filter((tool) => !ADMIN_TOOL_NAMES.has(tool.name));
}

function unsupportedAdminToolResponse(toolName: string, mode: ServerMode) {
  return {
    content: [{
      type: 'text' as const,
      text:
        mode === 'public'
          ? `Admin tool \`${toolName}\` is not available in public mode.\n\nThe public OAuth API currently supports recommendations, events, and catalogue operations only.`
          : `Tool \`${toolName}\` is not implemented in internal mode yet.`,
    }],
    isError: true,
  };
}

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer(client: NeuronClient, mode: ServerMode = 'public'): Server {
  const server = new Server(
    { name: 'neuronsearchlab', version: '0.3.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: getExportedTools(mode) }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    if (mode === 'public' && ADMIN_TOOL_NAMES.has(name)) {
      return unsupportedAdminToolResponse(name, mode);
    }

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
          const res = mode === 'internal'
            ? await client.get('/api/items/search', {
                q: input.query,
                limit: input.limit ?? 20,
              }) as any
            : await client.get('/items/search', {
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
          const res = mode === 'internal'
            ? await client.get('/api/explain', {
                item_id: input.item_id,
                user_id: input.user_id,
                context_id: input.context_id,
              }) as any
            : await client.post('/explain', {
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

          const explanation = mode === 'internal' ? res?.explanation : res;
          const lines: string[] = [
            `📊 Ranking explanation for item: ${input.item_id}`,
            `   User: ${input.user_id ?? 'neutral baseline'}`,
            '',
            `Final score: ${explanation?.final_score ?? explanation?.finalScore ?? explanation?.score ?? 'n/a'}`,
            '',
            '─── Score breakdown ───',
          ];

          const breakdown = explanation?.breakdown ?? explanation?.feature_contributions;
          if (Array.isArray(breakdown)) {
            for (const contribution of breakdown) {
              lines.push(`  ${contribution.feature ?? 'feature'}: ${contribution.contribution ?? contribution.value ?? 'n/a'}`);
            }
          } else if (breakdown) {
            for (const [component, value] of Object.entries(breakdown)) {
              lines.push(`  ${component}: ${value}`);
            }
          }

          const appliedRules = explanation?.applied_rules ?? explanation?.appliedRules;
          if (appliedRules?.length) {
            lines.push('', '─── Applied rules ───');
            for (const rule of appliedRules) {
              const matched = rule.matched ? '✅ matched' : '⬜ no match';
              lines.push(`  ${rule.name} (${rule.type}) — ${matched}`);
            }
          }

          const pipelineTrace = explanation?.pipeline_stages ?? explanation?.pipelineTrace;
          if (pipelineTrace?.length) {
            lines.push('', '─── Pipeline trace ───');
            for (const stage of pipelineTrace) {
              const icon = stage.status === 'passed' ? '✅' : stage.status === 'partial' ? '⚠️' : '❌';
              lines.push(`  ${icon} ${stage.stage}: ${stage.status}`);
              if (stage.note) lines.push(`     ${stage.note}`);
            }
          }

          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        // ── Context management ────────────────────────────────────────
        case 'list_contexts': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/context');
          const contexts = Array.isArray(res?.contexts) ? res.contexts : [];
          const text = formatList('context(s)', contexts, (c) =>
            `[id: ${c.id}] ${c.name ?? c.context_name ?? 'Unnamed'}`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_context': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreateContextInput.parse(args);
          const res = await client.post('/api/context/create', {
            contextName: input.context_name,
            contextKey: input.context_key,
            contextType: input.context_type,
            description: input.description,
            jsonData: { recommendation_type: input.recommendation_type },
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Context created.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'update_context': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = UpdateContextInput.parse(args);
          const listRes = await client.get<any>('/api/context');
          const contexts = Array.isArray(listRes?.contexts) ? listRes.contexts : [];
          const existing = contexts.find((entry: any) => Number(entry.id) === input.context_id);
          if (!existing) {
            return { content: [{ type: 'text', text: `❌ Context ${input.context_id} not found.` }], isError: true };
          }
          const res = await client.patch(`/api/context/${input.context_id}`, {
            contextName: input.context_name ?? existing.name ?? existing.context_name,
            contextType: input.context_type ?? existing.context_type,
            description: input.description ?? existing.description ?? '',
            jsonData: input.recommendation_type
              ? { recommendation_type: input.recommendation_type }
              : undefined,
          });
          return {
            content: [{
              type: 'text',
              text: `✅ Context ${input.context_id} updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_context': {
          return unsupportedAdminToolResponse(name, mode);
        }

        case 'get_context': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetContextInput.parse(args);
          const res = await client.get<any>('/api/context');
          const contexts = Array.isArray(res?.contexts) ? res.contexts : [];
          const context = contexts.find((entry: any) => Number(entry.id) === input.context_id);
          if (!context) {
            return { content: [{ type: 'text', text: `❌ Context ${input.context_id} not found.` }], isError: true };
          }
          return { content: [{ type: 'text', text: `Context ${input.context_id}:\n${JSON.stringify(context, null, 2)}` }] };
        }

        // ── Pipeline management ───────────────────────────────────────
        case 'list_pipelines': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/pipelines');
          const pipelines = Array.isArray(res?.pipelines) ? res.pipelines : [];
          const text = formatList('pipeline(s)', pipelines, (p) =>
            `[id: ${p.id}] ${p.name} (context: ${p.context_id ?? 'none'}, active: ${p.is_active})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_pipeline': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreatePipelineInput.parse(args);
          const res = await client.post('/api/pipelines', {
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
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = UpdatePipelineInput.parse(args);
          const { pipeline_id, ...body } = input;
          const res = await client.patch(`/api/pipelines/${pipeline_id}`, body);
          return {
            content: [{
              type: 'text',
              text: `✅ Pipeline ${pipeline_id} updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_pipeline': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = DeletePipelineInput.parse(args);
          await client.delete(`/api/pipelines/${input.pipeline_id}`);
          return {
            content: [{ type: 'text', text: `✅ Pipeline ${input.pipeline_id} deleted.` }],
          };
        }

        case 'get_pipeline': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetPipelineInput.parse(args);
          const res = await client.get<any>(`/api/pipelines/${input.pipeline_id}`);
          return { content: [{ type: 'text', text: `Pipeline ${input.pipeline_id}:\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'activate_pipeline': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = ActivatePipelineInput.parse(args);
          const res = await client.patch(`/api/pipelines/${input.pipeline_id}`, { is_active: true });
          return { content: [{ type: 'text', text: `✅ Pipeline ${input.pipeline_id} activated.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'deactivate_pipeline': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = DeactivatePipelineInput.parse(args);
          const res = await client.patch(`/api/pipelines/${input.pipeline_id}`, { is_active: false });
          return { content: [{ type: 'text', text: `✅ Pipeline ${input.pipeline_id} deactivated.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'clone_pipeline': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = ClonePipelineInput.parse(args);
          const source = await client.get<any>(`/api/pipelines/${input.pipeline_id}`);
          const pipeline = source?.pipeline;
          if (!pipeline) {
            return { content: [{ type: 'text', text: `❌ Pipeline ${input.pipeline_id} not found.` }], isError: true };
          }
          const res = await client.post('/api/pipelines', {
            name: input.name,
            description: pipeline.description,
            context_id: pipeline.context_id,
            is_active: pipeline.is_active,
            stages: pipeline.stages,
          });
          return { content: [{ type: 'text', text: `✅ Pipeline cloned.\n${JSON.stringify(res, null, 2)}` }] };
        }

        // ── Rule management ───────────────────────────────────────────
        case 'list_rules': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = ListRulesInput.parse(args);
          const query: Record<string, string | number | boolean | undefined> = {};
          if (input.context_id !== undefined) query.contextId = input.context_id;
          const res = await client.get<any>('/api/rules', query);
          const rules = Array.isArray(res?.rules) ? res.rules : [];
          const text = formatList('rule(s)', rules, (r) =>
            `[id: ${r.id}] ${r.name} (type: ${r.rule_type}, active: ${r.is_active}, context: ${r.context_id ?? 'all'})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_rule': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreateRuleInput.parse(args);
          const res = await client.post('/api/rules', {
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
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = UpdateRuleInput.parse(args);
          const { rule_id, ...body } = input;
          const res = await client.patch(`/api/rules/${rule_id}`, body);
          return {
            content: [{
              type: 'text',
              text: `✅ Rule ${rule_id} updated.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'delete_rule': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = DeleteRuleInput.parse(args);
          await client.delete(`/api/rules/${input.rule_id}`);
          return {
            content: [{ type: 'text', text: `✅ Rule ${input.rule_id} deleted.` }],
          };
        }

        case 'toggle_rule': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = ToggleRuleInput.parse(args);
          const res = await client.patch(`/api/rules/${input.rule_id}`, { is_active: input.is_active });
          return {
            content: [{
              type: 'text',
              text: `✅ Rule ${input.rule_id} is now ${input.is_active ? 'active' : 'inactive'}.\n${JSON.stringify(res, null, 2)}`,
            }],
          };
        }

        case 'get_rule': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetRuleInput.parse(args);
          const res = await client.get<any>(`/api/rules/${input.rule_id}`);
          return { content: [{ type: 'text', text: `Rule ${input.rule_id}:\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'enable_rule': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = EnableRuleInput.parse(args);
          const res = await client.patch(`/api/rules/${input.rule_id}`, { is_active: true });
          return { content: [{ type: 'text', text: `✅ Rule ${input.rule_id} enabled.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'disable_rule': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = DisableRuleInput.parse(args);
          const res = await client.patch(`/api/rules/${input.rule_id}`, { is_active: false });
          return { content: [{ type: 'text', text: `✅ Rule ${input.rule_id} disabled.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'reorder_rules': {
          return unsupportedAdminToolResponse(name, mode);
        }

        // ── Segment management ────────────────────────────────────────
        case 'list_segments': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/segments');
          const segments = Array.isArray(res?.segments) ? res.segments : [];
          const text = formatList('segment(s)', segments, (s) =>
            `[id: ${s.id}] ${s.name} (active: ${s.is_active})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'get_segment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetSegmentInput.parse(args);
          const res = await client.get<any>(`/api/segments/${input.segment_id}`);
          return { content: [{ type: 'text', text: `Segment ${input.segment_id}:\n${JSON.stringify(res?.segment ?? res, null, 2)}` }] };
        }

        case 'create_segment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreateSegmentInput.parse(args);
          const res = await client.post('/api/segments', {
            name: input.name,
            description: input.description,
            conditions: input.conditions,
            is_active: input.is_active,
          });
          return { content: [{ type: 'text', text: `✅ Segment created.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'update_segment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = UpdateSegmentInput.parse(args);
          const { segment_id, ...body } = input;
          const res = await client.patch(`/api/segments/${segment_id}`, body);
          return { content: [{ type: 'text', text: `✅ Segment ${segment_id} updated.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'delete_segment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = DeleteSegmentInput.parse(args);
          await client.delete(`/api/segments/${input.segment_id}`);
          return { content: [{ type: 'text', text: `✅ Segment ${input.segment_id} deleted.` }] };
        }

        case 'get_segment_stats': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetSegmentStatsInput.parse(args);
          return {
            content: [{ type: 'text', text: `Tool get_segment_stats is not available in internal mode yet for segment ${input.segment_id}. Use call_platform_api once a dedicated stats endpoint exists.` }],
            isError: true,
          };
        }

        // ── Experiment (A/B test) management ─────────────────────────
        case 'list_experiments': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/experiments');
          const experiments = Array.isArray(res?.experiments) ? res.experiments : [];
          const text = formatList('experiment(s)', experiments, (e) =>
            `[id: ${e.id}] ${e.name} (status: ${e.status})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'get_experiment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetExperimentInput.parse(args);
          const res = await client.get<any>(`/api/experiments/${input.experiment_id}`);
          return { content: [{ type: 'text', text: `Experiment ${input.experiment_id}:\n${JSON.stringify(res?.experiment ?? res, null, 2)}` }] };
        }

        case 'create_experiment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreateExperimentInput.parse(args);
          const res = await client.post('/api/experiments', {
            name: input.name,
            description: input.description,
            variants: input.variants,
          });
          return { content: [{ type: 'text', text: `✅ Experiment created. Use start_experiment to begin traffic splitting.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'update_experiment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = UpdateExperimentInput.parse(args);
          const { experiment_id, ...body } = input;
          const res = await client.patch(`/api/experiments/${experiment_id}`, body);
          return { content: [{ type: 'text', text: `✅ Experiment ${experiment_id} updated.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'start_experiment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = StartExperimentInput.parse(args);
          const res = await client.patch(`/api/experiments/${input.experiment_id}`, { status: 'running' });
          return { content: [{ type: 'text', text: `✅ Experiment ${input.experiment_id} started. Traffic is now splitting between variants.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'stop_experiment': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = StopExperimentInput.parse(args);
          const res = await client.patch(`/api/experiments/${input.experiment_id}`, { status: 'completed' });
          return { content: [{ type: 'text', text: `✅ Experiment ${input.experiment_id} stopped. Use get_experiment_results to view final results.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'get_experiment_results': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetExperimentResultsInput.parse(args);
          await client.post(`/api/experiments/${input.experiment_id}/metrics`, {});
          const res = await client.get<any>(`/api/experiments/${input.experiment_id}`);
          return { content: [{ type: 'text', text: `Experiment ${input.experiment_id} results:\n${JSON.stringify(res?.experiment ?? res, null, 2)}` }] };
        }

        // ── Campaign management ───────────────────────────────────────
        case 'list_campaigns': {
          const res = await client.get<any[]>('/campaigns');
          const text = formatList('campaign(s)', res ?? [], (c) =>
            `[id: ${c.id}] ${c.name} (active: ${c.is_active}, ${c.start_date} → ${c.end_date})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'get_campaign': {
          const input = GetCampaignInput.parse(args);
          const res = await client.get<any>(`/campaigns/${input.campaign_id}`);
          return { content: [{ type: 'text', text: `Campaign ${input.campaign_id}:\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'create_campaign': {
          const input = CreateCampaignInput.parse(args);
          const res = await client.post('/campaigns', {
            name: input.name,
            description: input.description,
            pipeline_id: input.pipeline_id,
            start_date: input.start_date,
            end_date: input.end_date,
            rules: input.rules ?? [],
          });
          return { content: [{ type: 'text', text: `✅ Campaign created.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'update_campaign': {
          const input = UpdateCampaignInput.parse(args);
          const { campaign_id, ...body } = input;
          const res = await client.patch(`/campaigns/${campaign_id}`, body);
          return { content: [{ type: 'text', text: `✅ Campaign ${campaign_id} updated.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'delete_campaign': {
          const input = DeleteCampaignInput.parse(args);
          await client.delete(`/campaigns/${input.campaign_id}`);
          return { content: [{ type: 'text', text: `✅ Campaign ${input.campaign_id} deleted.` }] };
        }

        case 'activate_campaign': {
          const input = ActivateCampaignInput.parse(args);
          const res = await client.patch(`/campaigns/${input.campaign_id}`, { is_active: true });
          return { content: [{ type: 'text', text: `✅ Campaign ${input.campaign_id} activated.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'pause_campaign': {
          const input = PauseCampaignInput.parse(args);
          const res = await client.patch(`/campaigns/${input.campaign_id}`, { is_active: false });
          return { content: [{ type: 'text', text: `✅ Campaign ${input.campaign_id} paused.\n${JSON.stringify(res, null, 2)}` }] };
        }

        // ── Training jobs ─────────────────────────────────────────────
        case 'list_training_jobs': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/training-jobs');
          const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
          const text = formatList('training job(s)', jobs, (j) =>
            `[id: ${j.id}] status: ${j.status ?? j.sageMaker?.pipelineExecutionStatus ?? 'unknown'} (${j.created_at ?? 'unknown date'})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'get_training_job': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetTrainingJobInput.parse(args);
          const res = await client.get<any>('/api/training-jobs');
          const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
          const job = jobs.find((entry: any) =>
            String(entry.id) === input.job_id
            || String(entry.execution_arn ?? '') === input.job_id
            || String(entry.sageMaker?.trainingJobArn ?? '') === input.job_id
            || String(entry.sageMaker?.trainingJobName ?? '') === input.job_id
          );
          if (!job) {
            return { content: [{ type: 'text', text: `❌ Training job ${input.job_id} not found.` }], isError: true };
          }
          return { content: [{ type: 'text', text: `Training job ${input.job_id}:\n${JSON.stringify(job, null, 2)}` }] };
        }

        case 'create_training_job': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreateTrainingJobInput.parse(args);
          const templateId = (input.config as any)?.templateId ?? (input.config as any)?.template_id;
          if (!templateId) {
            return {
              content: [{ type: 'text', text: '❌ create_training_job requires config.templateId when using the internal platform MCP.' }],
              isError: true,
            };
          }
          const res = await client.post('/api/training/start', {
            templateId,
            trainingOptions: (input.config as any)?.trainingOptions ?? (input.config as any)?.training_options ?? {},
          });
          return { content: [{ type: 'text', text: `✅ Training job started.\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'cancel_training_job': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CancelTrainingJobInput.parse(args);
          const listRes = await client.get<any>('/api/training-jobs');
          const jobs = Array.isArray(listRes?.jobs) ? listRes.jobs : [];
          const job = jobs.find((entry: any) =>
            String(entry.id) === input.job_id
            || String(entry.execution_arn ?? '') === input.job_id
            || String(entry.sageMaker?.trainingJobArn ?? '') === input.job_id
            || String(entry.sageMaker?.trainingJobName ?? '') === input.job_id
          );
          if (!job?.execution_arn) {
            return { content: [{ type: 'text', text: `❌ Training job ${input.job_id} not found or has no execution ARN.` }], isError: true };
          }
          const res = await client.post('/api/training-jobs/stop', {
            executionArn: job.execution_arn,
            trainingJobArn: job.sageMaker?.trainingJobArn ?? undefined,
          });
          return { content: [{ type: 'text', text: `✅ Training job ${input.job_id} cancelled.\n${JSON.stringify(res, null, 2)}` }] };
        }

        // ── Analytics / Metrics ───────────────────────────────────────
        case 'get_ranking_metrics': {
          const input = GetRankingMetricsInput.parse(args);
          const res = mode === 'internal'
            ? await client.get<any>('/api/analytics', {
                preset: input.window === '1d' ? '24h' : input.window,
                context: input.context_id,
              })
            : await client.get<any>('/analytics/ranking', {
                pipeline_id: input.pipeline_id,
                context_id: input.context_id,
                window: input.window,
              });

          if (!res) {
            return { content: [{ type: 'text', text: 'No metrics data available for the selected window.' }] };
          }

          if (mode === 'internal') {
            const lines = [
              `Ranking metrics (${res.preset ?? input.window}):`,
              `  Served: ${res?.totals?.served ?? 0}`,
              `  Events: ${Object.entries(res?.totals ?? {})
                .filter(([key]) => key !== 'served')
                .reduce((sum, [, value]) => sum + Number(value ?? 0), 0)}`,
            ];
            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          const lines = [`Ranking metrics (${input.window}):`, ''];
          if (res.ctr != null) lines.push(`  Overall CTR: ${(res.ctr * 100).toFixed(2)}%`);
          if (res.conversion_rate != null) lines.push(`  Conversion rate: ${(res.conversion_rate * 100).toFixed(2)}%`);
          if (res.diversity_score != null) lines.push(`  Diversity score: ${res.diversity_score.toFixed(3)}`);
          if (res.coverage != null) lines.push(`  Catalogue coverage: ${(res.coverage * 100).toFixed(1)}%`);
          if (res.revenue_per_session != null) lines.push(`  Revenue per session: $${res.revenue_per_session.toFixed(2)}`);
          if (res.ctr_by_position?.length) {
            lines.push('', '  CTR by position:');
            for (const [i, ctr] of res.ctr_by_position.entries()) {
              lines.push(`    Position ${i + 1}: ${(ctr * 100).toFixed(2)}%`);
            }
          }
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        case 'get_experiment_metrics': {
          const input = GetExperimentMetricsInput.parse(args);
          const res = await client.get<any>(`/analytics/experiments/${input.experiment_id}`);
          return { content: [{ type: 'text', text: `Experiment ${input.experiment_id} metrics:\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'get_segment_metrics': {
          const input = GetSegmentMetricsInput.parse(args);
          const res = await client.get<any>(`/analytics/segments/${input.segment_id}`, { window: input.window });
          return { content: [{ type: 'text', text: `Segment ${input.segment_id} metrics (${input.window}):\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'get_user_analytics': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetUserAnalyticsInput.parse(args);
          const res = await client.get<any>(`/api/analytics/users/${encodeURIComponent(input.user_id)}`, {
            window: input.window,
            context_id: input.context_id,
          });
          return { content: [{ type: 'text', text: formatUserAnalytics(res, input.user_id) }] };
        }

        case 'get_item_analytics': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = GetItemAnalyticsInput.parse(args);
          const res = await client.get<any>(`/api/analytics/items/${encodeURIComponent(input.item_id)}`, {
            window: input.window,
            context_id: input.context_id,
          });
          return { content: [{ type: 'text', text: formatItemAnalytics(res, input.item_id) }] };
        }

        case 'compare_items': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CompareItemsInput.parse(args);
          const res = await client.get<any>('/api/analytics/items/compare', {
            item_a: input.item_a_id,
            item_b: input.item_b_id,
            window: input.window,
            context_id: input.context_id,
          });
          return { content: [{ type: 'text', text: formatItemComparison(res) }] };
        }

        case 'top_items': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = TopItemsInput.parse(args);
          const res = await client.get<any>('/api/analytics/top-items', {
            metric: input.metric,
            event_name: input.event_name,
            event_id: input.event_id,
            window: input.window,
            context_id: input.context_id,
            limit: input.limit,
          });
          const hasPrimaryItems = Array.isArray(res?.items) && res.items.length > 0;
          if (!hasPrimaryItems && input.metric === 'events' && !input.event_name && input.event_id == null) {
            const fallbackRes = await client.get<any>('/api/analytics/top-items', {
              metric: 'served',
              window: input.window,
              context_id: input.context_id,
              limit: input.limit,
            });
            return { content: [{ type: 'text', text: formatTopItemsFallback(res, fallbackRes) }] };
          }
          return { content: [{ type: 'text', text: formatTopItems(res) }] };
        }

        // ── API Keys & Integrations ───────────────────────────────────
        case 'list_api_keys': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/api-keys');
          const keys = Array.isArray(res?.keys) ? res.keys : [];
          const text = formatList('API key(s)', keys, (k) =>
            `[id: ${k.id}] ${k.name} (${k.environment}, scopes: ${(k.scopes ?? []).join(', ')}, revoked: ${k.revoked})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'create_api_key': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CreateApiKeyInput.parse(args);
          const res = await client.post<any>('/api/api-keys', {
            name: input.name,
            environment: input.environment,
            scopes: input.scopes,
          });
          const lines = [
            '✅ API key created.',
            `⚠️  Save the full key now — it cannot be retrieved again.`,
            '',
            `Full key: ${res.fullKey ?? res.key ?? 'see response below'}`,
          ];
          return { content: [{ type: 'text', text: `${lines.join('\n')}\n\n${JSON.stringify(res, null, 2)}` }] };
        }

        case 'revoke_api_key': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = RevokeApiKeyInput.parse(args);
          await client.delete(`/api/api-keys/${input.key_id}`);
          return { content: [{ type: 'text', text: `✅ API key ${input.key_id} revoked. It will no longer authenticate.` }] };
        }

        case 'list_integrations': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const res = await client.get<any>('/api/integrations');
          const integrations = Array.isArray(res?.integrations) ? res.integrations : [];
          const text = formatList('integration(s)', integrations, (i) =>
            `[id: ${i.id}] ${i.name} (type: ${i.type ?? 'n/a'}, status: ${i.status ?? 'unknown'})`,
          );
          return { content: [{ type: 'text', text }] };
        }

        case 'list_platform_routes': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = ListPlatformRoutesInput.parse(args);
          return { content: [{ type: 'text', text: formatPlatformRoutes(input.section) }] };
        }

        case 'call_platform_api': {
          if (mode !== 'internal') return unsupportedAdminToolResponse(name, mode);
          const input = CallPlatformApiInput.parse(args);
          if (!input.path.startsWith('/api/') || !isSafePlatformApiPath(input.path)) {
            return {
              content: [{ type: 'text', text: `❌ Refusing to call unsafe path "${input.path}". Use /api/... routes returned by list_platform_routes.` }],
              isError: true,
            };
          }

          const query: Record<string, string | number | boolean | undefined> | undefined = input.query
            ? Object.fromEntries(
                Object.entries(input.query).map(([key, value]) => [
                  key,
                  value === null ? undefined : value,
                ]),
              )
            : undefined;

          let res: any;
          switch (input.method) {
            case 'GET':
              res = await client.get<any>(input.path, query);
              break;
            case 'POST':
              res = await client.post<any>(input.path, input.body ?? {});
              break;
            case 'PATCH':
              res = await client.patch<any>(input.path, input.body ?? {});
              break;
            case 'PUT':
              res = await client.put<any>(input.path, input.body ?? {});
              break;
            case 'DELETE':
              res = await client.delete<any>(input.path, input.body ?? {});
              break;
            default:
              return {
                content: [{ type: 'text', text: `❌ Unsupported method "${input.method}".` }],
                isError: true,
              };
          }

          return {
            content: [{ type: 'text', text: formatPlatformApiResponse(input.method, input.path, res) }],
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
