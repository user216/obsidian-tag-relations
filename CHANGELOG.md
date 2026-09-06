# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-09-06

### Added

- **Test suite** — 163 tests across 31 suites, run with `npm test`. Covers the graph engine, tag editing (including an in-memory vault exercising rename/assign/remove end to end), selection and sorting rules, tree branching, mind-map node collection and anchoring, manual-link remapping, and settings invariants.
- [FEATURES.md](FEATURES.md) — a brief list of every implemented feature.
- [ADR 0007](docs/adr/0007-nested-tags-are-out-of-scope.md) — nested tags are explicitly out of scope. Nested-tag support may be avoided, skipped, ignored, or mocked rather than implemented; existing nested handling is frozen legacy compatibility and is not extended.

### Changed

- Pure logic extracted from the DOM-bound renderers so it can be tested directly: `src/selection.ts` (selection, filtering, sorting, snapshot staleness), `src/links.ts` (manual-link remapping), plus `branchChildren` from the tree and `collectMapNodes` / `anchorPositions` from the mind-map. Behaviour is unchanged.

### Fixed

- Tree branching returned one child when the per-node cap was 0 — the cap was checked after appending rather than before. Not reachable through the settings UI, whose minimum is 3.

## [0.3.0] - 2026-09-06

Tag editing. **The plugin now writes to your notes** — until this release it only ever read them. Bulk edits are not covered by Obsidian's undo, so keep a backup or version control.

### Added

- **Rename a tag across the vault.** The rename dialog recomputes its preview as you type, showing how many occurrences in how many notes will change, warning when the target already exists (the two tags merge), and offering to carry nested children along (`#a/b` → `#new/b`).
- **Assign existing or new tags to notes.** The tag picker searches your existing tags and, when you type a name that doesn't exist yet, offers to create it — one gesture for both. New tags go to frontmatter by default, or to the end of the note body.
- **Remove a tag from notes**, scoped either to the whole vault or to just the notes currently listed in the notes panel.
- Five ways to reach these, because renaming while exploring and renaming as a cleanup chore are different activities:
  - **Inline rename** in the cloud and tree — turn on **edit mode** (toolbar pencil) and each tag gets a rename control that edits the name in place.
  - **Context menu** in all three views: Rename tag…, Add another tag to these notes…, Remove this tag from all notes.
  - **Details panel** — an "Edit tags" group acting on the current selection.
  - **Notes panel** — add or remove a tag across exactly the notes frozen in the list.
  - **Commands**: Rename a tag, Add a tag to the active note, Remove a tag from the active note.
- New settings: where new tags are written (frontmatter or note body), whether bulk edits are confirmed, and an edit-mode toggle.

### Changed

- `minAppVersion` raised to **1.4.4**, where `fileManager.processFrontMatter` became available.
- Renaming a tag now updates the plugin's own manual connections to match, collapsing duplicates and dropping links a rename would turn into a self-link.

### Safety notes

- Writes go through `vault.process` (atomic) using the tag positions Obsidian's own parser recorded, so code blocks, `#fragment` URLs and `# Heading` lines are never mistaken for tags. Frontmatter goes through `processFrontMatter`, so YAML is re-serialised rather than patched.
- Cached tag positions are verified against the live text before being touched; a stale cache costs a missed rename rather than a corrupted note.
- Frontmatter shape is preserved — a list stays a list, a string stays a string, and entries keep their original `#` prefix or lack of one.

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

[Unreleased]: https://github.com/user216/obsidian-tag-relations/compare/0.3.1...HEAD
[0.3.1]: https://github.com/user216/obsidian-tag-relations/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/user216/obsidian-tag-relations/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/user216/obsidian-tag-relations/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/user216/obsidian-tag-relations/releases/tag/0.1.0
