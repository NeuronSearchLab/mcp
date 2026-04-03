# @neuronsearchlab/mcp

MCP (Model Context Protocol) server for [NeuronSearchLab](https://neuronsearchlab.com). Gives any MCP-compatible AI client (Claude Desktop, Cursor, etc.) direct access to your recommendation engine.

## Tools

| Tool | Description |
|------|-------------|
| `get_recommendations` | Fetch personalised recommendations for a user |
| `get_auto_recommendations` | Get auto-sectioned feed recommendations with pagination |
| `track_event` | Record a user interaction (click, view, purchase) |
| `upsert_item` | Add or update a catalogue item |
| `patch_item` | Partially update an item (e.g. enable/disable) |
| `delete_items` | Permanently remove items from the catalogue |
| `search_items` | Search the catalogue by keyword |
| `explain_ranking` | Explain why an item ranked where it did for a user |

## Setup

### 1. Get credentials

Generate **SDK Credentials** (OAuth 2.0 client ID + secret) from the [NeuronSearchLab console](https://console.neuronsearchlab.com/security).

### 2. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "neuronsearchlab": {
      "command": "npx",
      "args": ["-y", "@neuronsearchlab/mcp"],
      "env": {
        "NSL_CLIENT_ID": "your-client-id",
        "NSL_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Then restart Claude Desktop.

### 3. Add to Cursor / other MCP clients

Follow your client's MCP server configuration guide. The command is:

```
npx @neuronsearchlab/mcp
```

With env vars `NSL_CLIENT_ID` and `NSL_CLIENT_SECRET`.

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NSL_CLIENT_ID` | ✅ | — | OAuth client ID from the console |
| `NSL_CLIENT_SECRET` | ✅ | — | OAuth client secret from the console |
| `NSL_TOKEN_URL` | No | `https://auth.neuronsearchlab.com/oauth2/token` | Token endpoint (don't change unless self-hosting) |
| `NSL_API_BASE_URL` | No | `https://api.neuronsearchlab.com` | API base URL |
| `NSL_TIMEOUT_MS` | No | `15000` | Request timeout in milliseconds |

## Example usage with Claude

Once connected, you can ask Claude:

> *"Get 5 recommendations for user alice@example.com"*

> *"Add a new item to the catalogue — ID: prod-123, name: 'Running Shoes', description: 'Lightweight trail running shoes with breathable mesh upper...' with metadata category: footwear, price: 89.99"*

> *"Why was item prod-456 ranked first for user bob@example.com?"*

> *"Track a click event — user alice clicked on item prod-123 from recommendation request abc-xyz"*

## Authentication

The server uses [OAuth 2.0 client credentials](https://console.neuronsearchlab.com/security) — no user login required. Tokens are cached in memory and refreshed automatically 60 seconds before expiry.

## Development

```bash
git clone https://github.com/NeuronSearchLab/mcp
cd mcp
npm install
npm run dev
```

Set env vars before running:

```bash
export NSL_CLIENT_ID=your-client-id
export NSL_CLIENT_SECRET=your-client-secret
npm run dev
```

## License

MIT
