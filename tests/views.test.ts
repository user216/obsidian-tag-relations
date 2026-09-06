import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TagGraph } from "../src/graph";
import type { GraphBuildOptions } from "../src/graph";
import { branchChildren } from "../src/tree";
import { anchorPositions, collectMapNodes } from "../src/map";
import { scaleByCount, hasToggleModifier } from "../src/host";
import { remapManualLinks } from "../src/links";
import { splitList, DEFAULT_SETTINGS } from "../src/settings";
import { MATCH_LABELS, SORT_LABELS } from "../src/types";

function graphOf(vault: Record<string, string[]>): TagGraph {
	const app: any = {
		vault: { getMarkdownFiles: () => Object.keys(vault).map((path) => ({ path })) },
		metadataCache: {
			getFileCache: (file: { path: string }) => ({
				tags: (vault[file.path] ?? []).map((tag) => ({ tag })),
			}),
		},
	};
	const options: GraphBuildOptions = {
		metric: "jaccard",
		minCooccurrence: 1,
		minWeight: 0,
		caseSensitive: false,
		linkNestedTags: true,
		excludedTags: [],
		excludedFolders: [],
		manualLinks: [],
	};
	const graph = new TagGraph();
	graph.build(app, options);
	return graph;
}

const GRAPH = graphOf({
	"1.md": ["#project", "#work", "#urgent"],
	"2.md": ["#project", "#work"],
	"3.md": ["#work", "#home"],
	"4.md": ["#home", "#garden"],
	"5.md": ["#project", "#idea"],
});

describe("tree branching", () => {
	test("returns the strongest relations of the last tag in the path", () => {
		assert.deepEqual(branchChildren(GRAPH, ["#work"], 10), [
			"#project",
			"#urgent",
			"#home",
		]);
	});

	test("respects the child cap", () => {
		assert.deepEqual(branchChildren(GRAPH, ["#work"], 2), ["#project", "#urgent"]);
		assert.deepEqual(branchChildren(GRAPH, ["#work"], 0), []);
	});

	test("never revisits a tag already in the path", () => {
		// This is what stops a branch bouncing between two tags forever.
		const children = branchChildren(GRAPH, ["#project", "#work"], 10);
		assert.equal(children.includes("#project"), false);
		assert.equal(children.includes("#work"), false);
		assert.deepEqual(children, ["#urgent", "#home"]);
	});

	test("a tag with no relations has no children", () => {
		const lonely = graphOf({ "1.md": ["#solo"] });
		assert.deepEqual(branchChildren(lonely, ["#solo"], 10), []);
	});

	test("an unknown tag has no children", () => {
		assert.deepEqual(branchChildren(GRAPH, ["#ghost"], 10), []);
	});
});

describe("map node collection", () => {
	const pool = new Set(GRAPH.tagList);

	test("with no selection, shows the most-used tags first", () => {
		const nodes = collectMapNodes(GRAPH, pool, [], 2, 100);
		assert.equal(nodes.length, GRAPH.tagList.length);
		assert.equal(GRAPH.countOf(nodes[0].tag), 3);
		assert.ok(nodes.every((n) => n.hop === 1));
	});

	test("with a selection, walks out by hop distance", () => {
		const nodes = collectMapNodes(GRAPH, pool, ["#project"], 1, 100);
		const byTag = new Map(nodes.map((n) => [n.tag, n.hop]));
		assert.equal(byTag.get("#project"), 0);
		assert.equal(byTag.get("#work"), 1);
		assert.equal(byTag.has("#home"), false); // two hops away
	});

	test("deeper depth reaches further", () => {
		const nodes = collectMapNodes(GRAPH, pool, ["#project"], 2, 100);
		assert.equal(new Map(nodes.map((n) => [n.tag, n.hop])).get("#home"), 2);
	});

	test("results are ordered nearest-first", () => {
		const hops = collectMapNodes(GRAPH, pool, ["#project"], 3, 100).map(
			(n) => n.hop
		);
		assert.deepEqual(hops, hops.slice().sort((a, b) => a - b));
	});

	test("the node cap trims the furthest tags, keeping the selection", () => {
		const nodes = collectMapNodes(GRAPH, pool, ["#project"], 3, 2);
		assert.equal(nodes.length, 2);
		assert.equal(nodes[0].tag, "#project");
	});

	test("a selected tag survives even when filtered out of the pool", () => {
		const narrow = new Set(["#work"]);
		const nodes = collectMapNodes(GRAPH, narrow, ["#project"], 1, 100);
		assert.ok(nodes.some((n) => n.tag === "#project" && n.hop === 0));
	});

	test("a filtered pool limits which neighbours are drawn", () => {
		const narrow = new Set(["#work"]);
		const tags = collectMapNodes(GRAPH, narrow, ["#project"], 1, 100).map(
			(n) => n.tag
		);
		assert.deepEqual(tags.sort(), ["#project", "#work"]);
	});

	test("an empty pool and no selection draws nothing", () => {
		assert.deepEqual(collectMapNodes(GRAPH, new Set(), [], 2, 100), []);
	});
});

