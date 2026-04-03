#!/usr/bin/env node
/**
 * NeuronSearchLab MCP Server
 *
 * Exposes NeuronSearchLab recommendations, events, and catalogue management
 * as MCP tools that any MCP-compatible client (Claude Desktop, Cursor, etc.) can call.
 *
 * Configuration via environment variables:
 *
 *   NSL_CLIENT_ID      — OAuth client ID (required)
 *   NSL_CLIENT_SECRET  — OAuth client secret (required)
 *   NSL_TOKEN_URL      — Token endpoint (default: https://api.neuronsearchlab.com/auth/token)
 *   NSL_API_BASE_URL   — API base URL (default: https://api.neuronsearchlab.com/v1)
 *   NSL_TIMEOUT_MS     — Request timeout in ms (default: 15000)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TokenManager } from './auth.js';
import { NeuronClient } from './client.js';
import { createServer } from './server.js';
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        process.stderr.write(`[neuronsearchlab-mcp] Missing required environment variable: ${name}\n` +
            `  Generate credentials at: https://console.neuronsearchlab.com/security\n`);
        process.exit(1);
    }
    return value;
}
async function main() {
    const clientId = requireEnv('NSL_CLIENT_ID');
    const clientSecret = requireEnv('NSL_CLIENT_SECRET');
    const tokenUrl = process.env.NSL_TOKEN_URL;
    const apiBase = process.env.NSL_API_BASE_URL;
    const timeoutMs = process.env.NSL_TIMEOUT_MS ? Number(process.env.NSL_TIMEOUT_MS) : undefined;
    const tokenManager = new TokenManager(clientId, clientSecret, tokenUrl);
    const client = new NeuronClient({ tokenManager, apiBase, timeoutMs });
    const server = createServer(client);
    const transport = new StdioServerTransport();
    // Warm up: fetch a token on startup to surface auth errors early
    try {
        await tokenManager.getToken();
        process.stderr.write('[neuronsearchlab-mcp] Authenticated ✅\n');
    }
    catch (err) {
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
//# sourceMappingURL=index.js.map