# Tag Relations

An Obsidian plugin for exploring how your tags relate to each other — as a **tag cloud**, a **mind-map**, and a **tree** — so you can connect tags without ever nesting them.

The idea: instead of forcing hierarchy into tag names (`#area/health/running`), keep tags flat and let the relations between them be discovered and declared. Two tags are related when they appear on the same note, and you can also connect any two tags by hand.

## Where relations come from

**Co-occurrence (automatic).** Every time two tags appear on the same note, that's one shared note between them. This needs no setup — your existing vault already defines the graph.

**Horizontal links (declared).** Right-click any tag → *Horizontal link to another tag…*. A horizontal link always shows at full strength, even when the two tags have never shared a note, and is drawn as a dashed line. Unlike a group, it creates no hierarchy at all — it just says "these two are related", which is the replacement for nesting when what you want is a plain association: `#running` links to `#health` because you say it does, not because of how you spelled it.

Relation strength uses one of three metrics (Settings → Tag Relations):

| Metric | Formula | Good for |
| --- | --- | --- |
| **Jaccard** (default) | shared / (notes A + notes B − shared) | Genuine affinity; a small tag can strongly relate to a big one |
| **Cosine** | shared / √(notes A × notes B) | Similar, a little more forgiving of size differences |
| **Raw co-occurrence** | shared / most-shared-in-vault | Sheer volume; favours your most-used tags |

## The three views

### Cloud
Every tag, sized by how many notes carry it. Sort by **name A→Z / Z→A**, note count, or relatedness to the current selection.

Click a tag and the cloud reacts: related tags get an accent tint scaled by relation strength, unrelated tags fade back, and the cloud **re-groups** into `Selected → Related (n) → Unrelated (n)`, with related tags ordered strongest-first. The regrouping is animated (a FLIP transition), so tags visibly travel to their new position instead of the layout snapping.

### Mind-map
A force-directed graph on canvas. The selected tag is pinned at the centre and its relations lay out around it, one ring per hop — the TheBrain-style "the map re-forms around whatever I'm looking at" behaviour. Stronger relations pull tags closer together; edge thickness and opacity track strength; horizontal links are dashed and accent-coloured.

Pan by dragging the background, zoom with the wheel (zooms toward the cursor), drag any tag to reposition it, click to re-centre on it. Corner controls zoom, fit-to-view and re-run the layout. Depth (1–5 hops) and the node cap are configurable. Manual, horizontal-link edges are dashed and accent-coloured; group-membership edges are solid and coloured per level pairing.

### Tree
The relation graph unfolded as an expandable outline, rooted at the selected tag. Each branch is that tag's strongest relations, and expanding walks one hop further out. A tag never repeats within its own ancestor path, so the walk always moves outward. With nothing selected it lists your most-connected tags as entry points.

## Tag groups

A **main-tag is just a tag that holds other tags** — there is no separate kind of object to manage. There are three levels: **main-tag → sub-tag → tag**, enforced by one rule — a sub-tag holds only plain tags, and a main-tag can become a sub-tag only if it doesn't already hold sub-tags. When a grouping isn't allowed, the plugin says which rule you hit.

Two things make this different from the nested tags it replaces:

- **A tag can belong to many groups at once.** `#running` can sit in both `#health` and `#hobby` without duplication or picking a winner.
- **Nothing is written to your notes.** Grouping lives in plugin data, so reorganising the whole structure costs nothing and never rewrites a file.

**Two ways to build the structure**, from any tag's right-click menu, because you'll want to start from either end:

| Menu item | Use when |
| --- | --- |
| **Make this a main-tag for…** | You're looking at the container — pick what goes inside it |
| **Put this tag inside…** | You're looking at the member — pick (or create) its main-tag |

Both accept a name that doesn't exist yet, so starting a brand-new group needs no separate "create" step. In the Groups view, hovering a member also reveals a small **✕** that removes it from that specific group directly, without opening a menu — useful since a tag can have several parents and the menu would otherwise make you pick which one.

The **Groups** view shows the structure two ways: **collapsible clouds** (every main-tag a foldable section on one page) or a **tree** outline. Sub-tags can optionally also appear as top-level sections.

Group membership also draws as **coloured connections** in the cloud and mind-map — a different colour per level pairing (main→sub, main→tag, sub→tag) — so structure stays visible inside the relation graph, distinct from the dashed horizontal links. Turn it off in settings if you'd rather groups were organisation only.

The three levels are told apart by size, shadow and colour, via **subtle / balanced / bold** presets or custom per-level values.

## Cloud layouts, pinning and zoom

The cloud has three layouts, like a file browser:

| Layout | Shows |
| --- | --- |
| **Icons** | The classic weighted cloud — size tracks note count |
| **List** | One tag per line, compact |
| **Details** | A table: kind, note count, relation count, group membership — click a column header to sort by it |

**Pin up to 10 tags** from any context menu; they're held at the top in every layout.

**Pan and zoom**: drag empty space to pan, Ctrl/Cmd+wheel to zoom about the cursor. Plain scrolling still scrolls, and the zoom level is remembered. The mind-map keeps its own camera, and gains a **whole-vault** option that draws every tag and connection at once rather than just the selection's neighbourhood.

