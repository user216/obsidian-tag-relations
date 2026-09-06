# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-06

### Added

- **Multi-tag selection in every view.** Ctrl/Cmd or Shift click adds or removes a tag from the selection; a plain click still selects a single tag (and clears it when clicked again). A **sticky multi-select** toggle in the toolbar makes plain clicks additive, for touch use and longer multi-select sessions.
  - Cloud: the Selected group holds every selected tag; related tags shade by their strongest tie to the selection.
  - Mind-map: a single selection pins at the centre, several share a small central ring, and the neighbourhood drawn is the union of all selected tags' relations.
  - Tree: one root per selected tag, rather than a merged root.
- **Notes panel** — a **Show notes** button lists the notes carrying the selected tags. The list is a snapshot: it is filled only when you press the button, so clicking around the graph never disturbs it. When the selection, match mode, or vault moves on, the panel flags itself **Outdated** with a refresh button rather than silently changing.
  - **Match mode** (All tags / Any tag) decides whether a note must carry every selected tag or at least one. Under "Any tag" each result shows how many of the selected tags it carries, and results sort by that count.
  - Click a result to open it; Ctrl/Cmd click opens it in a new tab.
- **Selection-aware search**: the details panel's Search action now searches the whole selection, joining tags with `AND` or `OR` to match the current mode.
- Details panel shows removable chips for a multi-tag selection, plus how many notes match it.
- New settings: sticky multi-select, match mode, notes panel height, and a cap on how many results are rendered.

### Changed

- `npm run package` no longer produces a zip; it writes the manual-install folder and the flat release assets only. This drops the `archiver` dev dependency.
- `ViewHost` now exposes a selection API (`selection`, `isSelected`, `isRelatedToSelection`, `selectionStrength`, `select`, `selectFromEvent`, `clearSelection`) in place of the single nullable `selected` tag. Renderers no longer implement modifier-key conventions themselves.
- A tag's strength against a multi-tag selection is the strongest single tie, not a sum or average; tooltips name which selected tag that tie is to.

### Removed

- The details panel's live per-tag note list, superseded by the notes panel. Two note lists with different refresh semantics side by side was the confusion the snapshot model exists to avoid.

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

[Unreleased]: https://github.com/user216/obsidian-tag-relations/compare/0.2.0...HEAD
[0.2.0]: https://github.com/user216/obsidian-tag-relations/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/user216/obsidian-tag-relations/releases/tag/0.1.0
