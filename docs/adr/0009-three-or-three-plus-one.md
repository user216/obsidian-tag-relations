# 9. Prefer threes, composed rather than flattened

## Status

Accepted as a design heuristic, not a rule. Guides future decisions rather than constraining any existing one.

## Context

Across this plugin the same shape kept appearing without being planned: three relation metrics, three tag levels, three cloud layouts, three editing operations, three sources of connection. When the groups feature was designed, the depth cap landed on three levels too, and the level-style options landed on three presets plus a custom mode.

That is frequent enough to be worth writing down, because the alternative — deciding the number of options afresh every time — reliably drifts upward. Each new option looks individually justified, and the cost only shows up in aggregate: a settings page nobody reads, a menu nobody finishes scanning, and combinations nobody has tested.

The observation is not original, and it should not be dressed up as a law. Roughly: a set of three is large enough to cover a real spread of intent and small enough to hold in the head at once, be laid out side by side, and be exhaustively tested. Two often forces a false binary; five or more stops being a choice and starts being a configuration exercise. Where three genuinely will not cover the space, adding **one** clearly-marked escape hatch — "custom", "other", "advanced" — keeps the common path to three while leaving the uncommon path open.

That still leaves the case where the space is genuinely larger than four. The instinct there is to lengthen the list, and the better move is usually to **compose**: two staged decisions of three reach nine outcomes, three stages reach twenty-seven, and at no point is more than three on screen. This is what hierarchical menus have always done, and it is worth stating as part of the same heuristic rather than as a separate idea, because the question it answers — "what do I do when three is not enough?" — is the one that otherwise causes the drift.

## Decision

When designing a set of user-facing options, **default to three, or three plus an escape hatch.** Treat a fourth peer option as a prompt to check whether two of the others have collapsed into one, and treat six as a sign the axis is wrong.

When the space is genuinely bigger, **stack threes rather than lengthening the list.** The family:

| Shape | Reach | Use when |
| --- | ---: | --- |
| **3** | 3 | The choice is one axis with a clear spread |
| **3 + 1** | 3 + open | Three cover the common cases, but the space has no natural ceiling |
| **3 + 3** | 9 | Two independent axes, or a choice that meaningfully narrows what comes next |
| **3 + 3 + 3** | 27 | A genuine hierarchy — and the practical ceiling |

The reach column is the point: twenty-seven outcomes are addressable through three decisions of three, and a flat list of twenty-seven is unusable. But so is a fourth stage — eighty-one outcomes behind four choices is a maze, and nobody remembers the path back out.

**Plain threes**, where one set covers the whole axis — none of these were retrofitted:

| Set | The three | Escape hatch |
| --- | --- | --- |
| Relation metrics | Jaccard, cosine, raw co-occurrence | — |
| Tag levels | group, sub-group, tag | — (the cap *is* the decision, ADR 0008) |
| Cloud layouts | icons, list, details | — |
| Editing operations | rename, assign, remove | — |
| Connection sources | co-occurrence, manual, containment | — |
| Group connection kinds | group→sub, group→tag, sub→tag | — |
| Level style presets | subtle, balanced, bold | **custom** |
| Level filters | tags, +groups, all levels | **all levels, merged** |
| Views | cloud, mind-map, tree | **groups** |

The last two rows are the "3 + 1" case working as intended: three ordinary choices, plus one that changes the frame rather than being another peer.

**Composed threes**, where a second or third stage carries the rest of the space:

- **3 + 3 — custom level styling.** Three tag levels (group, sub-group, tag), each with three properties (size, shadow, colour). A 3×3 grid: nine values laid out as three rows of three, and nothing needs explaining twice.
- **3 + 3 — group connection kinds.** Three levels, taken pairwise as container-and-member, yield exactly three connection kinds (group→sub-group, group→tag, sub-group→tag). Here the second three is *derived* from the first rather than chosen, which is the cheapest kind of composition — it cannot drift out of step.
- **3 + 3 — view options.** Pick a view, then that view's own switches. The toolbar keeps a stable shape precisely because the second three lives behind the first instead of beside it.
- **3 + 3 + 3 — the group structure itself.** Group → sub-group → tag ([ADR 0008](0008-tag-groups-are-tags.md)). A group holding three sub-groups each holding three tags puts twenty-seven tags three clicks away, with never more than a handful on screen. The depth cap is not an arbitrary number — it is this shape, and a fourth level is exactly what the invariant exists to refuse.

**Where it does not hold, and should not be forced.** These are recorded as deliberate exceptions, not as debt:

- **Sort modes: five.** Name ascending/descending, count ascending/descending, and relatedness. These are three *axes* with a direction on two of them, and collapsing them would make sorting worse, not simpler.
- **Note match modes: two.** All tags or any tag. This is a genuine binary — set intersection or set union — and inventing a third would be padding.
- **Title format presets: eight.** A list to pick from rather than a decision to make; the user is scanning examples, not weighing options. Long lists are fine when they are examples, not choices.
- **Timezones: 418.** The extreme case of the same exception. Nobody weighs four hundred options against each other; they search for the one they already have in mind.

The distinction the exceptions draw is the useful part: **the heuristic applies to decisions, not to catalogues.** Three is about how many things someone must weigh against each other. It says nothing about how many items may sit in a list they are merely browsing.

**And composition is not free.** Three counter-pressures decide when to stack and when to flatten:

- **Composition helps exploration; flattening helps recall.** Someone discovering what a feature can do is well served by three-then-three. Someone who already knows they want the details layout is better served by seeing it immediately than by navigating to it. Where a user is likely to arrive knowing the answer, prefer the flat list even past three.
- **Every stage is indirection.** Nine outcomes behind two clicks are harder to *find* than nine in a list, even though each individual decision is easier. The gain is in the decision; the cost is in the discovery.
- **The reach column is also a test-count column.** 3 + 3 + 3 is twenty-seven combinations, and combinations are where untested states hide. This is not hypothetical here — the option surface is a large part of why this project carries 274 tests. Stacking threes buys clarity for the user and pays for it in the matrix someone has to verify.

## Consequences

- Option sets get a default answer, so the question "how many should there be?" is settled cheaply and consistently instead of relitigated per feature.
- A proposed fourth peer option becomes a design signal worth a moment's thought: is it really a fourth, or is it the escape hatch, or have two existing options merged?
- The heuristic can be wrong. It is recorded as a starting point that a specific case may overrule, and the exceptions above are as much a part of this ADR as the rule — an ADR that only listed confirmations would be advocacy rather than a record.
- Composition has a hard stop at three stages. If a design seems to want a fourth, that is evidence the axes are wrong, not that the ceiling should move — the same reasoning that caps group depth at three levels in ADR 0008.
- Choosing to compose is choosing a testing burden. A 3+3+3 design should come with an explicit decision about which of the twenty-seven combinations are actually exercised, rather than an assumption that they all work because each stage does.
- The three-level cap on groups (ADR 0008) is the highest-stakes place this applies. It is a genuine limit on expressiveness, chosen because unlimited depth would rebuild the hierarchy problem ADR 0001 removed. If it ever proves too tight, this ADR is not the reason to keep it — the argument in ADR 0008 is.
