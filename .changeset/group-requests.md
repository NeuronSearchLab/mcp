---
"@neuronsearchlab/mcp": minor
---

`get_recommendation_sets` takes `group_id` (and a per-rail `limit`) to serve every rail of a context group: each rail comes back under its context key, in the group's order, with the group's rules. `sets` becomes optional with a group; a set without a key adjusts the group's rail for that context.
