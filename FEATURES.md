# Features

Every implemented feature, in brief. See [README.md](README.md) for how to use them and [docs/adr/](docs/adr/) for why they work the way they do.

## Relations

- Relations inferred from tag co-occurrence — two tags relate when they share a note
- Relation strength by **Jaccard** (default), **cosine**, or **raw co-occurrence**
- Manual tag-to-tag connections, declared by hand, always at full strength
- Manual connections can name a tag no note carries yet
- Manual connections survive all pruning and render distinctly (dashed)
- Prune by minimum shared notes, and by minimum relation strength
- Case-insensitive tag folding (toggleable)
- Exclude tags and folders; excluding a tag excludes its nested children
- Debounced rebuild on vault change, delete, and rename
- Nested tags relate to their parent — legacy compatibility only, see [ADR 0007](docs/adr/0007-nested-tags-are-out-of-scope.md)

## Tag groups

- A group is a tag that holds other tags — no separate object, no second vocabulary
- A tag can belong to many groups at once (membership is a DAG, not a tree)
- Three levels: group → sub-group → tag, enforced by one depth invariant
- A sub-group holds only plain tags; a group demotes only if it holds no sub-groups
- Refusals name the specific rule they hit
- Groups view: collapsible clouds, or an indented tree
- Sub-groups can optionally also appear as top-level sections
- Containment draws as coloured connections, one colour per level pairing
- Group connections can be switched off entirely (organisation only)
- Level styling by size, shadow and colour — subtle / balanced / bold, or custom
- Level filters: plain tags, tags + groups, all levels separated, all levels together
- Nothing is written to your notes; grouping lives in plugin data

## Cloud view

- Every tag, sized by note count (logarithmic, so big tags don't dominate)
- Sort by name A→Z / Z→A, note count ascending / descending, or relatedness
- Live text filter; selected tags stay visible even when they don't match
- Selecting shades related tags by strength and dims unrelated ones
- Re-groups into Selected / Related / Unrelated, related strongest-first
- Animated re-grouping (FLIP), so tags visibly travel to their new position
- Inline rename control on each tag in edit mode
- Three layouts: icons (weighted cloud), list, and a details table
- Up to 10 pinned tags held at the top in every layout
- Pan by dragging empty space; Ctrl/Cmd+wheel zooms about the cursor
- Zoom level remembered between sessions

## Mind-map view

- Force-directed layout on canvas, no graph library
- One selected tag pins at the centre; several share a central ring
- Neighbourhood drawn by hop distance, depth 1–5, capped by node count
- Stronger relations pull tags closer; edge width and opacity track strength
- Manual connections drawn dashed and accented
- Pan, wheel-zoom toward the cursor, drag nodes, click to re-centre
- Zoom in/out, fit-to-view, and re-run-layout controls
- Hover highlights a tag's own relations; labels adapt to zoom and density
- Whole-vault mode draws every tag and connection at once, with a truncation notice

## Tree view

- Expandable outline rooted at the selection, one root per selected tag
- Branches are the strongest relations, capped per node
- Cycle-free: a tag never repeats within its own ancestor path
- Configurable auto-expand depth
- With nothing selected, lists the most-connected tags as entry points
- Inline rename control on each row in edit mode

## Selection

- Works identically in all three views
- Click selects one; clicking the only selected tag clears it
- Ctrl/Cmd or Shift click toggles a tag in or out
- Sticky multi-select makes every plain click additive
- Click empty background to clear
- Related = related to **any** selected tag; strength = the **strongest** single tie
- Selection survives switching views

## Notes panel

- **Show notes** freezes the notes matching the selection into a list
- Match mode: **All tags** (intersection) or **Any tag** (union)
- Under Any, each result shows how many selected tags it carries, ranked
- The list is a snapshot — exploring the graph never disturbs it
- Marks itself **Outdated** when selection, match mode, or vault moves on
- Click a result to open it; Ctrl/Cmd click opens a new tab
- Configurable panel height and rendered-result cap

## Creating notes

- New note button in the toolbar, plus a command; the whole feature is toggleable
- Title from the current date and time, `YYYYMMDDHHmm` by default
- Configurable format with moment-style tokens and `[literal]` escaping
- Eight format presets, with a live filename preview in settings
- Any IANA timezone, or the system default; an unknown zone falls back rather than failing
- Configurable target folder, created if missing; otherwise Obsidian's own default location
- The current tag selection written into the new note's frontmatter (toggleable)
- Optionally opens the note after creating it
- Filenames sanitised; same-minute collisions get a numeric suffix

## Editing

> These write to your notes. Everything else only reads them.

- Rename a tag across the vault, with a live preview of the blast radius
- Rename warns when the target exists (the tags merge)
- Rename can carry nested children along (legacy, see ADR 0007)
- Assign an existing **or brand-new** tag to notes — one picker for both
- New tags written to frontmatter (default) or the end of the note body
- Remove a tag from notes, scoped to the vault or to the notes panel's list
- Bulk edits confirm first, listing every affected note
- Renames update the plugin's own manual connections, dropping self-links and duplicates
- Edits use Obsidian's recorded tag positions — code blocks, `#fragment` URLs and `# Headings` are never touched
- Cached positions verified against live text before writing; a stale cache skips rather than corrupts
- Frontmatter shape preserved: list stays list, string stays string, `#` prefix per entry

## Details panel

- Note count and relation count for the selection
- Related-tag list with strength bars, click to navigate
- Removable chips for a multi-tag selection
- Vault summary when nothing is selected: tag, relation and manual-link counts, plus most-connected tags
- Search action covering the whole selection, joined by `AND` or `OR` per match mode
- Edit-tags group: rename, add tag, remove tag

## Everywhere else

- Double-click any tag to search notes for it
- Right-click any tag: select, add/remove from selection, search, rename, add tag, remove tag, connect, disconnect, copy
- Toggleable details panel and edit mode
- Rescan-vault action
- View mode, sort, match mode and panel state persist between sessions

## Commands

- Open tag relations · Open tag relations in sidebar
- Focus a tag · Connect two tags · Create a new note
- Rename a tag
- Add a tag to the active note · Remove a tag from the active note
- Rescan vault for tags

## Project

- Zero runtime dependencies; single bundled `main.js`
- `npm run package` produces a manual-install folder and flat release assets
- 274 tests across 53 suites (`npm test`)
- Architecture decisions recorded in [docs/adr/](docs/adr/)
