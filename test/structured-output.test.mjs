import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, getExportedTools } from '../dist/server.js';

// A stand-in platform API. Paths are matched most-specific first so that, for
// example, /api/analytics/items/compare does not fall through to the per-item
// analytics route.
function fakePlatformResponse(path) {
  const routes = [
    ['/api/events/event-types', () => [{ event_id: 7, event_name: 'click', value: 50, event_count: 3 }]],
    ['/api/recommendations', () => ({
      request_id: 'req-1',
      processing_time_ms: 12,
      recommendations: [{ item_id: 1001, name: 'Item', description: 'A test item', score: 0.91, metadata: { category: 'x' } }],
      section: { section_id: 1, title: 'Because you watched' },
      next_cursor: 'cursor-2',
    })],
    ['/api/items/search', () => ({ total: 1, items: [{ entity_id: 1001, name: 'Item', description: 'A test item', active: true }] })],
    ['/api/explain', () => ({ explanation: { final_score: 0.42, breakdown: { similarity: 0.4 }, applied_rules: [], pipeline_stages: [] } })],
    ['/api/tier/limits', () => ({ plan: 'pro', limits: { items: 100000 }, usage: { items: 12 } })],
    ['/api/context/create', () => ({ id: 2, context_name: 'New' })],
    ['/api/context', () => ({ contexts: [{ id: 1, name: 'Ctx', context_name: 'Ctx', context_type: 'homepage_feed' }] })],
    ['/api/pipelines', () => ({ pipeline: { id: 1, name: 'P', context_id: 1, is_active: true, stages: [] }, pipelines: [{ id: 1, name: 'P', context_id: 1, is_active: true }] })],
    ['/api/rules', () => ({ rule: { id: 1, name: 'R' }, rules: [{ id: 1, name: 'R', rule_type: 'boost', is_active: true, context_id: 1 }] })],
    ['/api/segments', () => ({ segment: { id: 1, name: 'S' }, segments: [{ id: 1, name: 'S', is_active: true }] })],
    ['/api/experiments', () => ({ experiment: { id: 1, name: 'E', status: 'draft', variants: [] }, experiments: [{ id: 1, name: 'E', status: 'draft' }] })],
    ['/api/training/start', () => ({ jobId: 'job-2' })],
    ['/api/training-jobs/stop', () => ({ stopped: true })],
    ['/api/training-jobs', () => ({ jobs: [{ id: 'job-1', status: 'running', created_at: '2026-01-01', execution_arn: 'arn:aws:states:::execution/1' }] })],
    ['/api/analytics/items/compare', () => ({ item_a: { events: 5 }, item_b: { events: 3 } })],
    ['/api/analytics/top-items', () => ({ items: [{ entity_id: 1001, name: 'Item', count: 5 }] })],
    ['/api/analytics/users/', () => ({ events: 3, last_seen: '2026-01-01' })],
    ['/api/analytics/items/', () => ({ events: 2, served: 9 })],
    ['/api/analytics', () => ({ preset: '7d', totals: { served: 10, click: 2 } })],
    ['/api/api-keys', () => ({ keys: [{ id: 1, name: 'k', environment: 'production', scopes: ['admin'], revoked: false }] })],
    ['/api/integrations', () => ({ integrations: [{ id: 1, name: 'Shopify', type: 'feed', status: 'connected' }] })],
    // Public API surface used by the npm package's non-hosted tools.
    ['/campaigns', () => [{ id: 1, name: 'Sale', is_active: true, start_date: '2026-01-01', end_date: '2026-02-01' }]],
    ['/events', () => ({ event_id: 7, accepted: true })],
    ['/items/search', () => ({ total: 1, items: [{ entity_id: 1001, name: 'Item', active: true }] })],
    ['/items', () => ({ item_id: 1001, name: 'Item' })],
    ['/analytics/experiments/', () => ({ variants: [] })],
    ['/analytics/segments/', () => ({ users: 12 })],
  ];
  const match = routes.find(([prefix]) => path.startsWith(prefix));
  return match ? match[1]() : {};
}

const fakeClient = {
  async get(path) { return fakePlatformResponse(path); },
  async post(path) { return fakePlatformResponse(path); },
  async patch(path) { return fakePlatformResponse(path); },
  async put(path) { return fakePlatformResponse(path); },
  async delete(path) {
    if (path.startsWith('/api/context/')) return { deleted: { pipelines: 1, rules: 2, feed_blueprints: 0 } };
    return fakePlatformResponse(path);
  },
};

