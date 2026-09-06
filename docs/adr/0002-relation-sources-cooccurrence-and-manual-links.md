# 2. Relation sources: co-occurrence metrics plus manual links

## Status

Accepted

## Context

Given ADR 0001's decision to keep tags flat and store relations in a graph, the graph needs something to populate it with. Two options were available, and they have different trade-offs:

1. **Infer relations from vault content.** Two tags that appear on the same note are, at minimum, weakly related — that co-occurrence already exists in every vault with no setup required.
2. **Let the user declare relations by hand.** The most valuable relations (`#running` belongs with `#health`) are often ones the user already knows and that co-occurrence will never surface, either because the two tags rarely land on the same note, or because a tag is brand new and has no notes yet.

Relying on only one of these was rejected:

- Co-occurrence alone cannot express a relation the user hasn't yet written a note for, and cannot be corrected when it produces a spurious link (two tags that happen to share one unrelated note).
- Manual links alone throw away the free signal already sitting in the vault, and would make the plugin useless until the user manually re-created every relation their notes already imply.

A related question was how to score the strength of a co-occurrence relation. Raw shared-note counts favor whichever tags are simply used most often, which crowds out genuine small-scale affinities (a niche tag used on 3 notes, all 3 shared with another niche tag, is a much stronger signal than 3 shared notes between two tags used 200 times each).

## Decision

Relations come from two independent sources, merged into one graph:

- **Co-occurrence (automatic).** For every pair of tags sharing a note, the plugin counts shared notes and scores strength using a configurable metric: **Jaccard** (`shared / (countA + countB − shared)`, the default), **cosine** (`shared / √(countA × countB)`), or raw co-occurrence normalized against the vault's strongest pair. Jaccard and cosine both correct for tag frequency, so a small pair of tags that always appear together outranks a large pair that merely overlaps occasionally.
- **Manual links (declared).** The user can connect any two tags explicitly via right-click → "Connect to…", the command palette, or the settings tab. A manual link always renders at full strength (`weight = 1`), is never removed by the strength/co-occurrence pruning thresholds, and can name a tag that has zero notes yet — the two tags are added to the graph as bare nodes if needed. Manual links are visually distinguished (dashed lines, a "manual" badge) so the user can tell a declared relation from an inferred one at a glance.

Both sources write into the same `TagEdge` structure, so every view (cloud, map, tree) and the details panel treat them uniformly — a view never needs to know whether an edge came from co-occurrence or from a manual link, except when deciding how to draw it.

## Consequences

- The plugin is useful immediately on an existing vault with zero configuration, because co-occurrence needs no setup.
- The user has an escape hatch for every case co-occurrence gets wrong or can't reach yet: adding a manual link is the direct replacement for what nesting used to provide.
- Two independent scoring rules must be kept consistent (e.g., pruning by minimum shared-notes or minimum weight must skip manual links, or a user's declared relation would silently vanish under aggressive settings — this is enforced in `TagGraph.pruneEdges`).
- Manual links are stored in plugin settings (`data.json`), not in note content, so they follow ADR 0001's consequence: they're invisible to tools that don't read this plugin's data.
- Choosing Jaccard as the default (rather than raw co-occurrence) means a brand-new, rarely-used tag can immediately show as strongly related to another rare tag, which matches intuition better than requiring high absolute overlap — but it also means very common tags (e.g., a daily-note tag used on hundreds of notes) will rarely show strong automatic relations to anything, since their large denominator suppresses the ratio. This is intentional: a manual link is the right tool for "this common tag matters to that one" rather than tuning the metric to force it.
