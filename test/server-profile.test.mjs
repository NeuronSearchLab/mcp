import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, getExportedTools, HOSTED_PROFILE_VERSION } from '../dist/server.js';

assert.equal(HOSTED_PROFILE_VERSION, 2);

async function withClient(fakeClient, profile, callback) {
  const server = createServer(fakeClient, 'internal', profile);
  const client = new Client({ name: 'server-profile-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test('hosted profile exposes first-class customer tools with explicit annotations', async () => {
  const rawHostedTools = getExportedTools('internal', 'hosted');
  for (const tool of rawHostedTools) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['admin'] }], `${tool.name} OAuth declaration`);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: 'oauth2', scopes: ['admin'] }], `${tool.name} OAuth metadata mirror`);
  }

  await withClient({}, 'hosted', async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 55);

    for (const tool of tools) {
      assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`);
      assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', `${tool.name} openWorldHint`);
      assert.equal(typeof tool.annotations?.destructiveHint, 'boolean', `${tool.name} destructiveHint`);
      assert.deepEqual(tool._meta?.securitySchemes, [{ type: 'oauth2', scopes: ['admin'] }], `${tool.name} OAuth metadata`);
    }

    const names = new Set(tools.map((tool) => tool.name));
    assert.equal(names.has('create_api_key'), false);
    assert.equal(names.has('list_platform_routes'), false);
    assert.equal(names.has('call_platform_api'), false);
    assert.equal(names.has('list_api_keys'), true);
    assert.equal(names.has('revoke_api_key'), true);
    assert.equal(names.has('delete_context'), true);
    assert.equal(names.has('get_account_plan'), true);
    assert.equal(names.has('get_recommendations'), true);
    assert.equal(names.has('get_auto_recommendations'), true);

    assert.equal(tools.find((tool) => tool.name === 'get_experiment_results')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'refresh_experiment_results')?.annotations?.readOnlyHint, false);

    for (const name of ['get_recommendations', 'get_auto_recommendations']) {
      const recommendationTool = tools.find((tool) => tool.name === name);
      assert.equal(recommendationTool?.annotations?.readOnlyHint, false, `${name} records serving attribution and metering`);
      assert.equal(recommendationTool?.annotations?.destructiveHint, false, `${name} does not delete or overwrite configuration`);
    }

    const recommendations = tools.find((tool) => tool.name === 'get_recommendations');
    assert.deepEqual(Object.keys(recommendations?.inputSchema.properties ?? {}).sort(), ['context_id', 'limit', 'surface', 'user_id']);
    assert.equal(recommendations?.inputSchema.properties?.limit?.maximum, 50);

    const autoRecommendations = tools.find((tool) => tool.name === 'get_auto_recommendations');
    assert.deepEqual(Object.keys(autoRecommendations?.inputSchema.properties ?? {}).sort(), ['context_id', 'cursor', 'limit', 'user_id', 'window_days']);
    assert.equal(autoRecommendations?.inputSchema.properties?.limit?.maximum, 50);

    const training = tools.find((tool) => tool.name === 'create_training_job');
    assert.deepEqual(training?.inputSchema.required, ['template_id']);
    assert.equal(training?.annotations?.destructiveHint, true);
  });
});

test('marketplace submission annotations match the hosted runtime profile', () => {
  const submission = JSON.parse(readFileSync(new URL('../chatgpt-app-submission.json', import.meta.url), 'utf8'));
  const runtimeTools = new Map(getExportedTools('internal', 'hosted').map((tool) => [tool.name, tool]));

  // The console layer (nsl_admin_console_next) appends these ChatGPT onboarding
  // tools to tools/list at runtime, so the marketplace form lists them even
  // though this package does not declare them.
  const CONSOLE_INJECTED_TOOLS = [
    'try_demo',
    'get_demo_recommendations',
    'record_demo_interaction',
    'start_using_my_data',
    'render_demo_recommendations',
  ];

  assert.equal(submission.$schema, 'https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json');
  assert.ok([...submission.app_info.subtitle].length <= 30, 'marketplace subtitle must be at most 30 characters');
  assert.deepEqual(
    Object.keys(submission.tools).sort(),
    [...runtimeTools.keys(), ...CONSOLE_INJECTED_TOOLS].sort(),
  );

  for (const [name, metadata] of Object.entries(submission.tools)) {
    const runtime = runtimeTools.get(name);
    if (runtime) {
      assert.deepEqual(metadata.annotations, {
        readOnlyHint: runtime.annotations?.readOnlyHint,
        openWorldHint: runtime.annotations?.openWorldHint,
        destructiveHint: runtime.annotations?.destructiveHint,
      }, `${name} submission annotations`);
    }

    // Every explicit annotation needs its own justification or the marketplace
    // submission form refuses to submit.
    assert.deepEqual(
      Object.keys(metadata.justifications ?? {}).sort(),
      ['destructive_justification', 'open_world_justification', 'read_only_justification'],
      `${name} is missing an annotation justification`,
    );
    for (const [field, text] of Object.entries(metadata.justifications)) {
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${name}.${field} must not be empty`);
    }
  }
});

