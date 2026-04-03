# @neuronsearchlab/mcp

MCP (Model Context Protocol) server for [NeuronSearchLab](https://neuronsearchlab.com). Gives any MCP-compatible AI client (Claude Desktop, Cursor, Windsurf, etc.) direct access to your recommendation engine — no HTTP wrangling, no token management, just natural language.

```
"Get 5 recommendations for user alice@example.com"
"Why did item prod-456 rank first for bob?"
"Add a new product to the catalogue — ID: prod-123, name: Running Shoes..."
"Track a click event for alice on item prod-123 from request abc-xyz"
```

---

## Tools

| Tool | Description |
|------|-------------|
| `get_recommendations` | Fetch personalised recommendations for a user |
| `get_auto_recommendations` | Auto-sectioned feed with pagination (infinite scroll) |
| `track_event` | Record a user interaction (click, view, purchase, etc.) |
| `upsert_item` | Add or update a catalogue item |
| `patch_item` | Partially update an item (enable/disable, change fields) |
| `delete_items` | Permanently remove items from the catalogue |
| `search_items` | Search the catalogue by keyword |
| `explain_ranking` | Explain why an item ranked where it did for a user |

---

## Quickstart

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

Restart Claude Desktop. You'll see a 🔌 **neuronsearchlab** indicator in the toolbar when it's connected.

### 3. Cursor / other MCP clients

Follow your client's MCP server guide. The command is:

```
npx @neuronsearchlab/mcp
```

Set env vars `NSL_CLIENT_ID` and `NSL_CLIENT_SECRET`.

---

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NSL_CLIENT_ID` | ✅ | — | OAuth client ID from the console |
| `NSL_CLIENT_SECRET` | ✅ | — | OAuth client secret from the console |
| `NSL_TOKEN_URL` | No | `https://auth.neuronsearchlab.com/oauth2/token` | Token endpoint |
| `NSL_API_BASE_URL` | No | `https://api.neuronsearchlab.com` | API base URL |
| `NSL_TIMEOUT_MS` | No | `15000` | Request timeout in milliseconds |

---

## Tool reference

### `get_recommendations`

Fetch personalised recommendations for a user. Returns ranked items with scores and a `request_id` for attribution.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | ✅ | User identifier (UUID, email, or any stable string) |
| `context_id` | string | No | Context ID from the console — controls filters, grouping, and quantity defaults |
| `limit` | integer 1–200 | No | Number of items to return (defaults to context value, usually 20) |
| `surface` | string | No | Rerank surface override (e.g. `"homepage"`, `"sidebar"`) |

**Example**
```
Get 10 recommendations for user alice@example.com using context homepage-feed
```

**Response format**
```
✅ 10 recommendation(s) for user:
   request_id: ae5ef21b-077a-416f-96af-55d1f99e0bf0  ← pass to track_event
   processing_time: 220ms

1. [prod-123] Running Shoes (score: 0.8741)
   Lightweight trail running shoes with breathable mesh upper...
   metadata: { category="footwear", price=89.99 }
2. [prod-456] Trail Jacket (score: 0.8612)
   ...
```

---

### `get_auto_recommendations`

Fetch the next auto-generated section for a user's feed. Designed for infinite-scroll — each call returns one curated section (e.g. *"Trending this week"*, *"New for you"*) plus a cursor for the next section. Call until `done: true`.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | ✅ | User identifier |
| `context_id` | string | No | Optional context ID |
| `limit` | integer 1–200 | No | Items per section |
| `cursor` | string | No | Pagination cursor from the previous response |
| `window_days` | integer | No | Days to look back for "new" content |

**Example**
```
Get the next section of the feed for user bob, continuing from cursor eyJ2IjoxL...
```

---

### `track_event`

Record a user interaction. Always pass `request_id` from the recommendations response to enable click-through attribution — it's what closes the feedback loop and improves personalisation.

Event IDs are configured in the admin console under **Events**.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | integer | ✅ | Numeric event type ID from the admin console |
| `user_id` | string | ✅ | User who triggered the event |
| `item_id` | string | ✅ | Item that was interacted with |
| `request_id` | string | No | `request_id` from the recommendations response (for attribution) |
| `session_id` | string | No | Session identifier for grouping events within a visit |

**Example**
```
Track a click event — user alice clicked item prod-123 from recommendation request ae5ef21b-077a
```

---

### `upsert_item`

Add or update an item in the catalogue. The `description` field is used to generate the embedding — write it to be rich and descriptive to improve match quality.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string (UUID) | ✅ | Unique item identifier |
| `name` | string | ✅ | Display name |
| `description` | string | ✅ | Rich description for embedding generation |
| `metadata` | object | No | Arbitrary key-value pairs (category, price, tags) returned with recommendations |

**Example**
```
Add an item — ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890, name: "Trail Running Shoes",
description: "Lightweight trail running shoes with breathable mesh upper, responsive foam
midsole, and Vibram outsole. Ideal for 5K to marathon distances on technical terrain.",
metadata: { category: "footwear", price: 129.99, brand: "Salomon" }
```

> 💡 **Tip:** The richer the description, the better the embedding — include category, attributes, use-case, and audience alongside the product copy.

---

### `patch_item`

Partially update an existing catalogue item. Most commonly used to enable or disable items without re-uploading the full entry.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | ✅ | Item to update |
| `active` | boolean | No | `false` to exclude from recommendations without deleting |
| *(any other field)* | any | No | Additional fields to update |

**Example**
```
Disable item prod-123 — set active to false
```

---

### `delete_items`

Permanently remove items from the catalogue. **Cannot be undone.** To temporarily exclude items, use `patch_item` with `active: false`.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_ids` | string[] (max 100) | ✅ | Item IDs to delete |

**Example**
```
Delete items prod-999 and prod-998 from the catalogue
```

---

### `search_items`

Search the catalogue by keyword. Returns item IDs, names, descriptions, and status.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | ✅ | Text to search for |
| `limit` | integer 1–100 | No | Max results (default 20) |

**Example**
```
Search the catalogue for "running shoes"
```

---

### `explain_ranking`

Explain why a specific item was ranked at a given position for a user. Returns a score breakdown, applied rules, and a pipeline trace.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | ✅ | Item to explain |
| `user_id` | string | No | User to score against (omit for a neutral baseline) |
| `context_id` | string | No | Context ID to apply scoring rules from |

**Example**
```
Why did item prod-456 rank first for user bob@example.com?
```

**Response format**
```
📊 Ranking explanation for item: prod-456
   User: bob@example.com

Final score: 0.9124

─── Score breakdown ───
  embedding_similarity: 0.8741
  rule_boost: 0.0383

─── Applied rules ───
  ✅ matched  Category boost (boost)
  ⬜ no match Recent purchase filter (filter)

─── Pipeline trace ───
  ✅ candidate_retrieval: passed
  ✅ embedding_score: passed
  ✅ rule_engine: passed
  ✅ rerank: passed
```

---

## Authentication

The server uses [OAuth 2.0 Client Credentials](https://console.neuronsearchlab.com/security) — no user login required. Tokens are fetched automatically on startup, cached in memory, and refreshed 60 seconds before expiry. Concurrent refresh calls are deduplicated (a single in-flight request is shared).

If authentication fails on startup, the server exits immediately with a clear error message — no silent failures.

---

## Development

```bash
git clone https://github.com/NeuronSearchLab/mcp
cd mcp
npm install
```

Set credentials:
```bash
export NSL_CLIENT_ID=your-client-id
export NSL_CLIENT_SECRET=your-client-secret
```

Run in dev mode (tsx, no build step):
```bash
npm run dev
```

Build:
```bash
npm run build          # compiles TypeScript to dist/
node dist/index.js     # run the built server
```

---

## Test results

See [`docs/test-results.md`](docs/test-results.md) for live test output against the production API.

---

## License

MIT
