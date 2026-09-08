# Architecture

How Tag Relations is put together. [FEATURES.md](FEATURES.md) lists what it does; [docs/adr/](docs/adr/) records why the significant decisions went the way they did; this document describes the machinery.

---

## 1. The model in one paragraph

The vault is read into a single in-memory **graph** whose nodes are tags and whose edges are relations. Relations come from two sources: two tags sharing a note (inferred), or the user connecting them by hand (declared). Everything else in the plugin is either a **view** of that graph, a **query** against it, or an **edit** that writes tag changes back to notes and triggers a rebuild. Hierarchy is never encoded in tag names — that is the whole premise ([ADR 0001](docs/adr/0001-flat-tags-with-a-relation-graph.md)), and nested tags are explicitly out of scope ([ADR 0007](docs/adr/0007-nested-tags-are-out-of-scope.md)).

```
      Obsidian metadataCache
                │  (read)
                ▼
          ┌───────────┐        manual links (data.json)
          │ TagGraph  │◄───────────────────────────────
          └───────────┘
                │
      ┌─────────┼──────────┬──────────────┐
      ▼         ▼          ▼              ▼
   Cloud     Mind-map    Tree      Notes panel / inspector
      └─────────┴──────────┴──────────────┘
                │  (user invokes an edit)
                ▼
           ┌──────────┐   plan → confirm → apply
           │TagEditor │───────────────────────────► vault.process
           └──────────┘                             processFrontMatter
                │                                          │
                └────────── rebuild (debounced) ◄──────────┘
```

---

## 2. Module map

| Module | Lines | Responsibility |
| --- | ---: | --- |
| `src/graph.ts` | 436 | The tag graph: construction, metrics, pruning, traversal, note matching |
| `src/edit.ts` | 460 | The **only** module that writes to notes: plan and apply tag edits |
| `src/view.ts` | 940 | View shell: toolbar, mode switching, inspector, notes panel, context menus |
| `src/map.ts` | 697 | Force-directed canvas mind-map |
| `src/settings.ts` | 622 | Settings tab, defaults, and the settings interface |
| `src/cloud.ts` | 306 | Tag cloud renderer with FLIP re-grouping |
| `src/tree.ts` | 282 | Expandable relation tree |
| `src/editModals.ts` | 325 | Rename dialog, tag picker with create-new, edit confirmation |
| `src/main.ts` | 498 | Plugin entry: lifecycle, commands, edit orchestration |
| `src/selection.ts` | 120 | Selection, filtering, sorting, snapshot staleness (pure) |
| `src/host.ts` | 66 | The `ViewHost` contract renderers see |
| `src/types.ts` | 44 | Shared enums and labels |
| `src/links.ts` | 42 | Manual-link remapping across renames (pure) |
| `src/groups.ts` | 261 | The group DAG and its three-level invariant (pure) |
| `src/groupsView.ts` | 320 | Collapsible-clouds and tree layouts for groups |
| `src/levels.ts` | 118 | Level styling, level filters, pin capping (pure) |
| `src/panzoom.ts` | 175 | Pan/zoom layer for the DOM-based views |
| `src/actions.ts` | 300 | The action registry: every tag action defined once (pure) |
| `src/relations.ts` | 140 | Which relations are removable, and removing them (pure) |
| `src/actionLayout.ts` | 115 | Button placement, ordering and reordering (pure) |
| `src/toolbarControls.ts` | 110 | The toolbar's built-in controls and their visibility (pure) |
| `src/bands.ts` | 100 | Splitting a tag list into pinned/bookmarked/rest bands (pure) |
| `src/transfer.ts` | 300 | Export payloads, import validation, merge planning (pure) |
| `src/transferModals.ts` | 220 | The import dialog, showing a plan before applying |
| `src/newNoteModal.ts` | 250 | The multi-tag picker shown when creating a note |
| `src/tagSuggest.ts` | 55 | Tag-picker filtering and create-new offers (pure) |
| `src/datetime.ts` | 214 | Timezone-aware formatting and filename sanitising (pure) |
| `src/newNote.ts` | 137 | Timestamped note creation |
| `src/modals.ts` | 43 | Fuzzy tag picker |

### Dependency direction

