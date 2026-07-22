import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, HOSTED_PROFILE_VERSION } from '../dist/server.js';

assert.equal(HOSTED_PROFILE_VERSION, 1);

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
  await withClient({}, 'hosted', async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 51);

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

    assert.equal(tools.find((tool) => tool.name === 'get_experiment_results')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'refresh_experiment_results')?.annotations?.readOnlyHint, false);

    const training = tools.find((tool) => tool.name === 'create_training_job');
    assert.deepEqual(training?.inputSchema.required, ['template_id']);
    assert.equal(training?.annotations?.destructiveHint, true);
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
