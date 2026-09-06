# 1. Flat tags with a relation graph instead of nested tags

## Status

Accepted

## Context

Obsidian supports nested tags (`#area/health/running`), and the built-in Tags view renders them as a hierarchy. Nesting is the default way people encode "these tags are related" in Obsidian today.

Nesting has a real cost, which is what motivated this plugin in the first place:

- A tag can only live in one place in the tree. `#running` can be filed under `#area/health` or under `#hobby`, but not related to both without duplicating it or picking one parent arbitrarily.
- Relations in the real world are rarely a strict tree. `#running` relates to `#health`, `#outdoors`, and `#gear` at once — a parent-child model cannot express that without contorting the tag names.
- Renaming or reorganizing a hierarchy means renaming every nested tag under it across every note, which Obsidian will do for you, but it is still a destructive, vault-wide edit for what is conceptually just "I want to think about this differently now."
- The hierarchy is baked into the tag's name. It cannot be viewed one way for one purpose and another way for another purpose.

The request behind this plugin was explicit: keep tags flat, and get the organizational benefit of nesting (browsing by relation, seeing what's connected) through a separate tool instead.

## Decision

The plugin treats every tag as flat — it never reads or writes nested-tag syntax as structure. Relations between tags are stored and computed entirely outside tag names, in a graph built and owned by the plugin (`src/graph.ts`). Nodes are tags; edges are relations with a computed strength. Nothing about a tag's name implies a relation to another tag.

Where a vault already contains nested tags (migration is gradual, not everyone will rename on day one), the plugin optionally draws an edge from `#a/b` to `#a` so the existing hierarchy remains visible inside the same relation graph, controlled by the "Relate nested tags to their parent" setting. This is a compatibility bridge, not an endorsement of nesting — it lets a vault stop adding new nested tags without losing what it already has until it's cleaned up.

## Consequences

- Reorganizing how tags relate to each other is a graph edit (add/remove a relation), not a vault-wide rename. It never touches note content.
- A tag can be related to any number of other tags with no "primary parent" constraint.
- The plugin cannot infer structure Obsidian doesn't expose. It has no notion of a tag's "true" category — only what notes and manual connections say. Two tags that should obviously be related but never co-occur and were never manually connected will show as unrelated. This is expected: it's a prompt to add the manual connection, not a bug.
- Because relations live in the plugin's own data (`data.json`) rather than in note content, they are not visible to other tools that only read the vault's Markdown (e.g., other tag plugins, or Obsidian's own core Tags pane). This plugin is additive, not a replacement for the core tag system.
