# 8. Tag groups are themselves tags

## Status

Accepted. Builds on [ADR 0001](0001-flat-tags-with-a-relation-graph.md) and
[ADR 0007](0007-nested-tags-are-out-of-scope.md).

## Context

ADR 0001 replaced nested tags with a relation graph, and ADR 0007 closed the door on nesting entirely. That left one thing nesting genuinely did well unreplaced: *containment*. Relations answer "what is this near?", but not "what is this part of?". A vault with two hundred flat tags is navigable by relation and still shapeless — there is no way to say "these fifteen tags are the health ones" and then browse them as a unit.

The request was for named tag-cloud groups: pick a name, put tags in it, and browse the groups as collapsible clouds or as a tree. Two constraints came with it, both directly inherited from why nesting was rejected: a tag must be able to sit in several groups at once, and tags themselves must stay flat.

The obvious implementation is a separate `TagGroup { id, name, tags[] }` object. It was rejected once the third constraint arrived — the structure should be three levels (group → sub-group → tag), with a sub-group able to act as an ordinary member of other groups, and a group demotable into a sub-group as long as it holds no sub-groups of its own.

Under a separate-object model, "a sub-group behaves like a tag when it is a member" needs groups and tags to be interchangeable in every list, picker, view and menu — which is a slow way of discovering they should have been the same type all along. The vocabulary the request itself used ("main-group-tag", "sub-group-tag", "simple-tag") had already reached that conclusion.

## Decision

**A group is a tag that contains other tags.** There is no separate group object, no group name distinct from a tag name, and no second vocabulary.

Membership is stored as a flat list of `{ parent, child }` links in plugin settings, exactly like manual connections. From that list everything else is derived rather than stored:

- A tag with members is a **group**; a group that something else contains is a **sub-group**; everything else is a **simple tag**. Promotion and demotion are therefore just adding or removing a parent link — there is no state to migrate and no way for a stored level to disagree with the structure.
- Membership is a **directed acyclic graph, not a tree**, because a tag may belong to several groups. This is the capability nesting could not offer at all, and it is why the group views can legitimately show the same tag more than once.

Depth is capped at three levels by a **single invariant checked on every insertion**:

```
ancestorDepth(parent) + 1 + descendantDepth(child) <= 2
```

Every rule the three-level cap implies falls out of that one expression, which is why it is stated once rather than as a list of special cases:

| Situation | Arithmetic | Result |
| --- | --- | --- |
| Plain tag into a main group | 0 + 1 + 0 | allowed |
| Plain tag into a sub-group | 1 + 1 + 0 | allowed — this is the third level |
| Group of plain tags into a main group | 0 + 1 + 1 | allowed — it becomes a sub-group |
| Group into a sub-group | 1 + 1 + 1 | refused — a sub-group holds only plain tags |
| Group holding sub-groups, into anything | 0 + 1 + 2 | refused — it cannot be demoted |

Refusals carry the specific rule they hit rather than a generic "not allowed", because the constraint is not obvious from outside and a silent refusal would read as a bug.

Group membership also becomes a **third source of edges** in the relation graph, alongside co-occurrence and manual links. Containment edges are structural: they always score full strength, are never pruned, and record which end is the parent so views can draw direction. They are coloured per level-pairing (group→sub-group, group→tag, sub-group→tag) so the structure stays legible inside the relation graph rather than being indistinguishable from an ordinary relation. A setting turns them off for anyone who wants groups to be organisation only.

## Consequences

- Groups inherit everything tags already have — a note count, relations, renaming, a place in the cloud, the context menu — with no extra code. A group is browsable, searchable and pinnable because it *is* a tag.
- Renaming a group is renaming a tag, so it flows through the existing rename machinery, including its preview and its manual-link remapping. Group links follow a rename the same way manual links do.
- A group can exist with no notes at all, since the graph already materialises tags that only manual links name. An empty organisational scaffold costs nothing.
- The same tag appearing twice in the groups view is correct, not a duplicate to be deduplicated. Views must be written knowing this.
- Cycles cannot be created through the UI, but a hand-edited `data.json` could contain one, so every traversal carries a visited set. Depth queries are cycle-safe by construction rather than by assuming good input.
- The three-level cap is a real limit, and someone will eventually want a fourth. That is a deliberate trade discussed in [ADR 0009](0009-three-or-three-plus-one.md): the cap is what keeps the model comprehensible and the views bounded, and unlimited depth would rebuild the hierarchy problem ADR 0001 removed.
- Nothing here touches note content. Reorganising the entire group structure is a plugin-data edit, which is precisely the property that made this preferable to nesting.
