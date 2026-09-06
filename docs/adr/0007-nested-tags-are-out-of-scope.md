# 7. Nested tags are out of scope

## Status

Accepted. Constrains [ADR 0001](0001-flat-tags-with-a-relation-graph.md) and
[ADR 0006](0006-writing-tag-edits-back-to-notes.md).

## Context

ADR 0001 chose flat tags plus a relation graph over nested tags, but it left nesting as a supported second-class citizen: the graph optionally bridges `#a/b` to `#a`, exclusions cascade to nested children, and the rename dialog offers to carry nested children along. That hedging made sense when it was unclear whether the vault would keep legacy nested tags around.

It is no longer unclear. The vault owner does not use nested tags and has stated they never will — that is the whole reason this plugin exists. Every hour spent making nested tags work well is an hour spent on a feature the only user has explicitly rejected, and every nested-tag branch is a code path that will never be exercised in practice, which makes it a place for bugs to sit undetected.

Leaving the ambiguity in place has a concrete cost beyond wasted effort: it makes nesting look like a supported dimension of the design, so future features get planned around it "for completeness", each one dragging in a code path nobody will run.

## Decision

Nested tags are explicitly out of scope for this plugin.

- **No new feature is designed around nesting.** When a proposed feature would need nested-tag semantics to be complete, that part is deliberately avoided, skipped, ignored, or mocked rather than implemented properly. This is a sanctioned shortcut, not a known gap to be fixed later.
- **Existing nested-tag handling is frozen legacy support.** The parent bridge (`linkNestedTags`), cascading exclusions, and the rename dialog's "also rename nested tags" option stay because they cost nothing and help anyone migrating away from an old nested vocabulary. They are not extended, not optimised, and not treated as a design constraint on anything new.
- **Tests do not need to cover nested-tag behaviour** beyond the handful of cases already written to prove the legacy bridge does not crash. Absent nested-tag coverage is not a coverage gap.
- A tag name containing `/` remains *valid* — the editor accepts it and the graph stores it — because rejecting it would break vaults mid-migration. Validity is not endorsement.

## Consequences

- Future work gets faster and simpler: hierarchy questions have a standing answer ("relations, not nesting") instead of being re-litigated per feature.
- The plugin is deliberately worse at nested tags than Obsidian's built-in Tags pane. That is the intended trade, and anyone who wants nested-tag management should use the core pane for it.
- Code paths that exist purely for nesting are known to be under-exercised. They are tolerated at their current size; if one ever becomes a maintenance burden or blocks a change, deleting it is preferred over extending it.
- This ADR is the thing to point at when a nested-tag feature is proposed, so the reasoning does not have to be reconstructed from scratch each time.
