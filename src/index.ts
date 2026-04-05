#!/usr/bin/env node
/**
 * NeuronSearchLab MCP Server
 *
 * Exposes NeuronSearchLab tools as MCP tools that any MCP-compatible client
 * (Claude Desktop, Cursor, etc.) can call.
 *
 * Configuration via environment variables:
 *
 *   NSL_PLATFORM_MODE  — public | internal (default: public)
 *   NSL_CLIENT_ID      — OAuth client ID (public mode)
 *   NSL_CLIENT_SECRET  — OAuth client secret (public mode)
 *   NSL_API_KEY        — API key with admin scope (internal mode)
 *   NSL_TOKEN_URL      — Token endpoint (default: https://api.neuronsearchlab.com/auth/token)
 *   NSL_API_BASE_URL   — API base URL
 *   NSL_TIMEOUT_MS     — Request timeout in ms (default: 15000)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TokenManager } from './auth.js';
import { NeuronClient } from './client.js';
import { createServer } from './server.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(
      `[neuronsearchlab-mcp] Missing required environment variable: ${name}\n` +
      `  Generate credentials at: https://console.neuronsearchlab.com/security\n`
    );
    process.exit(1);
  }
  return value;
}

async function main() {
  const mode = process.env.NSL_PLATFORM_MODE === 'internal' ? 'internal' : 'public';
  const tokenUrl = process.env.NSL_TOKEN_URL;
  const apiBase = process.env.NSL_API_BASE_URL
    ?? (mode === 'internal' ? 'https://console.neuronsearchlab.com' : 'https://api.neuronsearchlab.com');
  const timeoutMs = process.env.NSL_TIMEOUT_MS ? Number(process.env.NSL_TIMEOUT_MS) : undefined;
  const tokenManager = mode === 'public'
    ? new TokenManager(
        requireEnv('NSL_CLIENT_ID'),
        requireEnv('NSL_CLIENT_SECRET'),
        tokenUrl,
      )
    : null;

  const client = mode === 'internal'
    ? new NeuronClient({
        staticToken: requireEnv('NSL_API_KEY'),
        apiBase,
        timeoutMs,
      })
    : new NeuronClient({
        tokenManager: tokenManager!,
        apiBase,
        timeoutMs,
      });
  const server = createServer(client, mode);
  const transport = new StdioServerTransport();

  // Warm up auth on startup to surface failures early
  try {
    if (mode === 'internal') {
      process.stderr.write('[neuronsearchlab-mcp] Using internal platform mode with API key auth ✅\n');
    } else {
      await tokenManager!.getToken();
      process.stderr.write('[neuronsearchlab-mcp] Authenticated ✅\n');
    }
  } catch (err: any) {
    process.stderr.write(`[neuronsearchlab-mcp] Authentication failed: ${err.message}\n`);
    process.exit(1);
  }

  await server.connect(transport);
  process.stderr.write('[neuronsearchlab-mcp] Running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[neuronsearchlab-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
