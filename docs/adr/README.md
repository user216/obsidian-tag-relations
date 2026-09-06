# Architecture Decision Records

This directory records the significant architectural decisions made for the Tag Relations plugin, in the lightweight [Michael Nygard ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions): context, decision, consequences.

An ADR is written when a decision is hard to reverse, affects more than one part of the plugin, or would otherwise need re-explaining to a future contributor (including a future session of whoever is working on this). It is not written for routine implementation choices that a normal code review would settle on its own.

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-flat-tags-with-a-relation-graph.md) | Flat tags with a relation graph instead of nested tags | Accepted |
| [0002](0002-relation-sources-cooccurrence-and-manual-links.md) | Relation sources: co-occurrence metrics plus manual links | Accepted |
| [0003](0003-three-complementary-views-on-one-graph.md) | Three complementary views sharing one graph model | Accepted |
| [0004](0004-hand-rolled-canvas-force-layout.md) | Hand-rolled canvas force layout instead of a graph library | Accepted |
