# 4. Hand-rolled canvas force layout instead of a graph library

## Status

Accepted

## Context

The mind-map view (ADR 0003) needs a force-directed layout: nodes repel each other, edges act as springs pulling related tags together, and the selected tag stays pinned while everything else settles around it. The standard way to get this in a web project is a library — d3-force is the common choice inside Obsidian plugins (the core graph view itself is d3-based), and libraries like cytoscape.js offer a full graph-rendering stack including layout, rendering, and interaction.

Pulling in d3-force (or a heavier library like cytoscape.js) was the default option and was seriously considered, since re-implementing a force simulation is exactly the kind of thing "don't reinvent the wheel" warns against. Against that:

- Obsidian plugins are downloaded and loaded as a single `main.js` on every vault open; bundle size is a real, user-facing cost, not an abstract build metric. d3-force alone pulls in d3-quadtree, d3-dispatch, and d3-timer; cytoscape.js is an order of magnitude larger still, and both bring far more surface area (their own event systems, their own layout plugins, their own rendering assumptions) than this view needs.
- The actual physics required is small: pairwise repulsion, spring edges toward a target distance derived from relation strength, a weak centering force, and velocity damping. This is a few dozen lines, not a subsystem.
- The interaction model needed (pin the selected node, seed new nodes on a ring sized by hop-distance so the first frame already looks reasonable, drag-to-reposition, click-to-recenter, zoom-toward-cursor) is bespoke enough that a general-purpose library's defaults would need overriding in most of the places that matter anyway.
- Rendering to `<canvas>` directly (rather than SVG, which is what d3 typically drives and what cytoscape.js can also target) keeps redraw cost flat regardless of node count, which matters because the map can show up to `mapMaxNodes` (default 160, configurable) nodes at once, each redrawn on every simulation tick during layout settling.

## Decision

`src/map.ts` implements its own minimal force simulation (pairwise repulsion, spring edges weighted by relation strength, centering, velocity damping, alpha cooldown) and draws directly to a `<canvas>` element with manual hit-testing for pointer interaction (click, drag, hover, wheel-zoom-toward-cursor, pan). No graph or physics library is a dependency.

## Consequences

- Zero additional runtime dependencies for the plugin's most visually complex view; the production bundle stays small (~44 KB at time of writing) since esbuild only has the plugin's own code and Obsidian's typings (a dev-only, externalized dependency) to bundle.
- The simulation is tuned specifically for this use case (tag counts in the tens to low hundreds, not thousands of nodes, not requiring perfectly stable/reproducible layouts) rather than being a general-purpose tool. It would not scale gracefully to a vault with thousands of distinct tags without revisiting `mapMaxNodes` and the O(n²) repulsion pass in `step()`.
- Canvas rendering means individual nodes are not DOM elements — there is no CSS styling per node, no built-in accessibility tree for screen readers, and all hit-testing (`hitTest` in `map.ts`) is manual distance-to-cursor math rather than the browser's native event targeting. This is an accepted trade-off for this view; the cloud and tree views use real DOM elements specifically so they remain keyboard- and screen-reader-friendlier.
- Future maintenance of the force math is the plugin's own responsibility — there is no upstream library to pick up bug fixes or performance improvements from. Given how small and self-contained the simulation is (`step()` is under 50 lines), this was judged an acceptable trade against the bundle-size and control benefits.