test('hosted tools declare an output schema so models can read structured results', () => {
  for (const tool of getExportedTools('internal', 'hosted')) {
    assert.ok(tool.outputSchema, `${tool.name} must declare an outputSchema`);
    assert.equal(tool.outputSchema.type, 'object', `${tool.name} outputSchema must be an object schema`);
    assert.ok(
      tool.outputSchema.required?.includes('ok'),
      `${tool.name} outputSchema must require the ok field the server always sets`,
    );
  }
});

test('hosted recommendation tools use the supported tenant-scoped console bridge contract', async () => {
  const calls = [];
  const fakeClient = {
    async get(path, params) {
      calls.push(['GET', path, params]);
      return { request_id: 'req-1', recommendations: [{ item_id: 1001, score: 0.9 }] };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    const result = await client.callTool({
      name: 'get_recommendations',
      arguments: { user_id: 'chatgpt-new-user', limit: 5 },
    });
    assert.deepEqual(calls, [[
      'GET',
      '/api/recommendations',
      {
        user_id: 'chatgpt-new-user',
        context_id: undefined,
        quantity: 5,
        surface: undefined,
      },
    ]]);
    assert.match(result.content?.[0]?.text ?? '', /req-1/);
  });
});

test('hosted auto recommendations preserve section pagination response semantics', async () => {
  const calls = [];
  const fakeClient = {
    async get(path, params) {
      calls.push(['GET', path, params]);
      return {
        request_id: 'req-auto-1',
        data: [{
          id: 1001,
          item_id: 1001,
          item: { id: 1001, name: 'Item one', description: 'Current console response shape', metadata: {} },
          score: 0.9,
        }],
        section: { section_id: 'trending', title: 'Trending now' },
        next_cursor: 'cursor-2',
        done: false,
      };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    const result = await client.callTool({
      name: 'get_auto_recommendations',
      arguments: { user_id: 'viewer-1', context_id: 236, limit: 5, cursor: 'cursor-1', window_days: 14 },
    });
    assert.deepEqual(calls, [[
      'GET',
      '/api/recommendations',
      {
        mode: 'auto',
        user_id: 'viewer-1',
        context_id: 236,
        quantity: 5,
        cursor: 'cursor-1',
        window_days: 14,
      },
    ]]);
    const text = result.content?.[0]?.text ?? '';
    assert.match(text, /\[1001\] Item one/);
    assert.match(text, /Section: "Trending now" \(id: trending\)/);
    assert.match(text, /next_cursor: "cursor-2"/);
    assert.match(text, /done: false/);
  });
});

test('hosted auto recommendations report terminal empty sections as done', async () => {
  const fakeClient = {
    async get() {
      return { request_id: 'req-auto-done', data: [], section: null, next_cursor: null, done: true };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    const result = await client.callTool({
      name: 'get_auto_recommendations',
      arguments: { user_id: 'viewer-1' },
    });
    const text = result.content?.[0]?.text ?? '';
    assert.match(text, /No recommendations returned/);
    assert.match(text, /done: true/);
  });
});

