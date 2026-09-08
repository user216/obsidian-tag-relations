# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.0] - 2026-09-08

### Added

- **Pinned and bookmarked tags are now separated into labelled bands**, with space and a rule between them, in the **cloud**, **tree** and **groups** views. The tree previously ran pinned tags straight into the rest with nothing marking where one ended and the other began.
- **A bookmarked band in every view.** In the cloud and tree it is its own labelled section; on the **mind-map**, bookmarked tags are always drawn regardless of depth or the node cap, never dim, always keep their label, and carry a **dashed ring** — distinct from a pin's solid one, so the two are still tellable apart when a tag has only one of them.
- **The bookmarked band can sit at the bottom of the list** instead of the top (Settings → Views). Pinned stays above regardless, so moving bookmarks down never buries a pin.
- Either band can be turned off. Doing so does **not** hide its tags — they simply sit with the rest, so a display preference can never make something unreachable.

### Notes

- A tag that is both pinned and bookmarked appears **once**, under Pinned. Showing it twice would make the bands read as filters rather than as a partition of the list.
- The rest band is called "Unpinned" only when pinning alone was lifted out. With a bookmarked band above it, those tags are unpinned too, so it reads "Other tags" instead rather than stating something false.

### Tests

- 14 new tests: band order and positioning, precedence when a tag qualifies for two, that no tag is ever lost or duplicated across bands, that a disabled band falls through rather than hiding anything, and the label rules.

## [0.12.0] - 2026-09-08

### Added

- **Show or hide each of the toolbar's own controls** in **Settings → Buttons**: the view switcher, filter box, sort dropdown, edit-mode and sticky-select toggles, the match mode and Show notes pair, the action-bar toggle, the view-options menu, the side-panel toggle and the rescan button.
  - Tag actions already had this through the **Hidden** option in their placement dropdown; these ten built-in controls had no way to be turned off at all, so a toolbar carrying everything left little room for the buttons you actually reach for.
  - Each toggle says what hiding it costs and where the equivalent lives. Nothing becomes unreachable: every control has a counterpart in settings or the command palette, and the list itself is always in settings.
  - **Reset the layout** now also restores control visibility.

### Tests

- 7 new tests: default visibility, hiding one without disturbing others, hiding everything, ignoring stale keys from an old settings file, and that every control carries a description explaining the cost of hiding it.

## [0.11.1] - 2026-09-08

### Fixed

- **Pinning a tag made every other tag vanish from the tree.** Pinned tags were treated as a replacement for the root list rather than a promotion within it, so a single pin emptied the view of everything else. Pinned tags now lead the list and every other tag still follows beneath them, which is what a pin should mean.
- The tree's root list now respects the toolbar's **Sort** control. It previously re-sorted by connectedness and capped itself at twenty tags, so the sort dropdown had no effect there and most of the vault was unreachable from the tree without selecting something first.

### Tests

- The test that asserted the old behaviour ("the fallback is skipped entirely once anything is pinned") encoded the bug as intended, and was replaced by ten covering the correct behaviour: promotion without hiding, no duplication of a pinned tag further down, pin order, sort order being honoured, and a selection still narrowing the tree.

## [0.11.0] - 2026-09-08

### Added

- **Arrange the buttons.** Every action can now be placed on the **toolbar**, the **action bar**, **both**, or **hidden**, and moved into whatever order you like — all in **Settings → Buttons**, next to the icon field that was already there.
  - Both surfaces share one order, so a button keeps the same relative place wherever you put it. Two independent orderings would be more expressive and much harder to hold in your head.
  - **Reset the layout** puts every button back to its default place, order and icon.
  - The settings list is shown in the arranged order rather than grouped by kind, since the order is the thing being edited.

### Changed

- The toolbar's **New note** and **Clear selection** buttons are no longer hard-coded — they are ordinary actions that simply default to the toolbar. The layout is unchanged out of the box, but both can now be moved, hidden, or joined by anything else.
- An action added by a future version appends to a saved layout rather than disappearing from it, so customising the order can't hide features added later.

### Tests

