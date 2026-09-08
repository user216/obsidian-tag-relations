# Vocabulary

The words this plugin uses, what each one means precisely, and — where they differ — what the code calls the same thing.

Several of these words are ordinary English that has been given a narrow meaning here. Where a term is easy to confuse with a neighbour, the entry says what it is *not*.

---

## The three kinds of tag

Every tag is exactly one of these. A tag's kind is **derived from the structure, never stored** — so it changes the moment you add or remove a containment, and cannot fall out of step with reality.

| Term | Means | Code |
| --- | --- | --- |
| **Tag** | A plain tag. Holds nothing, and that is the normal case. | `TagLevel = "simple"` |
| **Sub-tag** | A tag that holds other tags **and** is itself held by another tag. | `TagLevel = "sub"` |
| **Main-tag** | A tag that holds other tags and is **not** held by anything. | `TagLevel = "main"` |

A tag becomes a main-tag simply by being given its first member — there is no separate "create a group" step, and no separate group object. **A group is a tag.** ([ADR 0008](docs/adr/0008-tag-groups-are-tags.md))

A main-tag *becomes* a sub-tag by being put inside something. That is the only difference between them.

> **Not to be confused with: nested tags.** `#area/health` is Obsidian's own nested-tag syntax, where hierarchy is encoded in the tag's *name*. This plugin exists to avoid that, and treats nested tags as legacy only ([ADR 0007](docs/adr/0007-nested-tags-are-out-of-scope.md)). A sub-tag has nothing to do with a `/` in a name.

---

## The three kinds of relation

Two tags can be related in three different ways. They look similar in the views but come from completely different places, which matters enormously when you try to *remove* one.

| Term | Where it comes from | Removable? |
| --- | --- | --- |
| **Shared notes** (co-occurrence) | Observed: two tags appear on the same note | **No** — nothing is stored to delete. You would have to edit the notes. |
| **Horizontal link** | Declared: you said these two tags are related | Yes — it is plugin data |
| **Group membership** (containment) | Declared: you put one tag inside another | Yes — it is plugin data |

**Horizontal link** is the important one to get right. It joins two tags *without* creating any hierarchy — neither tag contains the other, they are simply associated. It is the answer to "these belong together" when "one is part of the other" would be wrong.

> **Code note:** horizontal links are called **manual links** throughout the source (`ManualLink`, `manualLinks`, `edge.manual`). The internal name predates the user-facing one and was deliberately left alone — see [ADR 0002](docs/adr/0002-relation-sources-cooccurrence-and-manual-links.md). If you are reading code, "manual link" and "horizontal link" are the same thing.

**Relation strength** is a 0–1 number. Shared-note relations are scored by the chosen metric (Jaccard, cosine, or raw count); horizontal links and group membership are always exactly 1, because you declared them and there is nothing to estimate.

---

## Structure

- **Containment** — one tag holding another. The general word covering both main-tag→sub-tag and →tag.
- **Member** — a tag held by another. `#running` is a member of `#health`.
- **Parent** — the holding tag, from the member's point of view. A tag can have **many parents**: membership is a graph, not a tree, and that is the whole advantage over nesting.
- **Depth** — how many containments deep. Capped at three levels: main-tag → sub-tag → tag. Enforced by one rule on every insertion: `ancestorDepth(parent) + 1 + descendantDepth(child) ≤ 2`.
- **Ungrouped** — a tag no other tag holds. Shown in its own section of the Groups view so nothing is unreachable.

---

## Working with tags

- **Selection** — the tags you have currently picked, in the order you picked them. Ctrl/Cmd or Shift click adds; a plain click replaces.
- **Target** — the single tag the button bar acts on: the **last** tag you selected. Shown at the left of the bar so it is never ambiguous.
- **Pinned** — up to ten tags held at the top of the cloud regardless of sort. A shortlist, not a second cloud.
- **Related to the selection** — related to **any** selected tag (a union, not an intersection — an intersection is empty too often to explore with).
- **Strength to the selection** — the **strongest single tie** to any selected tag, not a sum or average. A tag is as relevant as its closest connection.

---

## Views

- **Cloud** — every tag at once, sized by note count. Has three **layouts**: *icons* (the weighted cloud), *list* (one per line), *details* (a sortable table).
- **Mind-map** — a force-directed graph. Selecting pins tags at the centre and lays their relations around them.
- **Tree** — an outline that walks outward one relation at a time, strongest first.
- **Groups** — the containment structure. Two **layouts**: *collapsible clouds* and *tree*.

> **Layout vs. view.** A *view* is which of the four you are in; a *layout* is how that view arranges itself. The cloud has three layouts; the groups view has two.

- **Level filter** — which of the three tag kinds a view draws, and whether it separates them into bands or mixes them together.
- **Notes panel** — the list produced by "Show notes". It is a **snapshot**: it fills only when you press the button, and marks itself *Outdated* rather than silently changing ([ADR 0005](docs/adr/0005-multi-select-and-a-frozen-notes-panel.md)).
- **Match mode** — whether the notes panel wants notes carrying **all** the selected tags (intersection) or **any** of them (union).
- **Action bar** — the optional row of buttons giving every tag action a button, so nothing is reachable only by right-clicking.
- **New note dialog** — the tag picker shown when creating a note. Starts from the current selection; tags can be added or removed before the note is made.

---

## Editing

These are the only operations that **write to your notes**. Everything else in this document is plugin data.

- **Rename** — change a tag's name everywhere in the vault. Rewrites notes.
- **Assign** — add a tag to notes. Rewrites notes.
- **Remove from notes** — delete a tag from notes. Rewrites notes.
- **Blast radius** — how many notes and occurrences an edit will touch, shown before you confirm.

> **"Remove" is three different things.** Read carefully, because two are cheap and one is not:
>
> | Action | Touches | Undo |
> | --- | --- | --- |
> | **Remove this relation** | Plugin data only | Just make it again |
> | **Remove all relations** | Plugin data only | Just make them again |
> | **Remove this tag from all notes** | **Your notes** | Not covered by Obsidian's undo |

---

## Under the hood

Words you will only meet in the code or the architecture notes.

- **Graph** — the in-memory model: tags as nodes, relations as edges, rebuilt from the vault whenever it changes.
- **Edge kind** — which sort of relation an edge is, used to colour it: shared notes, horizontal link, or one of the three containment pairings.
- **Level styling** — the size, shadow and colour that tell the three tag kinds apart on screen.
- **Snapshot** — a frozen result set that does not follow the selection.
- **Plan / apply** — every note-editing operation is planned from the metadata cache first, so its blast radius can be shown before anything is written ([ADR 0006](docs/adr/0006-writing-tag-edits-back-to-notes.md)).

---

## Related reading

- [README.md](README.md) — how to use the features these words describe
- [FEATURES.md](FEATURES.md) — the complete list
- [ARCHITECTURE.md](ARCHITECTURE.md) — how it is built
- [docs/adr/](docs/adr/) — why the significant decisions went the way they did