test('hosted account plan tool reports resolved limits and exact cleanup targets', async () => {
  const calls = [];
  const fakeClient = {
    async get(path) {
      calls.push(['GET', path]);
      return {
        plan: 'basic',
        plans: [{ id: 'basic', name: 'Basic' }],
        limits: {
          resources: {
            pipelines: 2,
            contexts: 5,
            eventTypes: 10,
            apiKeys: 5,
            activeModelEndpoints: -1,
          },
          metered: {
            requests: { included: 25000, enabled: true },
            training: { included: 0, enabled: false },
          },
        },
        usage: {
          resources: {
            pipelines: 2,
            contexts: 9,
            eventTypes: 17,
            apiKeys: 5,
            activeModelEndpoints: 3,
          },
          metered: {
            requests: { included_used: 1200, overage_used: 0 },
            training: { included_used: 0, overage_used: 0 },
          },
          period: {
            start: '2026-08-01T00:00:00.000Z',
            end: '2026-09-01T00:00:00.000Z',
          },
        },
      };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    const result = await client.callTool({ name: 'get_account_plan', arguments: {} });
    assert.deepEqual(calls, [['GET', '/api/tier/limits']]);
    const text = result.content?.[0]?.text ?? '';
    assert.match(text, /Current plan: Basic \(basic\)/);
    assert.match(text, /Contexts \[contexts\]: 9 \/ 5 — OVER LIMIT by 4/);
    assert.match(text, /Event types \[eventTypes\]: 17 \/ 10 — OVER LIMIT by 7/);
    assert.match(text, /Active API keys \[apiKeys\]: 5 \/ 5 — at limit/);
    assert.match(text, /activeModelEndpoints\]: 3 \/ unlimited — within limit/);
    assert.match(text, /contexts: reduce by at least 4 \(target 5 or fewer\)/);
    assert.match(text, /eventTypes: reduce by at least 7 \(target 10 or fewer\)/);
  });
});

test('hosted context deletion calls the tenant-scoped platform route', async () => {
  const calls = [];
  const fakeClient = {
    async delete(path) {
      calls.push(['DELETE', path]);
      return {
        ok: true,
        deleted: { context_id: 17, pipelines: 1, rules: 2, feed_blueprints: 1 },
      };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    const result = await client.callTool({
      name: 'delete_context',
      arguments: { context_id: 17 },
    });
    assert.deepEqual(calls, [['DELETE', '/api/context/17']]);
    const text = result.content?.[0]?.text ?? '';
    assert.match(text, /Context 17 deleted/);
    assert.match(text, /1 pipeline\(s\), 2 rule\(s\), 1 feed blueprint\(s\)/);
  });
});

test('default internal profile retains trusted local-only tools', async () => {
  await withClient({}, 'default', async (client) => {
    const tools = (await client.listTools()).tools;
    const names = new Set(tools.map((tool) => tool.name));
    assert.equal(names.has('create_api_key'), true);
    assert.equal(names.has('list_platform_routes'), true);
    assert.equal(names.has('call_platform_api'), true);
    assert.equal(tools.some((tool) => tool._meta?.securitySchemes), false);
    assert.equal(tools.find((tool) => tool.name === 'get_recommendations')?.inputSchema.properties?.surface?.type, 'string');
    assert.equal(tools.find((tool) => tool.name === 'get_auto_recommendations')?.inputSchema.properties?.cursor?.type, 'string');
    assert.equal(tools.find((tool) => tool.name === 'get_auto_recommendations')?.inputSchema.properties?.window_days?.type, 'number');
  });
});

test('experiment result reads do not refresh metrics unless explicitly requested', async () => {
  const calls = [];
  const fakeClient = {
    async get(path) {
      calls.push(['GET', path]);
      return { experiment: { id: 7, metrics: [] } };
    },
    async post(path) {
      calls.push(['POST', path]);
      return { ok: true };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    await client.callTool({ name: 'get_experiment_results', arguments: { experiment_id: 7 } });
    assert.deepEqual(calls, [['GET', '/api/experiments/7']]);

    calls.length = 0;
    await client.callTool({ name: 'refresh_experiment_results', arguments: { experiment_id: 7 } });
    assert.deepEqual(calls, [
      ['POST', '/api/experiments/7/metrics'],
      ['GET', '/api/experiments/7'],
    ]);
  });
});

test('training tools keep infrastructure identifiers out of customer-facing output', async () => {
  const fakeClient = {
    async get() {
      return {
        jobs: [{
          id: 42,
          status: 'Started',
          execution_arn: 'arn:aws:states:private',
          logs: ['private log line'],
          sageMaker: { trainingJobArn: 'arn:aws:sagemaker:private' },
        }],
      };
    },
    async post(path) {
      if (path === '/api/training/start') {
        return { ok: true, jobId: 42, executionArn: 'arn:aws:states:private' };
      }
      return { success: true };
    },
  };

  await withClient(fakeClient, 'hosted', async (client) => {
    const details = await client.callTool({ name: 'get_training_job', arguments: { job_id: '42' } });
    const detailsText = details.content?.[0]?.text ?? '';
    assert.match(detailsText, /"id": 42/);
    assert.doesNotMatch(detailsText, /arn:aws|private log/);

    const started = await client.callTool({
      name: 'create_training_job',
      arguments: { template_id: 9 },
    });
    const startedText = started.content?.[0]?.text ?? '';
    assert.match(startedText, /Job ID: 42/);
    assert.doesNotMatch(startedText, /arn:aws/);
  });
});
