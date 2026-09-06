# 3. Three complementary views sharing one graph model

## Status

Accepted

## Context

The original request named three different visual metaphors, each drawn from a different existing tool: a sortable tag cloud, a TheBrain-style mind-map that re-centers and re-groups around whatever is selected, and a tree/outline view similar to Obsidian's own notes-and-links map. These are not three ways of skinning the same interaction — they answer different questions:

- The **cloud** answers "what tags exist, and which are used the most?" — a scan-everything, sorted-list kind of question.
- The **mind-map** answers "what does the neighborhood around this one tag look like, spatially?" — good for open-ended exploration where distance and clustering carry meaning.
- The **tree** answers "if I keep drilling into the strongest relation from here, where do I end up?" — a directed, one-branch-at-a-time drill-down, closer to how TheBrain's "plate" view or a file explorer works.

Building three views raised a design question: should each view own its own copy of tag/relation data (simpler per-view code, but state drifts and triple the bookkeeping), or should they share one model and differ only in rendering and interaction?

## Decision

A single `TagGraph` (`src/graph.ts`) is the only source of truth for tags and relations, built once per vault rescan and shared by all views. A narrow `ViewHost` interface (`src/host.ts`) is the sole contract each renderer is given: the graph, current settings, the current selection/filter/sort, and a small set of callbacks (`select`, `openContextMenu`, `openTagSearch`, `requestRender`). Each view is an independent `ModeRenderer` (`CloudRenderer`, `MapRenderer`, `TreeRenderer`) that reads through `ViewHost` and never touches Obsidian's API, the plugin instance, or another renderer directly.

The view shell (`src/view.ts`, `TagRelationsView`) owns selection state, the filter box, the sort dropdown, and the details/inspector panel, and swaps the active `ModeRenderer` when the user switches modes. Switching modes preserves the selection, so picking a tag in the cloud and then switching to the mind-map re-centers the map on that same tag.

## Consequences

- Adding a fourth view later (the codebase anticipates this) means implementing one more `ModeRenderer` against the existing `ViewHost` contract — it does not touch the graph, the other views, or the shell's selection handling.
- Consistent behavior across views is close to free: relation strength, manual-link styling, and the pruning thresholds are computed once in the graph and every view reflects the same numbers. There is no risk of the cloud and the mind-map disagreeing about how related two tags are.
- The `ViewHost` interface is a real constraint, not just documentation — a renderer that needs something outside it (say, direct access to a specific Obsidian API) forces a decision about whether that capability belongs on the interface for every view, or is out of scope for renderers entirely. So far nothing has needed to break this boundary.
- Selection, filter text, and sort order are shell-level concerns rather than per-view state, which is why they survive a mode switch — this was a deliberate choice to make switching views feel like changing the lens on the same question, not like opening a different tool.
