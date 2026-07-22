# @neuronsearchlab/mcp

MCP (Model Context Protocol) server for [NeuronSearchLab](https://www.neuronsearchlab.com). Gives any MCP-compatible AI client (Claude, Codex, Cursor, Windsurf, etc.) direct access to NeuronSearchLab recommendations, product/content search, catalogue operations, analytics, and platform controls.

```
"Get 5 recommendations for user alice@example.com"
"Create a new context called Twitter Feed"
"Add a pin rule so Nike items always appear in the top 3"
"Why did item prod-456 rank first for bob?"
```

Two ways to run it:

- **Hosted (recommended, no install):** `https://console.neuronsearchlab.com/api/mcp` — Streamable HTTP with OAuth sign-in or an NSL API key. Listed on the [MCP Registry](https://registry.modelcontextprotocol.io) as `com.neuronsearchlab/mcp`.
- **Local stdio via npm:** `npx -y @neuronsearchlab/mcp` in two modes — `public` (recommendations, events, catalogue via OAuth client credentials) or `internal` (admin platform via console API key).

---

## Connect to the hosted server (no install)

The hosted endpoint runs a submission-safe customer administration profile. It includes first-class tools for ranking configuration, experiments, training, analytics, catalogue inspection, API-key inventory and revocation, integrations, and event types. Every hosted tool declares its OAuth requirement and requires the authenticated team's `admin` scope. Credential creation and the arbitrary platform API fallback remain available only to trusted local/internal clients so secrets, billing actions, and unbounded API calls are not exposed in ChatGPT. Keys minted through OAuth consent appear in [console → Security](https://console.neuronsearchlab.com/security) and can be revoked there anytime.

**claude.ai / Claude Desktop** — Settings → Connectors → Add custom connector → paste `https://console.neuronsearchlab.com/api/mcp` → **Connect**, then sign in to your NeuronSearchLab console and approve the scopes.

**Claude Code**

```bash
# OAuth (browser sign-in):
claude mcp add --transport http neuronsearchlab https://console.neuronsearchlab.com/api/mcp
# …or with an API key:
claude mcp add --transport http neuronsearchlab https://console.neuronsearchlab.com/api/mcp \
  --header "Authorization: Bearer nsl_your_key"
```

**OpenAI Codex** — in `~/.codex/config.toml`:

```toml
[mcp_servers.neuronsearchlab]
url = "https://console.neuronsearchlab.com/api/mcp"
bearer_token_env_var = "NSL_API_KEY"
```

**Cursor / Windsurf / other Streamable HTTP clients**

```json
{
  "mcpServers": {
    "neuronsearchlab": {
      "url": "https://console.neuronsearchlab.com/api/mcp",
      "headers": { "Authorization": "Bearer nsl_your_key" }
    }
  }
}
```

---

## Resources

- Product site: https://www.neuronsearchlab.com
- MCP setup guide: https://docs.neuronsearchlab.com/sdk/mcp
- AI agents for recommendation operations: https://www.neuronsearchlab.com/blog/ai-agents-for-recommendation-operations
- Recommendation systems reading path: https://www.neuronsearchlab.com/blog/recommendation-systems

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

## Modes

### Public mode

Uses OAuth client credentials and the public API.

Supported:
- recommendations
- events
- catalogue operations

### Internal mode

Uses a NeuronSearchLab API key with the `admin` scope against the console API.

Currently supported:
- catalogue search and ranking debug: `search_items`, `explain_ranking`
- contexts: `list_contexts`, `create_context`, `update_context`, `get_context`
- pipelines: `list_pipelines`, `create_pipeline`, `update_pipeline`, `delete_pipeline`, `activate_pipeline`, `deactivate_pipeline`, `clone_pipeline`, `get_pipeline`
- rules: `list_rules`, `create_rule`, `update_rule`, `delete_rule`, `toggle_rule`, `enable_rule`, `disable_rule`, `get_rule`
- segments: `list_segments`, `get_segment`, `create_segment`, `update_segment`, `delete_segment`
- experiments: `list_experiments`, `get_experiment`, `create_experiment`, `update_experiment`, `start_experiment`, `stop_experiment`, `get_experiment_results`, `refresh_experiment_results`
- training: `list_training_jobs`, `get_training_job`, `create_training_job`, `cancel_training_job`
- analytics: `get_ranking_metrics`, `get_user_analytics`, `get_item_analytics`, `compare_items`, `top_items`
- event types: `list_event_types`, `create_event_type`, `update_event_type`, `delete_event_type`
- credentials and integrations: `list_api_keys`, `revoke_api_key`, `list_integrations` (`create_api_key` is local/internal only because it returns credential material)
- fallback UI coverage for trusted local/internal clients only: `list_platform_routes`, `call_platform_api`

---

## Quickstart (local stdio)

### 1. Get credentials

Generate **SDK Credentials** (OAuth 2.0 client ID + secret) from the [NeuronSearchLab console](https://console.neuronsearchlab.com/security).

### 2. Add to Claude Desktop

**Public mode** (recommendations, events, catalogue):

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

**Internal mode** (admin platform — contexts, pipelines, rules, analytics, etc.):

```json
{
  "mcpServers": {
    "neuronsearchlab": {
      "command": "npx",
      "args": ["-y", "@neuronsearchlab/mcp"],
      "env": {
        "NSL_PLATFORM_MODE": "internal",
        "NSL_API_KEY": "your-admin-api-key"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see a 🔌 **neuronsearchlab** indicator in the toolbar when it's connected.

### Try it

Once connected, use this short demo path to prove the server is useful before wiring it into a larger workflow:

1. Fetch recommendations for a known user and context.
2. Search the catalogue for a concrete product phrase.
3. Record a click event against one returned item, including the response `request_id` when available.
4. Ask for a ranking explanation on the clicked item.

```text
Get 10 recommendations for user demo-user@example.com using context homepage-feed
Search the catalogue for waterproof jackets and show the top 5 item ids
Record event type id 1 as a click for item jacket-123 from user demo-user@example.com, using the request_id from the recommendation or search response
Explain why item jacket-123 ranked first for demo-user@example.com
```

For internal mode, keep the first pass read-only:

```text
List my recommendation contexts
Show the latest ranking metrics
Compare item jacket-123 with item jacket-456
```

Next steps after the smoke test:

- create a scoped API key for the client or MCP server
- connect one real recommendation context, such as `homepage-feed`
- add request attribution to click/view events before judging ranking quality

### 3. Cursor / other MCP clients

Follow your client's MCP server guide. The command is:

```
npx @neuronsearchlab/mcp
```

Set `NSL_CLIENT_ID` + `NSL_CLIENT_SECRET` for public mode, or `NSL_PLATFORM_MODE=internal` + `NSL_API_KEY` for internal mode.

---

## Releases

This repo uses Changesets plus GitHub Actions for automated versioning and npm publishing.

- Add a changeset for any user-facing package change with `npm run changeset`
- Merge that PR into `main`
- The `release.yml` workflow opens or updates a version PR
- Merging the version PR publishes `@neuronsearchlab/mcp` to npm automatically

To enable trusted publishing, configure the package on npmjs.com to trust the `release.yml` workflow in this repository.

---

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NSL_PLATFORM_MODE` | No | `public` | `public` or `internal` |
| `NSL_CLIENT_ID` | Public mode | — | OAuth client ID from the console |
| `NSL_CLIENT_SECRET` | Public mode | — | OAuth client secret from the console |
| `NSL_API_KEY` | Internal mode | — | API key with `admin` scope |
| `NSL_TOKEN_URL` | No | `https://auth.neuronsearchlab.com/oauth2/token` | Token endpoint |
| `NSL_API_BASE_URL` | No | `https://api.neuronsearchlab.com` in public mode, `https://console.neuronsearchlab.com` in internal mode | API base URL |
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

### `update_rule` / `delete_rule` / `toggle_rule` / `enable_rule` / `disable_rule`

Update, delete, or enable/disable a rule by `rule_id`.

---

### `get_user_analytics`

Get served counts, event breakdown, unique-item activity, and click-through rate for a specific user.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | User ID or email to inspect |
| `context_id` | string | No | Scope to a specific context |
| `window` | `1d` \| `7d` \| `30d` \| `90d` | No | Time window (default `7d`) |

---

### `get_item_analytics`

Get served counts, event breakdown, watch/click counts, and click-through rate for a specific item.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | Yes | Item ID to inspect |
| `context_id` | string | No | Scope to a specific context |
| `window` | `1d` \| `7d` \| `30d` \| `90d` | No | Time window (default `7d`) |

---

### `compare_items`

Compare two items head-to-head by served count, events, clicks, and CTR over the same time window.

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_a_id` | string | Yes | First item ID |
| `item_b_id` | string | Yes | Second item ID |
| `context_id` | string | No | Scope to a specific context |
| `window` | `1d` \| `7d` \| `30d` \| `90d` | No | Time window (default `7d`) |

---

### `top_items`

List the top items by served count or by matching event activity over a time window. Use `metric="served"` for generic "top item" or "best performing" questions. Use `metric="events"` when the user explicitly names an engagement signal (e.g. watch, click, purchase).

**Inputs**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `metric` | `served` \| `events` | No | Rank by served count or event count (default `served`) |
| `event_name` | string | No | Event name filter when `metric=events` (e.g. `"watch"`, `"click"`) |
| `event_id` | integer | No | Numeric event ID filter when `metric=events` |
| `context_id` | string | No | Scope to a specific context |
| `window` | `1d` \| `7d` \| `30d` \| `90d` | No | Time window (default `7d`) |
| `limit` | integer 1–50 | No | Max items to return (default 10) |

**Example**
```
What's the top item served in the last 7 days?
Which items had the most watch events last month?
```

---

## Authentication

**Public mode** uses [OAuth 2.0 Client Credentials](https://console.neuronsearchlab.com/security). Tokens are fetched on startup, cached in memory, and auto-refreshed 60 seconds before expiry.

**Internal mode** uses a NeuronSearchLab API key with the `admin` scope. Set `NSL_API_KEY` and `NSL_PLATFORM_MODE=internal`.

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