describe("map anchoring", () => {
	test("nothing selected anchors nothing", () => {
		assert.equal(anchorPositions([], 100).size, 0);
	});

	test("a single selection sits at the origin", () => {
		assert.deepEqual(anchorPositions(["#a"], 100).get("#a"), { x: 0, y: 0 });
	});

	test("several selections share a ring around the origin", () => {
		const anchors = anchorPositions(["#a", "#b", "#c"], 100);
		assert.equal(anchors.size, 3);
		const radii = Array.from(anchors.values()).map((p) =>
			Number(Math.hypot(p.x, p.y).toFixed(6))
		);
		assert.equal(new Set(radii).size, 1, "all on one circle");
		assert.ok(radii[0] > 0);
	});

	test("the ring is centred on the origin", () => {
		const points = Array.from(anchorPositions(["#a", "#b"], 100).values());
		const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
		const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
		assert.ok(Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9);
	});

	test("the ring grows with the number of selected tags", () => {
		const two = Math.hypot(...Object.values(anchorPositions(["#a", "#b"], 100).get("#a")!));
		const six = Math.hypot(
			...Object.values(
				anchorPositions(["#a", "#b", "#c", "#d", "#e", "#f"], 100).get("#a")!
			)
		);
		assert.ok(six > two);
	});

	test("link distance scales the ring", () => {
		const small = anchorPositions(["#a", "#b"], 50).get("#a")!;
		const large = anchorPositions(["#a", "#b"], 200).get("#a")!;
		assert.ok(Math.hypot(large.x, large.y) > Math.hypot(small.x, small.y));
	});
});

describe("scaleByCount", () => {
	test("maps onto 0..1", () => {
		assert.equal(scaleByCount(0, 10), 0);
		assert.equal(scaleByCount(10, 10), 1);
		const mid = scaleByCount(5, 10);
		assert.ok(mid > 0 && mid < 1);
	});

	test("is monotonic", () => {
		let previous = -1;
		for (let count = 0; count <= 20; count++) {
			const value = scaleByCount(count, 20);
			assert.ok(value >= previous);
			previous = value;
		}
	});

	test("compresses the top end so big tags do not dominate", () => {
		// Logarithmic: half the notes should be well past half the scale.
		assert.ok(scaleByCount(50, 100) > 0.5);
	});

	test("degenerate maximums do not divide by zero", () => {
		assert.equal(scaleByCount(0, 0), 0);
		assert.equal(scaleByCount(1, 1), 1);
		assert.equal(scaleByCount(0, 1), 0);
	});
});

describe("hasToggleModifier", () => {
	const event = (over: Record<string, boolean> = {}) =>
		({ ctrlKey: false, metaKey: false, shiftKey: false, ...over }) as MouseEvent;

	test("a plain click is not a toggle", () => {
		assert.equal(hasToggleModifier(event()), false);
	});

	test("ctrl, meta and shift each toggle", () => {
		assert.equal(hasToggleModifier(event({ ctrlKey: true })), true);
		assert.equal(hasToggleModifier(event({ metaKey: true })), true);
		assert.equal(hasToggleModifier(event({ shiftKey: true })), true);
	});
});