const TOOL_ARGUMENTS = {
  get_recommendations: { user_id: 'u1' },
  get_auto_recommendations: { user_id: 'u1' },
  search_items: { query: 'shoe' },
  explain_ranking: { item_id: 1001 },
  get_account_plan: {},
  list_contexts: {},
  get_context: { context_id: 1 },
  create_context: { context_name: 'New context' },
  update_context: { context_id: 1, context_name: 'Renamed' },
  delete_context: { context_id: 1 },
  list_pipelines: {},
  get_pipeline: { pipeline_id: 1 },
  create_pipeline: { name: 'P' },
  update_pipeline: { pipeline_id: 1, name: 'P2' },
  delete_pipeline: { pipeline_id: 1 },
  activate_pipeline: { pipeline_id: 1 },
  deactivate_pipeline: { pipeline_id: 1 },
  clone_pipeline: { pipeline_id: 1, name: 'P copy' },
  list_rules: {},
  get_rule: { rule_id: 1 },
  create_rule: {
    name: 'R',
    rule_type: 'boost',
    conditions: [{ field: 'category', operator: 'equals', value: 'shoes' }],
    actions: { type: 'boost', weight: 1.5 },
  },
  update_rule: { rule_id: 1, name: 'R2' },
  delete_rule: { rule_id: 1 },
  toggle_rule: { rule_id: 1, is_active: false },
  enable_rule: { rule_id: 1 },
  disable_rule: { rule_id: 1 },
  list_segments: {},
  get_segment: { segment_id: 1 },
  create_segment: { name: 'S', conditions: [{ field: 'purchases', operator: 'greater_than', value: 3 }] },
  update_segment: { segment_id: 1, name: 'S2' },
  delete_segment: { segment_id: 1 },
  list_experiments: {},
  get_experiment: { experiment_id: 1 },
  create_experiment: {
    name: 'E',
    variants: [
      { id: 'control', name: 'Control', traffic_fraction: 0.5 },
      { id: 'treatment', name: 'Treatment', traffic_fraction: 0.5 },
    ],
  },
  update_experiment: { experiment_id: 1, name: 'E2' },
  start_experiment: { experiment_id: 1 },
  stop_experiment: { experiment_id: 1 },
  get_experiment_results: { experiment_id: 1 },
  refresh_experiment_results: { experiment_id: 1 },
  list_training_jobs: {},
  get_training_job: { job_id: 'job-1' },
  create_training_job: { template_id: 1 },
  cancel_training_job: { job_id: 'job-1' },
  get_ranking_metrics: { window: '7d' },
  get_user_analytics: { user_id: 'u1' },
  get_item_analytics: { item_id: 1001 },
  compare_items: { item_a_id: 1001, item_b_id: 1002 },
  top_items: { metric: 'served' },
  list_api_keys: {},
  revoke_api_key: { key_id: 1 },
  list_integrations: {},
  list_event_types: {},
  create_event_type: { event_name: 'click', value: 50 },
  update_event_type: { event_id: 7, event_name: 'click', value: 60 },
  delete_event_type: { event_id: 7 },
};

// The MCP client validates structuredContent against each tool's outputSchema
// and throws when it is missing or invalid, so calling every tool here is the
// real guard against a schema that the handler cannot satisfy.
test('every hosted tool returns structured content matching its output schema', async () => {
  const hostedTools = getExportedTools('internal', 'hosted').map((tool) => tool.name);
  assert.deepEqual(
    hostedTools.filter((name) => !(name in TOOL_ARGUMENTS)),
    [],
    'every hosted tool needs sample arguments in this test',
  );

  const server = createServer(fakeClient, 'internal', 'hosted');
  const client = new Client({ name: 'structured-output-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    for (const name of hostedTools) {
      const result = await client.callTool({ name, arguments: TOOL_ARGUMENTS[name] });
      assert.equal(result.isError, undefined, `${name} returned an error: ${result.content?.[0]?.text}`);
      assert.equal(result.structuredContent?.ok, true, `${name} must report ok`);
      assert.ok(result.content?.[0]?.text, `${name} must keep its human-readable text`);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

// Tools the npm package exposes beyond the hosted ChatGPT profile. They declare
// output schemas too, so they get the same round-trip validation.
const PACKAGE_ONLY_ARGUMENTS = {
  track_event: { event_id: 7, user_id: 'u1', item_id: 1001 },
  upsert_item: { name: 'Item', description: 'A rich description for embedding.' },
  patch_item: { item_id: 1001, active: false },
  delete_items: { item_ids: [1001] },
  list_campaigns: {},
  get_campaign: { campaign_id: 1 },
  create_campaign: { name: 'Sale', start_date: '2026-01-01', end_date: '2026-02-01' },
  update_campaign: { campaign_id: 1, name: 'Bigger sale' },
  delete_campaign: { campaign_id: 1 },
  activate_campaign: { campaign_id: 1 },
  pause_campaign: { campaign_id: 1 },
  get_experiment_metrics: { experiment_id: 1 },
  get_segment_metrics: { segment_id: 1, window: '7d' },
  create_api_key: { name: 'k', environment: 'production', scopes: ['admin'] },
  list_platform_routes: {},
  call_platform_api: { method: 'GET', path: '/api/context' },
};

test('package-only tools with an output schema also return valid structured content', async () => {
  const server = createServer(fakeClient, 'internal', 'default');
  const client = new Client({ name: 'structured-output-default-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    for (const [name, args] of Object.entries(PACKAGE_ONLY_ARGUMENTS)) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, `${name} returned an error: ${result.content?.[0]?.text}`);
      assert.equal(result.structuredContent?.ok, true, `${name} must report ok`);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
