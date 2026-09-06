# 5. Multi-tag selection and a frozen notes panel

## Status

Accepted

## Context

Two related capabilities were requested: selecting several tags at once in every view, and a button that lists the notes carrying the selected tags.

Multi-selection raised questions the single-selection model never had to answer:

- **What does "related" mean against several tags?** Union (related to any selected tag) or intersection (related to all of them)? Intersection is empty far too often to be useful for exploration — with three selected tags it usually yields nothing.
- **How does the mind-map center?** Single selection pins one tag at the origin. With several, there is no single center.
- **What does the tree root on?** It walks outward from one root.
- **How is a tag's relation strength shown when it ties to several selected tags at different strengths?**

The notes panel raised a sharper question: should the list follow the selection live, or only update when asked? A live list is the more conventional choice and needs no button at all. But the request specified a button and the word "statically", and there is a real reason to prefer it: exploring a tag graph means clicking through many tags in quick succession, and a live note list would thrash on every click, re-querying and re-rendering constantly while the user is still deciding what they care about. It also makes the list unusable as a reference — you cannot look at a result set and then click around the graph to investigate it, because the moment you click, the results are gone.

The risk of a frozen list is the opposite failure: the user changes the selection, forgets the list is a snapshot, and reads stale results as current.

## Decision

**Selection** is an ordered `string[]` on the view shell rather than a single nullable tag. A plain click replaces the selection (and clears it if you click the only selected tag); Ctrl/Cmd or Shift click toggles a tag in or out. A "sticky multi-select" toggle makes plain clicks additive too, for touch devices and for long multi-select sessions where holding a modifier is tiresome. Renderers never implement this convention themselves — they call `ViewHost.selectFromEvent(tag, event)`, which owns the modifier rules in one place.

Multi-selection semantics follow "closest tie wins":

- Relatedness is a **union**: a tag is related to the selection if it relates to any selected tag.
- A tag's strength against the selection is the **maximum** over the selected tags (`TagGraph.maxStrengthTo`), not the sum or average — a tag is as relevant as its strongest tie, and tooltips name which selected tag that tie is to.
- The **mind-map** pins one selected tag at the origin, or arranges several on a small ring at the center, so the focus cluster stays centered and neighbors settle outside it.
- The **tree** grows one root per selected tag rather than inventing a merged root.
- The **cloud** groups into Selected / Related / Unrelated exactly as before, with the selected group now holding several tags.

**The notes panel is a snapshot.** Pressing "Show notes" (or the inspector's equivalent) freezes the current selection, the current match mode, and the resulting note list into a `NotesSnapshot`. Nothing else fills it. Changing the selection, changing the match mode, or a vault rebuild does not refresh it — instead the panel marks itself **Outdated** with a badge explaining why, and a refresh button rebuilds it from the current state.

Whether a note must carry *every* selected tag or *at least one* is a user-facing match mode ("All tags" / "Any tag") rather than a fixed rule, since both are genuinely useful: intersection for narrowing, union for gathering. Under "Any tag" each result shows how many of the selected tags it carries, and results sort by that count.

## Consequences

- Clicking through the graph stays cheap: no note query runs until the user asks for one, so exploration never triggers repeated vault-wide matching.
- A result list survives further exploration, which is what makes it useful as a working reference — you can list notes for a tag pair, then keep clicking around the map to understand them without losing the list.
- The staleness indicator is load-bearing, not decoration. Without it the frozen list would be actively misleading, so any new way of mutating selection, match mode, or the graph must keep `snapshotDirty`/`isSnapshotStale` honest.
- `ViewHost` grew from one selection accessor to several (`isSelected`, `isRelatedToSelection`, `selectionStrength`, `select`, `selectFromEvent`, `clearSelection`). This is more surface area, but it keeps every renderer free of selection bookkeeping and modifier-key conventions.
- The previous live per-tag note list in the details panel was removed. Keeping it would have meant two note lists with different refresh semantics side by side, which is exactly the confusion the snapshot model is meant to avoid.
- Taking the maximum rather than summing strengths means a tag weakly tied to all three selected tags ranks below one strongly tied to just one of them. That matches "show me what is closest to something I care about" better than "show me what is broadly adjacent to my whole selection", but it is a deliberate choice, not a neutral one.
