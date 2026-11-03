---
"@neuronsearchlab/mcp": major
---

Remove the pipeline tools (`list_pipelines`, `get_pipeline`, `create_pipeline`, `update_pipeline`, `delete_pipeline`, `activate_pipeline`, `deactivate_pipeline`, `clone_pipeline`). A context's ranking configuration is part of the context: read it with `get_context` and change it with `update_context`, which now accepts `model`, `configuration` and `configuration_enabled` and sends only the fields you pass. `recommendation_type` uses the console's types, `context_type` is derived from it, and `create_context` derives the API identifier when none is given.