Per-view switches live in the toolbar's **view options** menu, so the toolbar keeps a stable shape as you change views.

## Selecting tags

Selection works the same way in all three views:

| Action | Result |
| --- | --- |
| Click | Select just that tag (clicking the only selected tag clears it) |
| Ctrl/Cmd click, Shift click | Add or remove that tag from the selection |
| Sticky multi-select (toolbar toggle) | Every plain click adds or removes — no modifier needed |
| Click empty background | Clear the selection |

With several tags selected, a tag counts as *related* if it relates to **any** of them, and its highlight strength is its **strongest single tie** — tooltips name which selected tag that tie is to. The mind-map pins one selection at the centre or arranges several on a small central ring; the tree grows one root per selected tag.

## Showing notes

Press **Show notes** to list the notes carrying your selected tags. **Match mode** decides what counts:

- **All tags** — only notes carrying every selected tag (narrowing)
- **Any tag** — notes carrying at least one, each labelled with how many it carries, most matches first (gathering)

The list is a **snapshot**, not a live query. It fills only when you press the button, so you can keep clicking around the graph to investigate results without the list shifting under you. When the selection, match mode, or vault moves on, the panel marks itself **Outdated** and offers a refresh rather than silently changing. Click a result to open it, Ctrl/Cmd click for a new tab.

## Creating notes

A **new note** button in the toolbar creates a note named after the current date and time — `202609071432.md` by default. It is also a command, and can be switched off entirely in settings.

| Setting | What it does |
| --- | --- |
| **Title format** | Moment-style tokens: `YYYY YY MM DD HH mm ss`, plus `MMM MMMM ddd dddd` and `h`/`A` for 12-hour time. Text in `[square brackets]` is kept literally, so `[Note] YYYY-MM-DD` gives `Note 2026-09-07`. Eight presets are offered, with a live preview of the filename. |
| **Timezone** | Any IANA zone, or the system default. Handy for stable filenames while travelling, or keeping a vault on UTC. |
| **Folder** | Created if missing. Left empty, Obsidian's own default location for new notes is used. |
| **Apply the selected tags** | Writes whichever tags are selected in the view into the new note's frontmatter, so it joins the graph immediately. |
| **Open after creating** | Opens the note once made. |

Characters a filename cannot hold become hyphens — a format containing `/` makes one note, not nested folders. Two notes made in the same minute get a `-1`, `-2` suffix rather than colliding.

## Editing tags

> **This part writes to your notes.** Everything above only reads them. Obsidian's undo is per-file and does not cover a bulk edit, so keep a backup or version control before renaming across a large vault. Every bulk action shows you exactly which notes it will change before it changes them.

**Rename a tag** across the whole vault. The dialog previews as you type — how many occurrences in how many notes, whether the target name already exists (in which case the two tags merge), and whether to carry nested children along (`#a/b` → `#new/b`).

**Assign a tag** to notes — existing or brand new. The picker searches your tags, and typing a name that doesn't exist yet offers to create it, so adding a new tag and reusing an old one are the same gesture. New tags go to frontmatter by default, or to the end of the note body.

**Remove a tag** from notes, scoped to the whole vault or to just the notes currently in the notes panel.

Five ways in, because renaming while you explore and renaming as a cleanup chore are different activities:

| Where | What |
| --- | --- |
| **Inline** (cloud, tree) | Turn on **edit mode** (toolbar pencil); each tag gets a rename control that edits the name in place |
| **Context menu** (all views) | Rename tag…, Add another tag to these notes…, Remove this tag from all notes |
| **Details panel** | An "Edit tags" group acting on the current selection |
| **Notes panel** | Add or remove a tag across exactly the notes frozen in the list |
| **Commands** | Rename a tag · Add a tag to the active note · Remove a tag from the active note |

Under the hood, edits use the tag positions Obsidian's own parser recorded, so code blocks, `https://…#fragment` URLs and `# Heading` lines are never mistaken for tags; frontmatter is re-serialised by Obsidian rather than patched by hand, preserving whether you wrote a list or a string and whether entries carry a `#`. Renaming a tag also updates the plugin's own horizontal links and group membership to match.

## Everywhere
- **Details panel** (right side, toggleable) — note and relation counts, the related-tag list with strength bars, and removable chips for a multi-tag selection. Its **Search** action searches the whole selection, joined with `AND` or `OR` to match the current mode.
- **Double-click** any tag in any view to search your notes for it.
- **Right-click** any tag for: select, add/remove from selection, search, connect to another tag, remove a connection, copy.
- **Filter box** narrows every view live. Selected tags stay visible even when they don't match.

## Commands
- Open tag relations / Open tag relations in sidebar
- Focus a tag (fuzzy picker showing note and relation counts)
- Connect two tags
- Create a new note
- Rename a tag
- Add a tag to the active note / Remove a tag from the active note
- Rescan vault for tags

## Settings worth knowing