- 20 new tests covering placement defaults and overrides, surface filtering, order preservation, appending of unknown actions, and that moving never loses or duplicates a button.

## [0.10.0] - 2026-09-08

### Added

- **Standing sections in the side panel**, above the selection details and independent of what is selected — so they stay put as you click around and remain the reliable way back to something you keep close. Each is collapsible and scrolls on its own, so a long list can't push the others off the panel.
  - **Pinned** — your pinned tags, with unpin in place.
  - **Bookmarks** — a shortlist you arrange yourself (see below).
  - **Groups** — every main-tag, each expandable to show its members.
- **Bookmarks.** A second containment structure, deliberately **independent of groups**: same shape (two levels of nesting, same depth rule), but it creates no relations and changes nothing about your tags. It is navigation — "keep this within reach" — rather than a claim about the vault, which is why it can be used alongside grouping or instead of it. Bookmark from the context menu, the action bar, or the panel's `+`.

### Fixed

- **Pinning now works in the mind-map and tree, not just the cloud.** A pin means "keep this to hand", and two of the three views ignored it entirely, which made pinning look like cloud-only decoration.
  - **Tree**: pinned tags are always roots, ahead of the selection.
  - **Mind-map**: pinned tags are always drawn regardless of depth or the node cap, never dim, always keep their label, and carry a ring so a pin reads as a marker on the node rather than changing what the node means.

### Tests

- 10 new tests covering root ordering (pinned ahead of selection, deduplicated, fallback skipped once anything is pinned) and the map's pinned-node inclusion.

## [0.9.0] - 2026-09-08

### Added

- **Export and import relations**, in three places: **Settings → Relations**, the **action bar**, and the **command palette** (`Export relations to a file`, `Copy relations to the clipboard`, `Import relations`).
  - Export writes a timestamped `.json` into the vault root — so it syncs with the vault and can be found again — or copies to the clipboard.
  - Import accepts a paste or a `.json` already in the vault, and **shows exactly what it would change before applying**: how many links, memberships and pins would be added, and what would be skipped.
  - **Merge** (keep what is here, add what is missing) or **replace** (discard first). Merge treats a reversed horizontal link as the same link, so re-importing the same file changes nothing.
  - A raw `data.json` imports directly — `manualLinks` is accepted as an alias for `horizontalLinks`.
  - Imported group memberships go through the same validation as ones made in the UI, so **a hand-edited file cannot smuggle in a fourth level or a cycle**; anything refused is listed with its reason.

### Fixed

- **A refused tag name now says why.** Typing `108` appeared to do nothing: the plugin knew it was rejected because Obsidian requires at least one non-numeric character in a tag, and then discarded that reason in favour of a generic message. It now names the rule and suggests a concrete fix (`n108`, `108x`). The same applies in the multi-tag list, where each skipped name is reported individually rather than as a bare list.
- An imported horizontal link without a label no longer gains an empty `label` key, so an export round-trips to exactly itself.
- Adding a horizontal link between two tags that are **already grouped** now says what happened. Both relations are kept, but containment is what the views draw, so the new link previously appeared to do nothing — the same silent no-op that made a rejected tag name look like a broken dialog. The notice explains that the link is stored and will reappear if the tags are ungrouped.

### Tests