describe("remapManualLinks after a rename", () => {
	test("rewrites both ends", () => {
		const next = remapManualLinks(
			[{ a: "#old", b: "#other" }, { a: "#x", b: "#old" }],
			"#old",
			"#new",
			false,
			false
		);
		assert.deepEqual(next, [
			{ a: "#new", b: "#other" },
			{ a: "#x", b: "#new" },
		]);
	});

	test("leaves unrelated links alone", () => {
		const links = [{ a: "#p", b: "#q" }];
		assert.deepEqual(remapManualLinks(links, "#old", "#new", false, false), links);
	});

	test("drops a link the rename collapses onto itself", () => {
		const next = remapManualLinks(
			[{ a: "#old", b: "#new" }],
			"#old",
			"#new",
			false,
			false
		);
		assert.deepEqual(next, []);
	});

	test("drops duplicates the rename creates", () => {
		const next = remapManualLinks(
			[{ a: "#old", b: "#z" }, { a: "#new", b: "#z" }],
			"#old",
			"#new",
			false,
			false
		);
		assert.equal(next.length, 1);
	});

	test("treats reversed duplicates as the same link", () => {
		const next = remapManualLinks(
			[{ a: "#old", b: "#z" }, { a: "#z", b: "#new" }],
			"#old",
			"#new",
			false,
			false
		);
		assert.equal(next.length, 1);
	});

	test("preserves the label", () => {
		const next = remapManualLinks(
			[{ a: "#old", b: "#z", label: "kind of" }],
			"#old",
			"#new",
			false,
			false
		);
		assert.equal(next[0].label, "kind of");
	});

	test("folds case unless told otherwise", () => {
		assert.equal(
			remapManualLinks([{ a: "#Old", b: "#z" }], "#old", "#new", false, false)[0].a,
			"#new"
		);
		assert.equal(
			remapManualLinks([{ a: "#Old", b: "#z" }], "#old", "#new", false, true)[0].a,
			"#Old"
		);
	});

	test("carries nested children only when asked (legacy, ADR 0007)", () => {
		assert.equal(
			remapManualLinks([{ a: "#old/child", b: "#z" }], "#old", "#new", true, false)[0].a,
			"#new/child"
		);
		assert.equal(
			remapManualLinks([{ a: "#old/child", b: "#z" }], "#old", "#new", false, false)[0].a,
			"#old/child"
		);
	});

	test("an empty link list stays empty", () => {
		assert.deepEqual(remapManualLinks([], "#old", "#new", false, false), []);
	});
});

describe("settings", () => {
	test("splitList accepts commas and newlines and trims", () => {
		assert.deepEqual(splitList("a, b\nc"), ["a", "b", "c"]);
		assert.deepEqual(splitList("  a  ,  b  "), ["a", "b"]);
	});

	test("splitList drops empties", () => {
		assert.deepEqual(splitList(""), []);
		assert.deepEqual(splitList(",,\n\n"), []);
	});

	test("defaults are internally consistent", () => {
		const d = DEFAULT_SETTINGS;
		assert.ok(d.cloudMinFontSize <= d.cloudMaxFontSize);
		assert.ok(d.minWeight >= 0 && d.minWeight <= 1);
		assert.ok(d.minCooccurrence >= 1);
		assert.ok(d.mapDepth >= 1);
		assert.ok(d.mapMaxNodes > 0);
		assert.ok(d.notesMaxResults > 0);
		assert.ok(d.treeMaxChildren > 0);
	});

	test("defaults favour safety and the flat-tag model", () => {
		assert.equal(DEFAULT_SETTINGS.confirmBulkEdits, true);
		assert.equal(DEFAULT_SETTINGS.editMode, false);
		assert.equal(DEFAULT_SETTINGS.caseSensitive, false);
		assert.equal(DEFAULT_SETTINGS.addTagLocation, "frontmatter");
		assert.equal(DEFAULT_SETTINGS.manualLinks.length, 0);
	});

	test("every sort and match mode has a label", () => {
		assert.equal(Object.keys(SORT_LABELS).length, 5);
		assert.deepEqual(Object.keys(MATCH_LABELS), ["all", "any"]);
		for (const label of [
			...Object.values(SORT_LABELS),
			...Object.values(MATCH_LABELS),
		]) {
			assert.ok(label.length > 0);
		}
	});
});
