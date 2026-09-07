# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-09-07

### Added

- **Action bar.** Every tag action now exists as a button, so nothing is reachable only by right-clicking. Toggle it on the fly from the toolbar's wand button, or in settings. Buttons act on the last-selected tag (named at the left of the bar so the target is never ambiguous), are grouped by kind, and **grey out rather than disappear** when they don't apply — a bar that changes shape as the selection changes can't become muscle memory.
- **Customisable button icons.** Every action's icon can be set to any [Lucide](https://lucide.dev) icon name, with a live preview as you type and a per-action reset. An unknown name leaves the button blank rather than breaking it.
- **Remove this relation…** — removes every removable tie to one chosen tag: the horizontal link *and* any containment together, so a pair that had both isn't left half-joined.
- **Remove all relations…** — clears every horizontal link and group membership a tag has, with a confirmation listing each one.
- **Take out of a main-tag…** as a first-class action, going straight through when there's only one parent and asking which when there are several. The Groups view's hover ✕ now removes exactly that one membership rather than routing through the general handler.
- [VOCABULARY.md](VOCABULARY.md) — a glossary of every term the plugin uses, including where the code's names differ from the interface's (horizontal link = `ManualLink`), and the three different things called "remove".

### Changed

- **Settings are now six tabs** instead of one long scroll: Relations, Groups, Views, Editing, New note, Action bar. Arranged as two threes, per [ADR 0009](docs/adr/0009-three-or-three-plus-one.md).
- **The context menu is generated from the same action registry the button bar uses**, so the two can never offer different capabilities. Previously the menu was hand-written; the parity was accidental and would not have survived the next feature.
- Removing relations explains what it *doesn't* touch: relations that come from two tags sharing a note can't be removed this way, because nothing is stored to delete. The confirmation says so rather than leaving you to wonder why a relation survived.

### Tests

- 29 new tests covering removable-relation discovery, single/all/membership removal (including the both-ties-at-once case), and the action registry's ids, grouping, enablement rules and icon fallbacks.

## [0.5.1] - 2026-09-07

Closes the loop on tag groups: a second way to build the structure, matching terminology throughout, and three real display bugs found and fixed while auditing the feature end to end.

### Added

- **"Put this tag inside…"** — the missing direction. Until now the only way to build a group was to right-click the *container* ("Make this a main-tag for…"); this adds the mirror action from any tag's context menu, so you can start from the *member* and pick (or create on the spot) its main-tag. Both accept a name that doesn't exist yet.
- **Direct remove from a specific group.** In the Groups view, hovering a member now reveals a small ✕ that detaches it from that specific group without opening a menu — useful because a tag can have several parents, and the old path (right-click → "Take out of a main-tag" → pick from a submenu) made you name the one you were already looking at.
- **Sortable details table.** Clicking a column header in the details cloud layout now actually sorts by it (ascending, click again for descending) — previously the headers were static labels.
- **Inline rename in the Groups view** — section headers and member pills both gained the same rename-in-place control the cloud and tree already had.

### Changed

- **Terminology now matches what you asked for throughout the UI**: "group" → **main-tag**, "sub-group" → **sub-tag**, and manual connections are now called **horizontal links** everywhere they're shown — reflecting what they actually are: an association between two tags that creates no hierarchy, as opposed to group membership which does.
- A level filter that hides sub-tags ("Tags + main-tags") no longer drops a sub-tag's own members along with it. By the three-level rule a sub-tag can only hold plain tags, so those tags now surface directly under the main-tag instead of disappearing.

### Fixed

- **Group relationships could be mislabelled as horizontal links, or not labelled at all**, in three places: the mind-map's hover tooltip, the details panel's related-tag list, and the tag cloud's pill tooltip. All three previously checked `edge.manual` without checking containment first, so a group edge that happened to also carry a stale `manual` flag (from a horizontal link made before the grouping) displayed as "Horizontal link to X" instead of "Contains X" / "Inside X" — and a pure group edge with no manual flag fell through to a bare relatedness percentage. Consolidated into one function, `describeRelation`, so the group-beats-manual-beats-percentage priority is decided once and can't drift between renderers again.
- The tag cloud's pill border now distinguishes a group relationship (solid, accent-coloured) from a horizontal link (dashed) — previously a group-related pill got no special border at all unless it happened to also be manually linked, in which case it wore the horizontal-link's dashed style even though the actual relationship was containment.

### Tests

- 10 new tests directly covering the parent/child direction and the group-beats-manual precedence in `describeRelation`, including a regression test for the exact bug found (an edge carrying both `manual: true` and group containment must report as grouped, not manual).
- 6 new tests for the level-filter flattening fix.

## [0.5.0] - 2026-09-07

Tag groups — the containment that nested tags provided, without what made them bad.

### Added

- **Tag groups.** A group is simply a tag that holds other tags, so groups inherit note counts, renaming, relations and the context menu for free. Structure goes three levels deep — **group → sub-group → tag** — and is enforced by one invariant, `ancestorDepth(parent) + 1 + descendantDepth(child) ≤ 2`, from which every rule follows: a sub-group holds only plain tags, and a group can be demoted into a sub-group only when it holds no sub-groups itself. Refusals name the specific rule they hit.
  - **A tag can belong to many groups at once** — membership is a DAG, not a tree. This is what nested tags could never express.
  - Nothing is written to your notes: grouping lives entirely in plugin data, so reorganising is free.