Dependencies point strictly downward. Nothing in a lower layer knows about a higher one.

```
main.ts                        ← plugin lifecycle, orchestration
  └── view.ts                  ← the view shell
        └── cloud/map/tree.ts  ← renderers
              └── host.ts      ← the contract they see
                    └── graph.ts, settings.ts, types.ts
edit.ts, editModals.ts         ← writes; used by main and view
newNote.ts                     ← creates notes; uses datetime.ts
selection.ts, links.ts,        ← pure logic; no Obsidian imports at all
datetime.ts
```

`view.ts` and `settings.ts` each `import type TagRelationsPlugin from "./main"`. These are **type-only** imports, erased at build time, so there is no runtime cycle.

Seven modules — `selection.ts`, `links.ts`, `datetime.ts`, `groups.ts`, `levels.ts`, `actions.ts` and `relations.ts` — import nothing from Obsidian. (`tagSuggest.ts` is pure logic too, but reaches `validateTagName` in `edit.ts`, so it inherits that module's import.) That is deliberate: they hold logic that would otherwise be trapped inside DOM-bound classes, and keeping them Obsidian-free is what makes them directly testable.

---

## 3. The graph

### Data structures

```ts
interface TagNode { tag: string; count: number; files: string[] }
interface TagEdge {
  a: string; b: string;      // lexicographically ordered
  cooccur: number;           // notes carrying both
  weight: number;            // normalised 0..1
  manual: boolean;
  label?: string;
}
```

`TagGraph` holds three collections:

- `nodes: Map<string, TagNode>` — keyed by tag, always `#`-prefixed
- `edges: Map<string, TagEdge>` — keyed by `edgeKey(a, b)`, which sorts the two tags so `(a,b)` and `(b,a)` collide into one entry
- `adjacency: Map<string, TagEdge[]>` — each tag's edges, **pre-sorted strongest-first**

The adjacency lists being pre-sorted is load-bearing: the tree's branching, the inspector's related list, and the map's neighbour ordering all just take the front of that list rather than sorting per render.

Tags are normalised on the way in by `normalizeTag()`: a `#` prefix is added if absent, internal whitespace stripped, and the whole thing lower-cased unless `caseSensitive` is on. Case folding at the boundary is why `#Project` and `#project` become one node.

### Construction pipeline

`TagGraph.build(app, options)` runs seven phases in order:

1. **Scan** every markdown file. Skip excluded folders. Read tags via Obsidian's `getAllTags(cache)`, normalise, dedupe per file. Increment each tag's count and record the path.
2. **Count co-occurrences.** For each note, every unordered pair of its tags gets `cooccur++`.
3. **Bridge nested tags** (optional, legacy — ADR 0007): if `#a/b` and `#a` both exist, add a zero-co-occurrence edge between them.
4. **Apply manual links** (user-facing name: horizontal links — ADR 0002). Mark matching edges `manual`, or create them. A manual link may name a tag no note carries — that tag is materialised as a node with `count: 0`.
5. **Apply group links** (ADR 0008). Rebuild `this.groups` from `options.groupLinks`, then, if `showGroupConnections` is on, materialise every group member as a node (even one no note carries, same courtesy as step 4) and add a full-strength edge per containment link, tagged with a `kind` from `groupEdgeKind()` and a `parent` recording which end contains the other. A containment edge that lands on the same pair as an existing co-occurrence edge *relabels* that edge rather than duplicating it — containment outranks an incidental shared note.
6. **Score.** Compute `weight` per edge using the configured metric. Manual and group edges are both forced to `1`.
7. **Prune, then index.** Drop edges below `minCooccurrence` or `minWeight` — *never* manual or group ones — then build the sorted adjacency lists.

Phase order matters in three places: manual links (4) must precede group links (5) so a containment link can relabel an existing manual or co-occurrence edge rather than fight it for the same slot; scoring (6) must follow both link phases (so their edges can be forced to full strength); and pruning must precede adjacency (so pruned edges never appear in a neighbour list).

**Complexity:** O(F × T²) where F is note count and T is tags per note. T is small in practice (single digits), so this is effectively linear in vault size. A full rebuild on a few thousand notes is milliseconds.

### Strength metrics

Given tags A and B sharing `c` notes:

| Metric | Formula | Character |
| --- | --- | --- |
| `jaccard` (default) | `c / (|A| + |B| − c)` | Corrects for frequency; a rare pair that always co-occurs outranks a common pair that overlaps occasionally |
| `cosine` | `c / √(|A| × |B|)` | Similar, more forgiving of size differences |
| `cooccurrence` | `c / maxCooccurrence` | Raw volume; favours the most-used tags |

Nested-bridge edges with `c = 0` get a floor of `0.15` so they exist but rank last.

### Query surface

```ts
neighbors(tag)                          // edges, strongest first
relatedTags(tag)                        // the other end of each
neighborhood(roots[], depth)            // BFS → Map<tag, hopCount>
maxStrengthTo(tag, selection[])         // strongest single tie
isRelatedToAny(tag, selection[])        // union membership
relatedToSelection(selection[])         // union, sorted, selection excluded
matchNotes(tags[], "all" | "any")       // NoteMatch[] with match counts
```

`neighborhood` takes an array of roots, which is what lets the mind-map treat a multi-tag selection as one focus cluster without special-casing.

`matchNotes` is the only genuinely non-trivial query. Under `"all"` it intersects, ordering the tag file-lists shortest-first so the candidate set shrinks fastest; under `"any"` it unions. Either way it then counts how many of the selected tags each result carries and sorts by that count, then path. Under `"all"` every count is identical by construction — the count only varies, and only matters, under `"any"`.

---

## 4. Lifecycle and event flow

```
onload()
  ├── loadSettings()              data.json → settings, with defaults merged
  ├── new TagEditor(app, () => currentOptions)
  ├── registerView(VIEW_TYPE, leaf => new TagRelationsView(leaf, this))
  ├── addSettingTab, addRibbonIcon, addCommand × 9
  ├── workspace.onLayoutReady(() => rebuildGraph())
  └── register 4 events → rebuildGraphDebounced()
        metadataCache "changed" | "resolved"
        vault "delete" | "rename"
```

The debounce is **900 ms trailing** (`resetTimer: true`, so each event pushes the timer back). Vault edits arrive in bursts — a single note save fires `changed` then `resolved`, and an edit session fires many — so the rebuild waits for the vault to go quiet and the whole burst costs one rebuild. The trade is that the graph lags a save by ~900 ms; `onLayoutReady` and the toolbar's rescan button both call `rebuildGraph()` directly, undebounced, when an immediate result is wanted.

`rebuildGraph()` rebuilds in place and then calls `onGraphChanged()` on every open view, which:
- drops selected tags that no longer exist,
- marks any open notes snapshot dirty (a rebuild can change what it would match),
- re-renders.

The plugin holds no view references; it discovers them via `workspace.getLeavesOfType()` each time. Views are created and destroyed by Obsidian, so anything else would risk stale handles.

---

## 5. The view layer

### The ViewHost contract

Renderers never touch Obsidian, the plugin instance, or each other. They see exactly one interface ([ADR 0003](docs/adr/0003-three-complementary-views-on-one-graph.md)):

```ts
interface ViewHost {
  app; graph; settings;             // read-only context
  selection: string[]; filter; sort; editMode;

  visibleTags(): string[];          // filtered + sorted, computed once by the shell
  isSelected(tag); isRelatedToSelection(tag); selectionStrength(tag);
  select(tag, mode); selectFromEvent(tag, event); clearSelection();
  promptRename(tag); renameInline(tag, next);
  openContextMenu(tag, event); openTagSearch(tag); requestRender();
}

interface ModeRenderer { render(): void; destroy(): void }
```

`selectFromEvent` exists so the modifier-key convention (Ctrl/Cmd/Shift = toggle, plus the sticky setting) lives in exactly one place. Three renderers implementing that rule independently would drift.

The shell (`TagRelationsView`) owns selection, filter text, sort order, the inspector, and the notes panel. Switching modes destroys the old renderer, constructs the new one, and keeps all of that state — so changing view feels like changing lens, not opening a different tool.

### Selection model

Extracted to `src/selection.ts` as pure functions:

- `applySelection(current, tag, mode)` — `"toggle"` adds/removes; `"replace"` narrows to one, except that clicking the *only* selected tag clears the selection. Never mutates its input.
- `filterTags(tags, filter, isSelected)` — substring match, but selected tags always survive so filtering never hides what you are working with.
- `sortTags(tags, sort, ctx)` — five orders; `relatedness` puts selected tags first, then ranks by `strengthTo`.
- `isSnapshotStale(snapshot, selection, mode, dirty)` — order-insensitive comparison plus the dirty flag.

Selection is an **ordered array**, not a Set: the inspector's chips and the mind-map's anchor ring both display in pick order.

Relatedness against a multi-tag selection is a **union**, and strength is the **maximum** over selected tags — not a sum or average. A tag is as relevant as its closest tie ([ADR 0005](docs/adr/0005-multi-select-and-a-frozen-notes-panel.md)).

---

## 6. The renderers

### Cloud (`cloud.ts`)

Font size is `min + (max − min) × scaleByCount(count, maxCount)`, where `scaleByCount` is `log(count+1) / log(maxCount+1)` — logarithmic so one enormous tag does not flatten everything else.

The interesting part is **re-grouping**. When a tag is selected the cloud reorders into Selected / Related / Unrelated, and the transition is animated with a FLIP pass:

1. **First** — measure every pill's `getBoundingClientRect()` before the rebuild.
2. **Last** — rebuild the DOM in the new order; the browser lays it out.
3. **Invert** — for each pill that moved, apply `transform: translate(−Δx, −Δy)` with transitions off, putting it visually back where it was.
4. **Play** — force a reflow, then clear the transform with a 260 ms transition so it slides to its real position.

Pill elements are **reused across renders** (kept in a `Map<string, HTMLElement>`) rather than recreated. FLIP requires identity across the two measurements, so reuse is a correctness requirement, not just an optimisation.

### Mind-map (`map.ts`)

A hand-written force simulation on `<canvas>` — no d3, no cytoscape ([ADR 0004](docs/adr/0004-hand-rolled-canvas-force-layout.md)).

**Which nodes are drawn** (`collectMapNodes`, pure and tested): with a selection, the `neighborhood` within `mapDepth` hops filtered to the visible pool (selected tags always survive); without one, the most-used tags. Sorted nearest-first, then capped at `mapMaxNodes` (default 160) so a large vault degrades to its most relevant slice rather than a hairball.

**Where the focus sits** (`anchorPositions`, pure and tested): one selected tag pins to the origin; several share a ring of radius `linkDistance × 0.45 × √n`, centred on the origin. Anchored nodes are `pinned` — their velocity is zeroed every tick.

**Per-node properties:** radius `4 + scaleByCount(...) × 15`; mass `1 + degree × 0.12`, so hubs resist being flung around by their many neighbours.

**Forces**, each scaled by `alpha` and divided by mass:

| Force | Rule |
| --- | --- |
| Repulsion | Every pair: `f = (charge × alpha) / d²`, applied along the unit vector. Coincident nodes get a random jitter to avoid division blowup. |
| Spring | Per edge: rest length `linkDistance × (1.4 − weight × 0.8)`, stiffness `0.25 × (0.35 + weight × 0.65) × alpha`. Stronger relations pull closer *and* harder. |
| Gravity | `v += −position × 0.015 × alpha` — keeps detached clusters on screen. |

Then speed is clamped to 30 units/tick, position integrates, and velocity damps by `× 0.82`.

**Cooling:** `alpha` starts at 1, multiplies by `0.985` per tick, and the RAF loop stops below `0.008` — roughly 320 ticks. Interaction "kicks" alpha back up rather than restarting from 1, so dragging a node nudges the layout instead of re-scrambling it.

**Camera:** `screen = (world − cam) × scale + viewport/2`, with scale clamped to `[0.15, 4]`. Wheel zoom converts the cursor to world space before and after the scale change and shifts `cam` by the difference, so the point under the cursor stays put. The canvas is sized by `devicePixelRatio` with a matching transform each frame, so rendering is crisp on HiDPI.

**Hit testing** is manual: distance to each node centre, with `6 / scale` of slack so small nodes stay clickable when zoomed out. A pointer-down that moves more than 2 px becomes a drag or pan; one that does not becomes a click.

**Theme:** canvas cannot read CSS variables, so the palette is pulled once per render via `getComputedStyle` on the container and cached, then invalidated on the next `render()`. Labels are stroked with the background colour before being filled, producing a halo that keeps them legible over edges.

**Cost:** repulsion is O(N²) per tick. At the default cap of 160 nodes that is 12,720 pair computations per frame, which is comfortable. This is the first thing to revisit if the cap is ever raised substantially — a quadtree/Barnes-Hut approximation is the standard next step.

### Tree (`tree.ts`)

`branchChildren(graph, path, maxChildren)` (pure and tested) returns the strongest relations of the last tag in a path, excluding **every tag already in that path**. That exclusion is what stops a branch bouncing between two mutually-related tags forever.

Expansion state is keyed by the **full path** (`"#a > #b > #c"`), not by tag, so the same tag can be open in one branch and closed in another. The key set is cleared whenever the root set changes, then re-seeded to `treeAutoExpandDepth`.

---

## 7. The notes panel

Pressing **Show notes** freezes a `NotesSnapshot`:

```ts
{ tags: string[]; mode: NoteMatchMode; matches: NoteMatch[]; takenAt: number }
```

Nothing else fills it. Changing the selection, the match mode, or the vault does **not** refresh it — the panel marks itself *Outdated* and offers a refresh button ([ADR 0005](docs/adr/0005-multi-select-and-a-frozen-notes-panel.md)).

Two reasons this is deliberate rather than lazy: a live list would re-query on every click while you are still exploring, and a list that vanishes when you click something cannot be used as a reference for investigating its own results.

The staleness check is therefore load-bearing rather than decorative. Any new path that mutates selection, match mode, or the graph must keep `snapshotDirty` / `isSnapshotStale` honest, or the frozen list becomes quietly misleading.

---

## 8. The editing subsystem

Writing to notes is confined to `src/edit.ts` ([ADR 0006](docs/adr/0006-writing-tag-edits-back-to-notes.md)). Every operation is a two-phase **plan → apply**.

### Plan

Plans are derived purely from the metadata cache, with **no file reads**:

```ts
planRename(from, to, includeNested) → { files: [{path, inline, frontmatter}], occurrences }
planAssign(tag, paths)              → files lacking the tag
planUnassign(tag, paths, nested)    → files carrying it, within scope
```

This is what lets the rename dialog recompute a live preview on every keystroke, and what lets the confirmation modal list every affected note before anything is written.

### Apply — four safety invariants

1. **Use the parser's positions, not regex.** Body edits use the offsets Obsidian recorded in `cache.tags`. The parser already decided what is a tag, so code blocks, `https://…#fragment` URLs and `# Heading` lines are structurally excluded rather than pattern-dodged.
2. **Verify before writing.** Each recorded span is compared against the live text (`content.slice(start, end) === hit.tag`) and skipped on mismatch. A stale cache costs a missed rename, never a corrupted note. Out-of-range and inverted offsets are skipped too.
3. **Write back-to-front.** Hits are applied in descending offset order, so a replacement of different length never invalidates the offsets of hits not yet processed.
4. **Never hand-patch YAML.** Frontmatter goes through `fileManager.processFrontMatter`, which re-serialises. `rewriteFrontmatter` preserves shape per key: a list stays a list, a comma-separated string stays a string, and each entry keeps its original `#` prefix or lack of one. A key containing no matching tag is not rewritten at all.

Body writes go through `vault.process` — atomic read-modify-write — rather than a separate read then modify.

**Ordering within a file:** body first, then frontmatter. Body edits depend on cached offsets that were valid before any write; `processFrontMatter` re-reads and re-parses, so it is unaffected by the body edit that preceded it. The reverse order would shift every body offset.

Removals additionally run `dropBlankedLines`, which deletes lines that a removal emptied — but only lines a removal actually touched, so blank lines the author wrote survive.

### Orchestration

`main.ts` wraps the editor with the user-facing flow: pick the operation, plan it, confirm if it touches more than one note (`confirmBulkEdits`), apply, report via `Notice`, and schedule a rebuild. Removals always confirm regardless of the setting.

Renames additionally call `remapManualLinks` (pure, in `links.ts`), which rewrites both ends of every stored connection, then drops links a rename collapsed into a self-link and de-duplicates links a rename made identical — including reversed duplicates.

---

## 8b. Creating notes

`NoteCreator` (`src/newNote.ts`) is the plugin's second writer, and a far simpler one than `TagEditor`: it only ever creates files, never modifies existing ones, so it needs none of the plan-verify-apply machinery.

**Formatting** lives in `src/datetime.ts`, which is Obsidian-free and fully tested. Obsidian bundles plain moment.js, which cannot resolve named IANA zones without moment-timezone; `Intl.DateTimeFormat` can, is built into the runtime, and costs no dependency. So wall-clock parts are read from `Intl` in the target zone and substituted into a moment-style format string — the token vocabulary Obsidian users already know.

Three details worth knowing:

- `hourCycle: "h23"` is used rather than `hour12: false`, because the latter can yield `"24"` for midnight in some runtimes.
- The weekday is *derived* from the zone-local calendar date (`Date.UTC(y, m-1, d).getUTCDay()`) rather than requested separately, so it can never disagree with the y/m/d that were formatted.
- `Intl.supportedValuesOf("timeZone")` returns canonical names, which spell UTC as `Etc/UTC`. Plain `UTC` is prepended explicitly, since it is valid and is what people look for.

**The dialog.** Obsidian's `SuggestModal` closes as soon as something is chosen — right for picking one thing, wrong for building a list — so `NewNoteModal` is a plain `Modal` with its own input and suggestion list. The filtering itself lives in `tagSuggest.ts` and is shared with the single-pick `TagChoiceModal`, so "type a name that does not exist to create it" cannot behave differently in the two places.

**Creation** resolves the folder (an explicit setting, created if missing; otherwise `fileManager.getNewFileParent`, which honours Obsidian's own preference), sanitises the formatted title into a legal filename, finds a free path (`-1`, `-2`… — same-minute collisions are routine under the default format, not an edge case), writes frontmatter carrying the selected tags, and optionally opens the result. Failures surface as a `Notice` and return null rather than throwing into the click handler.

Sanitising replaces path separators rather than honouring them, so a format containing `/` yields one note instead of silently creating a folder tree.

## 8c. Tag groups

`TagGroups` (`src/groups.ts`) holds containment as a flat list of `{ parent, child }` links and derives everything else from it. A tag with members is a main-tag; a main-tag something else contains is a sub-tag. Because level is derived rather than stored, promotion and demotion are just adding or removing a parent link, and a stored level can never disagree with the structure. Two context-menu flows build the same structure from either end — "Make this a main-tag for…" and "Put this tag inside…" — both calling the same `canAdd`/`add`, so the depth invariant is enforced identically regardless of which tag the user started from.

Membership is a **DAG, not a tree** — a tag may sit in several groups — so views must expect the same tag to appear more than once, and every traversal carries a visited set (cycles cannot be made through the UI, but a hand-edited `data.json` could contain one).

Depth is capped at three levels by one invariant checked on insertion:

```
ancestorDepth(parent) + 1 + descendantDepth(child) <= MAX_GROUP_DEPTH   // 2
```

Every rule the cap implies is a case of that arithmetic rather than a separate branch — see [ADR 0008](docs/adr/0008-tag-groups-are-tags.md) for the table. Refusals return the specific rule hit, because the constraint is not self-evident from outside.

Containment is also a **third edge source** in the graph, after co-occurrence and manual links. Group edges score full strength, skip pruning, and carry a `parent` field so views know the direction of an otherwise undirected edge. Their `kind` names the level pairing, which is what the mind-map colours by.

## 8c-bis. Bookmarks

Bookmarks reuse `TagGroups` wholesale — the same DAG, the same three-level invariant, the same rename propagation — against a separate store (`bookmarkLinks`). Nothing new was written for them.

The one deliberate difference is that bookmarks produce **no graph edges**. A bookmark says "keep this within reach", not "these two tags are related", so putting it in the relation graph would make a navigation choice look like a claim about the vault. That separation is what lets bookmarks be used alongside grouping or instead of it.

## 8d. Pan and zoom

The mind-map draws to canvas and owns its own camera. The cloud, groups and tree views are real DOM — they need inline renaming, text selection and the FLIP animation — so rather than rewriting them onto canvas, `PanZoom` (`src/panzoom.ts`) wraps their content in a CSS-transformed layer. The browser still lays tags out normally; the transform moves and scales the result.

`transform-origin: 0 0` keeps the algebra trivial: a content point maps to `point * scale + offset`, so holding the point under the cursor still during a wheel zoom is two lines. Panning starts only from empty space, so clicking a tag still selects it, and a gesture that moved more than a couple of pixels suppresses the click that would otherwise follow.

One interaction worth noting: FLIP measures `getBoundingClientRect`, which is in screen pixels, but the pill's own transform lives *inside* the scaled layer — so the measured delta is divided by the current scale before being applied.

## 8e. The action registry

`TAG_ACTIONS` (`src/actions.ts`) defines every tag action once: its id, group, default icon, a label that may depend on state, whether it is currently enabled, and what it does. Three surfaces read it — the context menu, the button bar, and the icon-customisation settings — rather than each maintaining a list.

That consolidation is the point. Three hand-written copies of "what can you do to a tag" drift within a release or two, and an action reachable from one surface but not another is invisible until someone goes looking. The same reasoning produced `describeRelation` after the identical bug was found in three renderers.

Actions reach the app through `ActionHost`, a deliberately narrow interface — an action needing something outside it is a prompt to reconsider whether it belongs here, mirroring the `ViewHost` constraint (ADR 0003).

**Relation removal** (`src/relations.ts`) is pure and separate, and draws one distinction carefully: a co-occurrence relation is *observed*, not stored, so there is nothing to delete — removing one would mean editing notes. Only horizontal links and group membership can be removed, and `withoutRelation` deliberately takes **both** ties between a pair at once, since half-removing would leave the two tags still joined.

## 9. Settings and persistence

One flat `TagRelationsSettings` interface, persisted to `data.json` via Obsidian's `loadData`/`saveData`. Loading merges stored values over `DEFAULT_SETTINGS`, so a settings file written by an older version gains new keys with their defaults rather than leaving them `undefined`. `manualLinks` is additionally guarded against a hand-edited file that made it a non-array.

The file holds three kinds of thing: the relation model (metric, thresholds, exclusions), user data (`manualLinks` — the only thing here that is not a preference), and view state (mode, sort, panel visibility) so the view reopens where you left it.

Manual links live here rather than in notes, which is why they are invisible to other tools reading the vault — a consequence recorded in ADR 0001.

---

## 10. Build and packaging

- **Bundler:** esbuild → a single CJS `main.js`. Obsidian, Electron and CodeMirror are externals; nothing else is, so the plugin ships with **zero runtime dependencies**.
- **Type checking** is separate (`tsc --noEmit`) and runs before every production build. esbuild strips types without checking them, so skipping this would let type errors ship.
- **`npm run package`** writes `dist/<id>/` (a manual-install folder) and flat `main.js` / `manifest.json` / `styles.css` copies (the layout BRAT and Obsidian's installer expect).
- `minAppVersion` is **1.4.4**, set by `processFrontMatter`.

---

## 11. Testing

`npm test` bundles each `tests/*.test.ts` with esbuild — **the same pipeline the plugin is built with**, aliasing `obsidian` to a local stub — then runs them on Node's built-in test runner. Building tests the same way as production means a test cannot pass against code the bundler would reject.

467 tests across 92 suites:

| Suite | Covers |
| --- | --- |
| `graph.test.ts` | Construction, folding, exclusions, all three metrics, pruning, manual links, traversal, note matching |
| `edit.test.ts` | `rewriteBody` (back-to-front, stale/out-of-range offsets, blank-line cleanup), `rewriteFrontmatter` (shape preservation), `validateTagName` |
| `editor.test.ts` | `TagEditor` end to end against an in-memory vault — rename, assign, remove, and that code blocks / URL fragments / headings survive |
| `selection.test.ts` | Selection transitions, filtering, all five sort orders, snapshot staleness |
| `views.test.ts` | Tree branching, map node collection and anchoring, `scaleByCount`, modifier detection, manual-link remapping, settings invariants |
| `groups.test.ts` | Every depth-rule case, multi-parent membership, promotion/demotion, cycle resistance, rename propagation |
| `levels.test.ts` | Level style resolution and CSS, level filters, pin capping, zoom clamping |
| `newNote.test.ts` | Note creation end to end: tags into frontmatter, explicit-versus-inherited tags, filename collisions, folder creation |
| `tagSuggest.test.ts` | Substring and case matching, create-new offers and their suppression, exclusions, limits, and multi-name list parsing |
| `transfer.test.ts` | Export round-tripping, import rejection and tolerance, merge/replace planning, and that the depth rule holds for imported data |
| `bands.test.ts` | Band order and position, precedence, no loss or duplication, disabled bands falling through, label rules |
| `toolbarControls.test.ts` | Default visibility, selective hiding, stale keys, registry integrity |
| `actionLayout.test.ts` | Placement defaults and overrides, surface filtering, order preservation, appending unknown actions, safe reordering |
| `relations.test.ts` | Removable-relation discovery, single/all/membership removal, and the action registry's ids, groups, enablement and icon fallbacks |
| `datetime.test.ts` | Every format token, `[literal]` escaping, timezone conversion across DST / date-line / year boundaries, invalid-zone fallback, filename sanitising, frontmatter generation |

`tests/helpers/vault.ts` is an in-memory vault: it stores note text, derives a metadata cache from it (inline tag offsets plus parsed frontmatter), and implements `vault.process` and `processFrontMatter`. Its tag scanner approximates Obsidian's parser — skipping fenced blocks and headings — and a dedicated suite tests *the fixture itself*, since the editor's safety depends on those exclusions being real.

**Not covered:** DOM rendering and canvas drawing. The pure logic behind them was extracted into `selection.ts`, `links.ts`, `branchChildren`, `collectMapNodes` and `anchorPositions` precisely so the untested surface is thin — but it is not zero, and the visual layer is verified by using the plugin.

---

## 12. Performance characteristics

| Operation | Cost | Notes |
| --- | --- | --- |
| Graph build | O(F × T²) | T = tags per note, small in practice. Debounced 900 ms. |
| `matchNotes` "all" | O(smallest list × tags) | Intersects from the rarest tag outward |
| `matchNotes` "any" | O(total tag-note pairs) | |
| Map simulation tick | O(N²) | N ≤ `mapMaxNodes`, default 160 |
| Rename preview | O(F × T) per keystroke | Cache-only; the first thing to revisit on a very large vault |
| Cloud render | O(V) + FLIP measure | V = visible tags; two layout reads per render |

---

## 13. Known limitations

- **Rendering is untested** by the suite; only logic is.
- **The map is O(N²)** and capped rather than approximated.
- **Canvas nodes are not DOM elements** — no per-node CSS, no accessibility tree, manual hit testing. The cloud and tree use real DOM partly to keep a keyboard- and screen-reader-friendlier path available.
- **The rename preview re-plans on every keystroke.** Correct, but linear in vault size.
- **Manual links are invisible** to anything that only reads the vault's markdown.
- **Nested-tag paths are under-exercised by design** — see ADR 0007. They are tolerated at current size; if one blocks a change, deleting it is preferred to extending it.
- **Bulk edits are not undoable** from inside Obsidian. Mitigated by mandatory previews, not solved.

---

## 14. Extension points

**Adding a view.** Implement `ModeRenderer` against `ViewHost`, add an entry to `MODE_META` in `view.ts`, and add the mode to the `ViewMode` union. Nothing in the graph, the other renderers, or the shell's selection handling needs to change.

**Adding a strength metric.** Add it to `WeightMetric`, handle it in `TagGraph.scoreEdges`, and add a dropdown option. Every view picks it up automatically, since they all read `edge.weight`.

**Adding an edit operation.** Add a `plan*` and an `apply*` pair to `TagEditor` — planning from the cache, applying through `vault.process` / `processFrontMatter` while honouring the four invariants above — then wire the confirm-and-report flow in `main.ts`. Keeping every write inside `edit.ts` is what makes the write surface auditable in one file.

**Adding a setting.** Add the field to `TagRelationsSettings`, a default to `DEFAULT_SETTINGS` (loading merges, so old `data.json` files stay valid), and a control to the settings tab.