- 22 new tests: export round-tripping, import rejection (bad JSON, another plugin's file, a newer format, an empty file), tolerance (malformed entries dropped with warnings, `manualLinks` alias, missing sections), merge and replace planning, the pin cap, and that the three-level rule and cycle prevention hold for imported data.

## [0.8.0] - 2026-09-08

### Added

- **Create several tags at once in the new-note dialog.** Typing more than one name — separated by spaces, commas or semicolons — switches the suggestion list for an "Add N tags" row that adds them all, creating whichever don't exist yet. Spaces are safe as separators because a tag name can never contain one, so `alpha beta` is unambiguously two tags.
  - The row says how many are new before you commit to them.
  - Names that aren't usable as tags, and names already added, are **listed explicitly as skipped** rather than dropped quietly.
  - A single name behaves exactly as before, so one-at-a-time typing is untouched.

### Tests

- 12 new tests for list parsing: what counts as a list, each separator, new-versus-existing classification, order preservation, unusable names, case-insensitive duplicate detection, and repeats within one list.

## [0.7.1] - 2026-09-08

Two bugs in the new-note dialog, both found in real use.

### Fixed

- **A tag typed but not explicitly added was silently discarded.** Typing a name — especially a brand-new one, where the only thing on screen is a "create this" row — and then pressing **Create note** threw the typed tag away, so the note was created without it. Whatever is left in the box is now committed before the note is created, which is what pressing Create plainly implies.
- **The suggestion list could not be scrolled**, because it was capped at eight rows — so there was never anything below the fold to scroll to, and any tag past the eighth was unreachable except by typing. The list now renders every match (up to a generous cap that exists only to keep very large vaults responsive) and scrolls as intended.

### Tests

- 12 new end-to-end tests for note creation, now possible because the in-memory vault fixture gained `create` and `createFolder`. They cover a brand-new tag reaching the note, explicit tags overriding the "apply the selected tags" setting, same-minute filename collisions, folder creation, and the filename preview matching what is actually written.

## [0.7.0] - 2026-09-08

### Added

- **A tag picker when creating a note.** The new-note button now opens a dialog for choosing the note's tags instead of silently using whatever was selected. It starts pre-filled from the selection, and tags can be added or removed before the note is made.
  - Type to find an existing tag, or type a name that doesn't exist yet to create it — the same gesture as adding a tag to a main-tag.
  - Chosen tags show as removable chips, above a live preview of the filename about to be created.
  - Keyboard-first: **↑/↓** move, **Enter** adds the highlighted tag, **Backspace** on an empty box removes the last chip, and **Enter on an empty box** or **Ctrl/Cmd+Enter** creates the note — so "create with what I already selected" stays one keystroke.
  - **Ask which tags to add** (Settings → New note) turns the dialog off for one-click creation.

### Changed

- Tag-picker filtering moved into a shared `tagSuggest` module used by both the new-note dialog and the existing single-pick picker, so create-new behaviour cannot diverge between them.
- A tag list chosen explicitly in the dialog is now written even when "apply the selected tags" is off — that setting governs what the dialog is *pre-filled* with, and shouldn't veto a deliberate choice.

### Tests

- 19 new tests for suggestion filtering: substring and case matching, when a create-new row is and isn't offered, exclusion of already-chosen tags, and the row limit.

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

[Unreleased]: https://github.com/user216/obsidian-tag-relations/compare/0.13.0...HEAD
[0.13.0]: https://github.com/user216/obsidian-tag-relations/compare/0.12.0...0.13.0
[0.12.0]: https://github.com/user216/obsidian-tag-relations/compare/0.11.1...0.12.0
[0.11.1]: https://github.com/user216/obsidian-tag-relations/compare/0.11.0...0.11.1
[0.11.0]: https://github.com/user216/obsidian-tag-relations/compare/0.10.0...0.11.0
[0.10.0]: https://github.com/user216/obsidian-tag-relations/compare/0.9.0...0.10.0
[0.9.0]: https://github.com/user216/obsidian-tag-relations/compare/0.8.0...0.9.0
[0.8.0]: https://github.com/user216/obsidian-tag-relations/compare/0.7.1...0.8.0
[0.7.1]: https://github.com/user216/obsidian-tag-relations/compare/0.7.0...0.7.1
[0.7.0]: https://github.com/user216/obsidian-tag-relations/compare/0.6.0...0.7.0
[0.6.0]: https://github.com/user216/obsidian-tag-relations/compare/0.5.1...0.6.0
[0.5.1]: https://github.com/user216/obsidian-tag-relations/compare/0.5.0...0.5.1
[0.5.0]: https://github.com/user216/obsidian-tag-relations/compare/0.4.0...0.5.0
[0.4.0]: https://github.com/user216/obsidian-tag-relations/compare/0.3.1...0.4.0
[0.3.1]: https://github.com/user216/obsidian-tag-relations/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/user216/obsidian-tag-relations/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/user216/obsidian-tag-relations/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/user216/obsidian-tag-relations/releases/tag/0.1.0
