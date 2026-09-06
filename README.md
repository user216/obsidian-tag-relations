# Tag Relations

An Obsidian plugin for exploring how your tags relate to each other — as a **tag cloud**, a **mind-map**, and a **tree** — so you can connect tags without ever nesting them.

The idea: instead of forcing hierarchy into tag names (`#area/health/running`), keep tags flat and let the relations between them be discovered and declared. Two tags are related when they appear on the same note, and you can also connect any two tags by hand.

## Where relations come from

**Co-occurrence (automatic).** Every time two tags appear on the same note, that's one shared note between them. This needs no setup — your existing vault already defines the graph.

**Manual connections (declared).** Right-click any tag → *Connect to…*. Manual connections always show at full strength, even when the two tags have never shared a note, and are drawn as dashed lines. This is the replacement for nesting: `#running` connects to `#health` because you say it does, not because of how you spelled it.

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
A force-directed graph on canvas. The selected tag is pinned at the centre and its relations lay out around it, one ring per hop — the TheBrain-style "the map re-forms around whatever I'm looking at" behaviour. Stronger relations pull tags closer together; edge thickness and opacity track strength; manual connections are dashed and accent-coloured.

Pan by dragging the background, zoom with the wheel (zooms toward the cursor), drag any tag to reposition it, click to re-centre on it. Corner controls zoom, fit-to-view and re-run the layout. Depth (1–5 hops) and the node cap are configurable.

### Tree
The relation graph unfolded as an expandable outline, rooted at the selected tag. Each branch is that tag's strongest relations, and expanding walks one hop further out. A tag never repeats within its own ancestor path, so the walk always moves outward. With nothing selected it lists your most-connected tags as entry points.

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

## Everywhere
- **Details panel** (right side, toggleable) — note and relation counts, the related-tag list with strength bars, and removable chips for a multi-tag selection. Its **Search** action searches the whole selection, joined with `AND` or `OR` to match the current mode.
- **Double-click** any tag in any view to search your notes for it.
- **Right-click** any tag for: select, add/remove from selection, search, connect to another tag, remove a connection, copy.
- **Filter box** narrows every view live. Selected tags stay visible even when they don't match.

## Commands
- Open tag relations / Open tag relations in sidebar
- Focus a tag (fuzzy picker showing note and relation counts)
- Connect two tags
- Rescan vault for tags

## Settings worth knowing

- **Minimum shared notes** / **Minimum relation strength** — in a large vault every tag ends up faintly touching every other tag. Raise these to keep only meaningful relations. Manual connections are never pruned.
- **Case-sensitive tags** — off by default, so `#Project` and `#project` are one tag.
- **Relate nested tags to their parent** — if you still have nested tags, `#a/b` gets a relation to `#a` so old hierarchies stay navigable while you migrate away from them.
- **Excluded tags / folders** — keep `#todo`, templates, archives out of the graph. Excluding a tag also excludes anything nested under it.
- **Sticky multi-select** — make every plain click additive, so you never need a modifier key.
- **Match notes against** — the default All/Any mode for the notes panel.
- **Notes panel height / maximum notes listed** — how tall the results panel is and how many rows it renders (the header always reports the true total).

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

Manual connections and view preferences live in `data.json` inside the plugin folder. Nothing is written to your notes — the plugin only reads Obsidian's metadata cache, so it never modifies your vault.

## Project layout

```
src/
  main.ts      plugin entry: settings, commands, graph rebuild scheduling
  graph.ts     the tag graph — co-occurrence, metrics, pruning, traversal
  view.ts      the view shell: toolbar, mode switching, details panel
  cloud.ts     tag cloud renderer with FLIP re-grouping
  map.ts       force-directed canvas mind-map
  tree.ts      expandable relation tree
  settings.ts  settings tab and defaults
  modals.ts    fuzzy tag picker
  host.ts      the interface renderers see
```

The graph rebuilds on vault changes, debounced by ~1s so bursts of edits cost one rebuild.

## Design decisions

The reasoning behind the bigger architectural choices — flat tags plus a relation graph, the two relation sources, sharing one graph across three views, hand-rolling the mind-map's force layout instead of pulling in a graph library, and why the notes panel is a snapshot rather than a live query — is recorded in [docs/adr/](docs/adr/).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
