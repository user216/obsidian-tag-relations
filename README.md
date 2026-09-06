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

## Everywhere
- **Details panel** (right side, toggleable) — note count, relation count, the full related-tag list with strength bars, and the notes carrying the tag. Click a note to open it.
- **Double-click** any tag in any view to search your notes for it.
- **Right-click** any tag for: focus, search, connect to another tag, remove a connection, copy.
- **Filter box** narrows every view live.

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

## Install

The plugin isn't in the community catalogue, so install it manually.

```bash
npm install
npm run package
```

`npm run package` builds the plugin and writes everything you need under `dist/`:

- `dist/tag-relations/` — a ready-to-copy plugin folder
- `dist/tag-relations-<version>.zip` — the same folder, zipped, for sharing as one file
- `dist/main.js`, `dist/manifest.json`, `dist/styles.css` — flat copies, for attaching as individual assets to a GitHub release (the layout [BRAT](https://github.com/TfTHacker/obsidian42-brat) and Obsidian's plugin installer expect)

Copy `dist/tag-relations/` (or extract the zip) into your vault:

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

The reasoning behind the bigger architectural choices — flat tags plus a relation graph, the two relation sources, sharing one graph across three views, and hand-rolling the mind-map's force layout instead of pulling in a graph library — is recorded in [docs/adr/](docs/adr/).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
