# 9. Prefer three options, or three plus an escape hatch

## Status

Accepted as a design heuristic, not a rule. Guides future decisions rather than constraining any existing one.

## Context

Across this plugin the same shape kept appearing without being planned: three relation metrics, three tag levels, three cloud layouts, three editing operations, three sources of connection. When the groups feature was designed, the depth cap landed on three levels too, and the level-style options landed on three presets plus a custom mode.

That is frequent enough to be worth writing down, because the alternative — deciding the number of options afresh every time — reliably drifts upward. Each new option looks individually justified, and the cost only shows up in aggregate: a settings page nobody reads, a menu nobody finishes scanning, and combinations nobody has tested.

The observation is not original, and it should not be dressed up as a law. Roughly: a set of three is large enough to cover a real spread of intent and small enough to hold in the head at once, be laid out side by side, and be exhaustively tested. Two often forces a false binary; five or more stops being a choice and starts being a configuration exercise. Where three genuinely will not cover the space, adding **one** clearly-marked escape hatch — "custom", "other", "advanced" — keeps the common path to three while leaving the uncommon path open.

## Decision

When designing a set of user-facing options, **default to three, or three plus an escape hatch.** Treat a fourth peer option as a prompt to check whether two of the others have collapsed into one, and treat six as a sign the axis is wrong.

Where this already holds, with no retrofitting:

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

**Where it does not hold, and should not be forced.** These are recorded as deliberate exceptions, not as debt:

- **Sort modes: five.** Name ascending/descending, count ascending/descending, and relatedness. These are three *axes* with a direction on two of them, and collapsing them would make sorting worse, not simpler.
- **Note match modes: two.** All tags or any tag. This is a genuine binary — set intersection or set union — and inventing a third would be padding.
- **Title format presets: eight.** A list to pick from rather than a decision to make; the user is scanning examples, not weighing options. Long lists are fine when they are examples, not choices.

The distinction the exceptions draw is the useful part: **the heuristic applies to decisions, not to catalogues.** Three is about how many things someone must weigh against each other. It says nothing about how many items may sit in a list they are merely browsing.

## Consequences

- Option sets get a default answer, so the question "how many should there be?" is settled cheaply and consistently instead of relitigated per feature.
- A proposed fourth peer option becomes a design signal worth a moment's thought: is it really a fourth, or is it the escape hatch, or have two existing options merged?
- The heuristic can be wrong. It is recorded as a starting point that a specific case may overrule, and the exceptions above are as much a part of this ADR as the rule — an ADR that only listed confirmations would be advocacy rather than a record.
- The three-level cap on groups (ADR 0008) is the highest-stakes place this applies. It is a genuine limit on expressiveness, chosen because unlimited depth would rebuild the hierarchy problem ADR 0001 removed. If it ever proves too tight, this ADR is not the reason to keep it — the argument in ADR 0008 is.