- **Minimum shared notes** / **Minimum relation strength** — in a large vault every tag ends up faintly touching every other tag. Raise these to keep only meaningful relations. Horizontal links and group membership are never pruned.
- **Case-sensitive tags** — off by default, so `#Project` and `#project` are one tag.
- **Relate nested tags to their parent** — if you still have nested tags, `#a/b` gets a relation to `#a` so old hierarchies stay navigable while you migrate away from them.
- **Excluded tags / folders** — keep `#todo`, templates, archives out of the graph. Excluding a tag also excludes anything nested under it.
- **Sticky multi-select** — make every plain click additive, so you never need a modifier key.
- **Match notes against** — the default All/Any mode for the notes panel.
- **Notes panel height / maximum notes listed** — how tall the results panel is and how many rows it renders (the header always reports the true total).
- **Write new tags to** — frontmatter (default) or the end of the note body.
- **Confirm bulk edits** — show the affected notes before writing to more than one. Removals always ask regardless.
- **Edit mode** — show inline rename controls on tags; also on the view's toolbar.
- **New note** — enable the button, and set its title format, timezone, folder, whether selected tags are applied, and whether the note opens.

## Install

The plugin isn't in the community catalogue, so install it manually.

```bash
npm install
npm run package
```

`npm run package` builds the plugin and writes everything you need under `dist/`:

- `dist/tag-relations/` — a ready-to-copy plugin folder
- `dist/main.js`, `dist/manifest.json`, `dist/styles.css` — flat copies, for attaching as individual assets to a GitHub release (the layout [BRAT](https://github.com/TfTHacker/obsidian42-brat) and Obsidian's plugin installer expect)

Copy `dist/tag-relations/` into your vault:

```
<your vault>/.obsidian/plugins/tag-relations/
```

Restart Obsidian (or use *Reload app without saving*), then enable **Tag Relations** under Settings → Community plugins. You may need to turn off Restricted Mode first.

For development, `npm run dev` starts esbuild in watch mode — point the output at a test vault's plugin folder and use the [Hot Reload](https://github.com/pjeby/hot-reload) plugin. `npm run build` alone produces just `main.js` without the packaging step.

## Data

Horizontal links, group membership and view preferences live in `data.json` inside the plugin folder — they are never written into your notes.

Your notes are modified only by the tag-editing actions described above (rename, assign, remove), and only when you explicitly invoke one. Exploring, selecting, connecting tags and listing notes are all read-only. All writes originate from a single module, [src/edit.ts](src/edit.ts), if you want to audit them.

## Project layout

```
src/
  main.ts        plugin entry: settings, commands, graph rebuild scheduling
  graph.ts       the tag graph — co-occurrence, metrics, pruning, traversal
  edit.ts        the only module that writes to notes: plan + apply tag edits
  view.ts        the view shell: toolbar, mode switching, details/notes panels
  cloud.ts       tag cloud renderer with FLIP re-grouping
  map.ts         force-directed canvas mind-map
  tree.ts        expandable relation tree
  settings.ts    settings tab and defaults
  modals.ts      fuzzy tag picker
  editModals.ts  rename dialog, tag picker with create-new, edit confirmation
  host.ts        the interface renderers see
  selection.ts   selection, filtering, sorting, snapshot staleness
  links.ts       manual-link remapping across renames
  datetime.ts    timezone-aware date formatting and filename sanitising
  newNote.ts     timestamped note creation
  groups.ts      the group DAG and its three-level invariant (pure)
  groupsView.ts  collapsible-clouds and tree layouts for groups
  levels.ts      level styling, level filters, pinning (pure)
  panzoom.ts     pan/zoom layer for the DOM-based views
tests/           node:test suites, run with `npm test`
```

The graph rebuilds on vault changes, debounced by ~1s so bursts of edits cost one rebuild.

## Tests

```bash
npm test
```

163 tests across 31 suites, run on Node's built-in test runner. The suite bundles each test with esbuild exactly as the plugin itself is built, so a test never passes against code the bundler would reject.

Covered: the graph engine (metrics, pruning, traversal, note matching), tag editing end to end against an in-memory vault, selection and sorting rules, tree branching, mind-map node collection and anchoring, manual-link remapping, and settings invariants.

Not covered: DOM rendering and canvas drawing. Those are exercised by using the plugin, not by the suite — the logic behind them was extracted into plain modules precisely so the untested surface is thin.

## Architecture

[ARCHITECTURE.md](ARCHITECTURE.md) documents how the plugin is built: the graph model and construction pipeline, the `ViewHost` contract, each renderer's internals (including the mind-map's force equations), the editing subsystem's safety invariants, performance characteristics, known limitations, and extension points.

## Design decisions

The reasoning behind the bigger architectural choices — flat tags plus a relation graph, the two relation sources, sharing one graph across three views, hand-rolling the mind-map's force layout instead of pulling in a graph library, why the notes panel is a snapshot rather than a live query, and what changed when the plugin started writing to notes — is recorded in [docs/adr/](docs/adr/).

## Changelog

See [CHANGELOG.md](CHANGELOG.md), and [FEATURES.md](FEATURES.md) for a brief list of everything implemented.

## License

MIT
