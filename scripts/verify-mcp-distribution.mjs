#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));

const timeoutMs = Number(process.env.NSL_MCP_VERIFY_TIMEOUT_MS ?? 15000);
const registryBase = process.env.MCP_REGISTRY_URL ?? 'https://registry.modelcontextprotocol.io/v0/servers';
const hostedBase = process.env.NSL_MCP_HOSTED_BASE_URL ?? 'https://console.neuronsearchlab.com';

function withTimeout(promise, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  return Promise.resolve(promise(controller.signal)).finally(() => clearTimeout(timer));
}

async function fetchJson(url, { allowStatuses = [200], method = 'GET' } = {}) {
  const response = await withTimeout(
    signal => fetch(url, { method, signal, headers: { accept: 'application/json' } }),
    url,
  );
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!allowStatuses.includes(response.status)) {
    throw new Error(`${url} returned HTTP ${response.status}: ${String(text).slice(0, 240)}`);
  }
  return { status: response.status, body };
}

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check('npm package version', async () => {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name).replace('%40', '@')}/latest`;
  const { body } = await fetchJson(url);
  if (body.version !== pkg.version) throw new Error(`npm latest is ${body.version}, expected ${pkg.version}`);
  return `${pkg.name}@${body.version}`;
});

check('MCP registry listing', async () => {
  const url = `${registryBase}?search=${encodeURIComponent(server.name)}`;
  const { body } = await fetchJson(url);
  const matches = (body.servers ?? []).filter(entry => entry?.server?.name === server.name);
  const latest = matches.find(entry => entry?._meta?.['io.modelcontextprotocol.registry/official']?.isLatest === true) ?? matches.at(-1);
  if (!latest) throw new Error(`registry search did not return ${server.name}`);
  const listed = latest.server;
  if (listed.version !== pkg.version) throw new Error(`registry latest is ${listed.version}, expected ${pkg.version}`);
  const listedPackage = (listed.packages ?? []).find(entry => entry.identifier === pkg.name);
  if (!listedPackage) throw new Error(`registry listing does not include npm package ${pkg.name}`);
  if (listedPackage.version !== pkg.version) throw new Error(`registry npm package is ${listedPackage.version}, expected ${pkg.version}`);
  return `${listed.name}@${listed.version}`;
});

check('hosted OAuth authorization metadata', async () => {
  const { body } = await fetchJson(`${hostedBase}/.well-known/oauth-authorization-server`);
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!body?.[key]) throw new Error(`missing ${key}`);
  }
  return body.issuer;
});

check('hosted OAuth protected resource metadata', async () => {
  const { body } = await fetchJson(`${hostedBase}/.well-known/oauth-protected-resource`);
  if (body.resource !== `${hostedBase}/api/mcp`) {
    throw new Error(`resource is ${body.resource}, expected ${hostedBase}/api/mcp`);
  }
  if (!Array.isArray(body.authorization_servers) || body.authorization_servers.length === 0) {
    throw new Error('missing authorization_servers');
  }
  return body.resource;
});

check('hosted MCP endpoint rejects GET as JSON-RPC', async () => {
  const { status, body } = await fetchJson(`${hostedBase}/api/mcp`, { allowStatuses: [405] });
  if (body?.jsonrpc !== '2.0') throw new Error('expected JSON-RPC error body');
  return `HTTP ${status}`;
});

let failed = false;
for (const { name, fn } of checks) {
  try {
    const detail = await fn();
    console.log(`✓ ${name}: ${detail}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${name}: ${error?.message ?? error}`);
  }
}

if (failed) process.exit(1);
