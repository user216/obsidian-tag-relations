# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-06

Initial release.

### Added

- **Tag graph engine** (`src/graph.ts`): builds a relation graph from the vault's tags, with no dependency on nested-tag syntax.
  - Relations inferred from tag co-occurrence on the same note, scored by a configurable metric: Jaccard (default), cosine, or raw co-occurrence.
  - Manual, user-declared connections between any two tags, always shown at full strength and never pruned by the automatic thresholds — including tags with no notes yet.
  - Configurable pruning by minimum shared notes and minimum relation strength.
  - Case-insensitive tag folding by default (configurable).
  - Optional compatibility bridge that relates an existing nested tag (`#a/b`) to its parent (`#a`).
  - Excluded tags and excluded folders, with exclusion cascading to nested children.
  - Debounced, incremental rebuilds on vault metadata changes, deletes, and renames.
- **Tag cloud view** (`src/cloud.ts`): every tag sized by note count, sortable by name, note count, or relatedness to the current selection. Selecting a tag highlights related tags by strength, dims unrelated ones, and re-groups the cloud into Selected / Related / Unrelated with an animated (FLIP) transition.
- **Mind-map view** (`src/map.ts`): a force-directed canvas graph centered on the selected tag, laid out in rings by hop distance. Pan, zoom-toward-cursor, drag-to-reposition, click-to-recenter, and controls to zoom, fit-to-view, and re-run the layout. Edge thickness and node emphasis track relation strength; manual connections render as dashed accent lines.
- **Tree view** (`src/tree.ts`): an expandable outline rooted at the selected tag, branching into its strongest relations one hop at a time, with cycle-free traversal (a tag never repeats within its own ancestor path).
- **Details panel**: note count, relation count, the full related-tag list with strength bars, and the notes carrying the selected tag (click to open).
- **Interactions available from every view**: double-click a tag to search notes for it; right-click for focus / search / connect / disconnect / copy; a live filter box.
- **Commands**: Open tag relations, Open tag relations in sidebar, Focus a tag, Connect two tags, Rescan vault for tags.
- **Settings tab** covering the relation metric, pruning thresholds, case sensitivity, nested-tag bridging, exclusions, manual connection management, and per-view tuning (cloud font range and animation, mind-map depth/node cap/forces/labels, tree branching factor and auto-expand depth).
- Packaging script (`npm run package`) producing a manual-install plugin folder, a zipped copy of it, and flat release assets (`main.js`, `manifest.json`, `styles.css`) for GitHub releases / BRAT.
- Architecture Decision Records under `docs/adr/` covering the flat-tags-plus-graph model, the two relation sources, the shared-graph multi-view design, and the choice of a hand-rolled canvas force layout over a graph library.

[Unreleased]: https://github.com/user216/obsidian-tag-relations/compare/0.1.0...HEAD
[0.1.0]: https://github.com/user216/obsidian-tag-relations/releases/tag/0.1.0
