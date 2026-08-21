# @neuronsearchlab/mcp

## 1.0.0

### Major Changes

- 5f91761: Require dashboard-created integer event and context IDs and NSL-generated integer item IDs across recommendation and event tools.

## 0.6.3

### Patch Changes

- Expose recommendation tools in the hosted profile with accurate write annotations, OAuth metadata, and the supported console-bridge contract; preserve auto-feed section pagination output and validate distribution manifests against their live canonical schemas.

## 0.6.2

### Patch Changes

- dded1ac: Expose a hosted `get_account_plan` tool that reports the authenticated team's effective plan, resolved limits, live usage, and exact cleanup targets for over-limit resources.

## 0.6.1

### Patch Changes

- 045d9bc: Expose the tenant-scoped `delete_context` tool in the hosted ChatGPT profile and route it to the public context deletion API.

## 0.6.0

### Minor Changes

- Add a hosted tool profile for ChatGPT plugin submission, explicit OpenAI tool annotations, safe experiment-result refresh semantics, accurate training inputs, and sanitized training outputs.

## 0.5.0

### Minor Changes

- 51fbb27: Remote-first release: tool titles and readOnly/destructive annotations on every tool, server version single-sourced from package.json, `mcpName` registry metadata, and a README rewritten around the hosted Streamable HTTP endpoint at https://console.neuronsearchlab.com/api/mcp (OAuth or API-key auth) with setup snippets for Claude, Claude Code, Codex, and Cursor.
