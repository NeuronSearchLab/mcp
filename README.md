# @neuronsearchlab/mcp

MCP (Model Context Protocol) server for [NeuronSearchLab](https://neuronsearchlab.com). Gives any MCP-compatible AI client (Claude Desktop, Cursor, Windsurf, etc.) direct access to your recommendation engine and platform configuration — no HTTP wrangling, no token management, just natural language.

```
"Get 5 recommendations for user alice@example.com"
"Create a new context called Twitter Feed"
"Add a pin rule so Nike items always appear in the top 3"
"Why did item prod-456 rank first for bob?"
```

---

## Tools

### API tools

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

### Platform management tools

| Tool | Description |
|------|-------------|
| `list_contexts` | List all recommendation contexts (feeds) |
| `create_context` | Create a new recommendation context |
| `update_context` | Update an existing context |
| `delete_context` | Delete a context and its associated pipelines/rules |
| `list_pipelines` | List all ranking pipelines |
| `create_pipeline` | Create a new ranking pipeline |
| `update_pipeline` | Update an existing pipeline |
| `delete_pipeline` | Delete a ranking pipeline |
| `list_rules` | List ranking rules (optionally by context) |
| `create_rule` | Create a ranking rule (boost, bury, pin, filter, cap, diversity) |
| `update_rule` | Update an existing rule |
| `delete_rule` | Delete a ranking rule |
| `toggle_rule` | Enable or disable a rule |

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
| `NSL_CLIENT_ID` | Yes | — | OAuth client ID from the console |
| `NSL_CLIENT_SECRET` | Yes | — | OAuth client secret from the console |
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
| `user_id` | string | Yes | User identifier (UUID, email, or any stable string) |
| `context_id` | string | No | Context ID from the console — controls filters, grouping, and quantity defaults |
| `limit` | integer 1–200 | No | Number of items to return (defaults to context value, usually 20) |
| `surface` | string | No | Rerank surface override (e.g. `"homepage"`, `"sidebar"`) |

**Example**
```
Get 10 recommendations for user alice@example.com using context homepage-feed
```

---

### `get_auto_recommendations`

Fetch the next auto-generated section for a user's feed. Designed for infinite-scroll — each call returns one curated section (e.g. *"Trending this week"*, *"New for you"*) plus a cursor for the next section. Call until `done: true`.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | User identifier |
| `context_id` | string | No | Optional context ID |
| `limit` | integer 1–200 | No | Items per section |
| `cursor` | string | No | Pagination cursor from the previous response |
| `window_days` | integer | No | Days to look back for "new" content |

---

### `track_event`

Record a user interaction. Always pass `request_id` from the recommendations response to enable click-through attribution.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | integer | Yes | Numeric event type ID from the admin console |
| `user_id` | string | Yes | User who triggered the event |
| `item_id` | string | Yes | Item that was interacted with |
| `request_id` | string | No | `request_id` from the recommendations response (for attribution) |
| `session_id` | string | No | Session identifier for grouping events within a visit |

---

### `upsert_item`

Add or update an item in the catalogue. The `description` field is used to generate the embedding — write it to be rich and descriptive.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | Yes | Unique item identifier |
| `name` | string | Yes | Display name |
| `description` | string | Yes | Rich description for embedding generation |
| `metadata` | object | No | Arbitrary key-value pairs returned with recommendations |

---

### `patch_item`

Partially update an existing catalogue item.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | Yes | Item to update |
| `active` | boolean | No | `false` to exclude from recommendations without deleting |

---

### `delete_items`

Permanently remove items. **Cannot be undone.** To temporarily exclude, use `patch_item` with `active: false`.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_ids` | string[] (max 100) | Yes | Item IDs to delete |

---

### `search_items`

Search the catalogue by keyword.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Text to search for |
| `limit` | integer 1–100 | No | Max results (default 20) |

---

### `explain_ranking`

Explain why a specific item was ranked at a given position for a user. Returns score breakdown, applied rules, and pipeline trace.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | Yes | Item to explain |
| `user_id` | string | No | User to score against (omit for neutral baseline) |
| `context_id` | string | No | Context ID to apply scoring rules from |

---

### `list_contexts`

List all recommendation contexts (feeds) configured for your team.

**Inputs** — none

---

### `create_context`

Create a new recommendation context.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `context_name` | string | Yes | Display name (e.g. "Twitter Feed") |
| `context_key` | string | No | URL-safe key (auto-derived from name) |
| `context_type` | enum | No | `homepage_feed`, `you_may_also_like`, `item_detail_related`, `search_assist`, `campaign_merchandising`. Default: `homepage_feed` |
| `description` | string | No | Optional description |
| `recommendation_type` | enum | No | `item_to_item`, `item_to_user`, `user_to_item`, `user_to_user`. Default: `user_to_item` |

**Example**
```
Create a new context called "Twitter Feed" with type homepage_feed
```

---

### `update_context`

Update an existing context.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `context_id` | integer | Yes | The context ID to update |
| `context_name` | string | No | New display name |
| `context_type` | enum | No | New context type |
| `description` | string | No | New description |
| `recommendation_type` | enum | No | New recommendation type |

---

### `delete_context`

Delete a context and its associated pipelines and rules.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `context_id` | integer | Yes | The context ID to delete |

---

### `list_pipelines`

List all ranking pipelines.

**Inputs** — none

---

### `create_pipeline`

Create a new ranking pipeline with default stages.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Pipeline name |
| `description` | string | No | Optional description |
| `context_id` | integer | No | Context to attach this pipeline to |
| `is_active` | boolean | No | Default: `true` |

---

### `update_pipeline` / `delete_pipeline`

Update or delete a pipeline by `pipeline_id`.

---

### `list_rules`

List ranking rules, optionally filtered by `context_id`.

---

### `create_rule`

Create a ranking rule. Rule types:

| Type | Effect |
|------|--------|
| `boost` | Increase matching items' scores (use `weight` 1.0–5.0) |
| `bury` | Decrease matching items' scores (use `weight` 0.0–1.0) |
| `pin` | Fix matching items at a specific position (use `pin_position`) |
| `filter` | Remove matching items from results |
| `cap` | Limit matching items to a fraction of results (use `cap_fraction`) |
| `diversity` | Spread items across a field's values (use `diversity_field`, `diversity_max`) |

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Rule display name |
| `rule_type` | enum | Yes | `boost`, `bury`, `pin`, `filter`, `cap`, `diversity` |
| `conditions` | array | Yes | `[{ field, operator, value }]` — items must match all conditions |
| `actions` | object | Yes | `{ type, weight?, pin_position?, cap_fraction?, ... }` |
| `context_id` | integer | No | Scope rule to a specific context |
| `description` | string | No | Optional description |
| `priority` | integer 0–1000 | No | Higher = evaluated first. Default: 100 |

**Example**
```
Create a pin rule called "Pin Nike" that pins items where brand equals "Nike" to position 3, scoped to context 1
```

---

### `update_rule` / `delete_rule` / `toggle_rule`

Update, delete, or enable/disable a rule by `rule_id`.

---

## Authentication

The server uses [OAuth 2.0 Client Credentials](https://console.neuronsearchlab.com/security). Tokens are fetched on startup, cached in memory, and auto-refreshed 60 seconds before expiry.

---

## Development

```bash
git clone https://github.com/NeuronSearchLab/mcp
cd mcp
npm install
export NSL_CLIENT_ID=your-client-id
export NSL_CLIENT_SECRET=your-client-secret
npm run dev           # dev mode (tsx, no build)
npm run build         # compile to dist/
```

---

## License

MIT