- **Groups view** with two layouts: **collapsible clouds** (every group a foldable section on one page) and **tree** (an indented outline). Sub-groups can optionally also appear as top-level sections.
- **Group membership as connections.** Containment becomes a third source of graph edges alongside co-occurrence and manual links — always full strength, never pruned, recording which end is the parent — and is drawn in its own colour per level pairing (group→sub-group, group→tag, sub→tag). Switchable off for organisation-only groups.
- **Level styling.** The three tag levels are told apart by font scale, shadow depth and colour, via **subtle / balanced / bold** presets or fully custom per-level values.
- **Level filters**: plain tags only, tags + groups, all levels separated into bands, or all levels together in one field.
- **Pinned tags** — up to 10 held at the top of the cloud, pinned from any tag's context menu.
- **Cloud layouts**, in the manner of a file browser: **icons** (the weighted cloud), **list** (one per line) and **details** (a sortable table showing kind, notes, relations and group membership).
- **Pan and zoom** for the cloud and groups views: drag empty space to pan, Ctrl/Cmd+wheel to zoom about the cursor. Plain scrolling still scrolls. Zoom is remembered between sessions.
- **Whole-vault mind-map** — an option to draw every tag and every connection at once rather than only the selection's neighbourhood, with a notice when the node cap truncates.
- A **view options** menu in the toolbar holding the per-mode switches, so the toolbar keeps a stable shape as you change views.
- [ADR 0008](docs/adr/0008-tag-groups-are-tags.md) on why a group is a tag rather than a separate object, and [ADR 0009](docs/adr/0009-three-or-three-plus-one.md) recording the "prefer threes" heuristic in its four shapes — 3, 3+1, 3+3 and 3+3+3 — with where each already appears, where it deliberately does not apply, and what composition costs.
- 32 tests for the group model and level styling, covering every depth-rule case, multi-parent membership, cycle resistance, rename propagation and pin capping.

### Changed

- Renaming a tag now also follows through group membership and pinned tags, merging duplicates and dropping links a rename would collapse onto itself.

## [0.4.0] - 2026-09-07

### Added

- **Create a new note.** A toolbar button (and a command) creates a note titled from the current date and time, defaulting to `YYYYMMDDHHmm` — for example `202609071432.md`.
  - **Title format** is configurable with moment-style tokens: `YYYY YY MM DD HH mm ss`, plus `MMM MMMM ddd dddd` and `h`/`A` for 12-hour time. Text in `[square brackets]` is kept literally. Eight presets are offered, and the settings page shows a live preview of the filename the current format produces.
  - **Timezone** is selectable from every zone the runtime knows (418 of them), or left on the system default. Useful for stable filenames while travelling, or keeping a whole vault on UTC. An unknown zone falls back to the system zone rather than blocking note creation.
  - **Folder** is configurable and created if missing; left empty, Obsidian's own "default location for new notes" is honoured.
  - **The current tag selection** is written into the new note's frontmatter by default, so it joins the graph immediately. Toggleable.
  - The whole feature can be switched off, which hides the toolbar button.
  - Filenames are sanitised: characters a filename cannot hold become hyphens, so a format containing `/` produces one note rather than silently creating folders. Same-minute collisions get a `-1`, `-2` suffix.
- 42 tests covering date formatting, timezone handling (including DST, date-line and year boundaries), filename sanitising, and frontmatter generation.
- [ARCHITECTURE.md](ARCHITECTURE.md) — full technical documentation: module map and dependency direction, the graph data model and six-phase build pipeline, the `ViewHost` contract, per-renderer internals (FLIP re-grouping, the mind-map's force equations, camera and hit-testing math, tree path-keyed expansion), the editing subsystem's four safety invariants, settings persistence, build and test architecture, performance characteristics, known limitations, and extension points.

### Fixed

- `Intl.supportedValuesOf("timeZone")` returns canonical zone names, which spell UTC as `Etc/UTC`. Plain `UTC` is now offered explicitly in the timezone list, so it is selectable and a saved `UTC` setting is no longer mislabelled as unavailable.

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

[Unreleased]: https://github.com/user216/obsidian-tag-relations/compare/0.6.0...HEAD
[0.6.0]: https://github.com/user216/obsidian-tag-relations/compare/0.5.1...0.6.0
[0.5.1]: https://github.com/user216/obsidian-tag-relations/compare/0.5.0...0.5.1
[0.5.0]: https://github.com/user216/obsidian-tag-relations/compare/0.4.0...0.5.0
[0.4.0]: https://github.com/user216/obsidian-tag-relations/compare/0.3.1...0.4.0
[0.3.1]: https://github.com/user216/obsidian-tag-relations/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/user216/obsidian-tag-relations/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/user216/obsidian-tag-relations/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/user216/obsidian-tag-relations/releases/tag/0.1.0
