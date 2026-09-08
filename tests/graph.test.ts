import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TagGraph, normalizeTag, tagLabel, edgeKey } from "../src/graph";
import type { GraphBuildOptions } from "../src/graph";

/** A vault is just a map of note path to the tags on it. */
function appWith(vault: Record<string, string[]>): any {
	return {
		vault: {
			getMarkdownFiles: () => Object.keys(vault).map((path) => ({ path })),
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => ({
				tags: (vault[file.path] ?? []).map((tag) => ({ tag })),
			}),
		},
	};
}

function opts(overrides: Partial<GraphBuildOptions> = {}): GraphBuildOptions {
	return {
		metric: "jaccard",
		minCooccurrence: 1,
		minWeight: 0,
		caseSensitive: false,
		linkNestedTags: true,
		excludedTags: [],
		excludedFolders: [],
		manualLinks: [],
		groupLinks: [],
		showGroupConnections: true,
		...overrides,
	};
}

const VAULT = {
	"notes/note1.md": ["#project", "#work", "#urgent"],
	"notes/note2.md": ["#Project", "#work"],
	"notes/note3.md": ["#work", "#home"],
	"notes/note4.md": ["#home", "#garden"],
	"notes/note5.md": ["#project", "#idea"],
	"Templates/tpl.md": ["#project", "#template"],
};

function built(overrides: Partial<GraphBuildOptions> = {}): TagGraph {
	const graph = new TagGraph();
	graph.build(
		appWith(VAULT),
		opts({ excludedFolders: ["Templates"], ...overrides })
	);
	return graph;
}

const paths = (matches: { path: string }[]) => matches.map((m) => m.path);

describe("tag helpers", () => {
	test("normalizeTag adds the hash and folds case by default", () => {
		assert.equal(normalizeTag("work", false), "#work");
		assert.equal(normalizeTag("#Work", false), "#work");
		assert.equal(normalizeTag("#Work", true), "#Work");
	});

	test("normalizeTag strips internal whitespace", () => {
		assert.equal(normalizeTag("  #a b ", false), "#ab");
	});

	test("tagLabel drops the leading hash", () => {
		assert.equal(tagLabel("#work"), "work");
		assert.equal(tagLabel("work"), "work");
	});

	test("edgeKey is order independent", () => {
		assert.equal(edgeKey("#a", "#b"), edgeKey("#b", "#a"));
		assert.notEqual(edgeKey("#a", "#b"), edgeKey("#a", "#c"));
	});
});

describe("building the graph", () => {
	test("counts notes per tag, folding case", () => {
		const g = built();
		assert.equal(g.countOf("#project"), 3); // #Project folded in, Templates excluded
		assert.equal(g.countOf("#work"), 3);
		assert.equal(g.nodes.size, 6);
	});

	test("excluded folders keep their tags out entirely", () => {
		assert.equal(built().nodes.has("#template"), false);
	});

	test("excluding a tag also excludes its nested children", () => {
		// Legacy nested support only; see ADR 0007.
		const nested = {
			"a.md": ["#area/health", "#area", "#log"],
			"b.md": ["#area/health", "#log"],
		};
		const g = new TagGraph();
		g.build(appWith(nested), opts({ excludedTags: ["#area"] }));
		assert.equal(g.nodes.has("#area"), false);
		assert.equal(g.nodes.has("#area/health"), false);
		assert.equal(g.countOf("#log"), 2);
	});

	test("case-sensitive mode keeps differently-cased tags apart", () => {
		const g = built({ caseSensitive: true });
		assert.equal(g.countOf("#Project"), 1);
		assert.equal(g.countOf("#project"), 2);
	});

	test("an empty vault produces an empty graph", () => {
		const g = new TagGraph();
		g.build(appWith({}), opts());
		assert.equal(g.isEmpty, true);
		assert.deepEqual(g.tagList, []);
		assert.equal(g.maxCount, 0);
	});
});

describe("co-occurrence", () => {
	test("counts notes carrying both tags", () => {
		const g = built();
		assert.equal(g.edgeBetween("#project", "#work")?.cooccur, 2);
		assert.equal(g.edgeBetween("#work", "#home")?.cooccur, 1);
	});

	test("tags that never share a note are unrelated", () => {
		assert.equal(built().isRelated("#project", "#home"), false);
	});

	test("a tag is never related to itself", () => {
		assert.equal(built().isRelated("#work", "#work"), false);
	});
});

describe("strength metrics", () => {
	test("jaccard is shared over combined", () => {
		const g = built();
		assert.equal(g.strength("#project", "#work"), 0.5); // 2/(3+3-2)
		assert.equal(g.strength("#work", "#home"), 0.25); // 1/(3+2-1)
	});

	test("cosine balances by size", () => {
		const g = built({ metric: "cosine" });
		assert.equal(Number(g.strength("#project", "#work").toFixed(4)), 0.6667);
	});

	test("raw co-occurrence normalises against the vault maximum", () => {
		const g = built({ metric: "cooccurrence" });
		assert.equal(g.strength("#project", "#work"), 1);
		assert.equal(g.strength("#work", "#home"), 0.5);
	});

	test("unrelated tags score zero under every metric", () => {
		for (const metric of ["jaccard", "cosine", "cooccurrence"] as const) {
			assert.equal(built({ metric }).strength("#project", "#garden"), 0);
		}
	});
});

describe("neighbours and traversal", () => {
	test("neighbours come back strongest first", () => {
		// jaccard: project 2/4=0.5, urgent 1/3=0.33, home 1/4=0.25
		const g = built();
		assert.deepEqual(g.relatedTags("#work"), ["#project", "#urgent", "#home"]);
		assert.deepEqual(
			g.neighbors("#work").map((e) => Number(e.weight.toFixed(3))),
			[0.5, 0.333, 0.25]
		);
	});

	test("neighbourhood maps each tag to the hop it was first reached at", () => {
		const g = built();
		const reach = g.neighborhood(["#project"], 1);
		assert.equal(reach.get("#project"), 0);
		assert.deepEqual(
			Array.from(reach.keys()).sort(),
			["#idea", "#project", "#urgent", "#work"]
		);
		assert.equal(g.neighborhood(["#project"], 2).get("#home"), 2);
		assert.equal(g.neighborhood(["#project"], 3).get("#garden"), 3);
	});

	test("neighbourhood accepts several roots at once", () => {
		const reach = built().neighborhood(["#project", "#garden"], 1);
		assert.equal(reach.get("#project"), 0);
		assert.equal(reach.get("#garden"), 0);
		assert.equal(reach.get("#home"), 1); // via #garden
	});

	test("neighbourhood ignores unknown roots and zero depth", () => {
		const g = built();
		assert.equal(g.neighborhood(["#nope"], 3).size, 0);
		assert.equal(g.neighborhood(["#project"], 0).size, 1);
	});
});

describe("pruning", () => {
	test("minimum shared notes drops weak relations", () => {
		const g = built({ minCooccurrence: 2 });
		assert.equal(g.edges.size, 1);
		assert.ok(g.edgeBetween("#project", "#work"));
	});

	test("minimum strength drops relations below the threshold", () => {
		const g = built({ minWeight: 0.3 });
		assert.equal(g.isRelated("#work", "#home"), false); // 0.25
		assert.equal(g.isRelated("#project", "#work"), true); // 0.5
	});
});

describe("manual links", () => {
	test("survive pruning and score full strength", () => {
		const g = built({
			minCooccurrence: 2,
			manualLinks: [{ a: "#garden", b: "#idea" }],
		});
		assert.equal(g.strength("#garden", "#idea"), 1);
		assert.equal(g.edgeBetween("#garden", "#idea")?.manual, true);
	});

	test("can name a tag that no note carries", () => {
		const g = built({
			manualLinks: [{ a: "concept", b: "#project", label: "is a kind of" }],
		});
		assert.equal(g.nodes.has("#concept"), true);
		assert.equal(g.countOf("#concept"), 0);
		assert.equal(g.edgeBetween("#concept", "#project")?.label, "is a kind of");
	});

	test("upgrade an existing co-occurrence edge rather than duplicating it", () => {
		const before = built().edges.size;
		const g = built({ manualLinks: [{ a: "#project", b: "#work" }] });
		assert.equal(g.edges.size, before);
		assert.equal(g.edgeBetween("#project", "#work")?.manual, true);
		assert.equal(g.strength("#project", "#work"), 1);
	});

	test("a self-link is ignored", () => {
		const g = built({ manualLinks: [{ a: "#work", b: "#work" }] });
		assert.equal(g.isRelated("#work", "#work"), false);
	});
});

describe("nested tag bridge (legacy, see ADR 0007)", () => {
	const nested = {
		"a.md": ["#area/health", "#area", "#log"],
		"b.md": ["#area/health", "#log"],
	};

	test("relates a nested tag to its parent when enabled", () => {
		const g = new TagGraph();
		g.build(appWith(nested), opts({ linkNestedTags: true }));
		assert.equal(g.isRelated("#area/health", "#area"), true);
	});

	test("no parent edge when disabled and co-occurrence is pruned away", () => {
		const g = new TagGraph();
		g.build(
			appWith(nested),
			opts({ linkNestedTags: false, minCooccurrence: 5 })
		);
		assert.equal(g.isRelated("#area/health", "#area"), false);
	});
});

describe("selection helpers", () => {
	test("maxStrengthTo takes the strongest tie, not a sum", () => {
		const g = built();
		assert.equal(
			Number(g.maxStrengthTo("#urgent", ["#home", "#work"]).toFixed(3)),
			0.333
		);
		assert.equal(g.maxStrengthTo("#garden", ["#project"]), 0);
	});

	test("a tag's own membership in the selection is skipped", () => {
		assert.equal(built().maxStrengthTo("#work", ["#work"]), 0);
	});

	test("isRelatedToAny is a union across the selection", () => {
		const g = built();
		assert.equal(g.isRelatedToAny("#garden", ["#project", "#home"]), true);
		assert.equal(g.isRelatedToAny("#garden", ["#project", "#urgent"]), false);
	});

	test("relatedToSelection excludes the selection and sorts by strength", () => {
		// #idea and #urgent both tie at 1/3; #home is 1/4. Ties break by name.
		assert.deepEqual(built().relatedToSelection(["#project", "#work"]), [
			"#idea",
			"#urgent",
			"#home",
		]);
	});

	test("relatedToSelection of nothing is empty", () => {
		assert.deepEqual(built().relatedToSelection([]), []);
	});
});

describe("matching notes to a tag selection", () => {
	test("all: only notes carrying every tag", () => {
		const g = built();
		assert.deepEqual(paths(g.matchNotes(["#project", "#work"], "all")), [
			"notes/note1.md",
			"notes/note2.md",
		]);
		assert.deepEqual(paths(g.matchNotes(["#project", "#home"], "all")), []);
		assert.deepEqual(
			paths(g.matchNotes(["#project", "#work", "#urgent"], "all")),
			["notes/note1.md"]
		);
	});

	test("any: notes carrying at least one tag", () => {
		assert.deepEqual(paths(built().matchNotes(["#project", "#work"], "any")), [
			"notes/note1.md",
			"notes/note2.md",
			"notes/note3.md",
			"notes/note5.md",
		]);
	});

	test("a single tag behaves the same in both modes", () => {
		const g = built();
		const all = paths(g.matchNotes(["#home"], "all"));
		assert.deepEqual(all, ["notes/note3.md", "notes/note4.md"]);
		assert.deepEqual(paths(g.matchNotes(["#home"], "any")), all);
	});

	test("match counts rank results under any", () => {
		const matches = built().matchNotes(
			["#project", "#work", "#urgent"],
			"any"
		);
		assert.deepEqual(
			matches.map((m) => m.matched),
			[3, 2, 1, 1]
		);
		assert.equal(matches[0].path, "notes/note1.md");
	});

	test("under all, every result carries every tag", () => {
		assert.ok(
			built()
				.matchNotes(["#project", "#work"], "all")
				.every((m) => m.matched === 2)
		);
	});

	test("an empty selection matches nothing", () => {
		assert.deepEqual(built().matchNotes([], "all"), []);
		assert.deepEqual(built().matchNotes([], "any"), []);
	});

	test("a tag with no notes empties an all match but not an any match", () => {
		const g = built({ manualLinks: [{ a: "#concept", b: "#project" }] });
		assert.equal(g.countOf("#concept"), 0);
		assert.deepEqual(paths(g.matchNotes(["#concept", "#project"], "all")), []);
		assert.deepEqual(paths(g.matchNotes(["#concept", "#project"], "any")), [
			"notes/note1.md",
			"notes/note2.md",
			"notes/note5.md",
		]);
	});

	test("a tag absent from the graph behaves the same way", () => {
		const g = built();
		assert.deepEqual(paths(g.matchNotes(["#nope", "#project"], "all")), []);
		assert.deepEqual(paths(g.matchNotes(["#nope", "#project"], "any")), [
			"notes/note1.md",
			"notes/note2.md",
			"notes/note5.md",
		]);
	});
});

describe("group membership as edges", () => {
	const groupOpts = {
		groupLinks: [
			{ parent: "#health", child: "#fitness" },
			{ parent: "#fitness", child: "#running" },
		],
	};

	test("containment creates edges at full strength", () => {
		const g = built(groupOpts);
		assert.equal(g.isRelated("#health", "#fitness"), true);
		assert.equal(g.strength("#health", "#fitness"), 1);
	});

	test("the edge records which tag is the container", () => {
		const g = built(groupOpts);
		assert.equal(g.edgeBetween("#health", "#fitness")?.parent, "#health");
	});

	test("edge kind reflects the levels it joins", () => {
		const g = built(groupOpts);
		// #fitness is a sub-group, so health -> fitness is main-sub
		assert.equal(g.edgeBetween("#health", "#fitness")?.kind, "main-sub");
		// #running is plain, under a sub-group
		assert.equal(g.edgeBetween("#fitness", "#running")?.kind, "sub-simple");
	});

	test("a plain tag directly under a main group is main-simple", () => {
		const g = built({ groupLinks: [{ parent: "#health", child: "#sleep" }] });
		assert.equal(g.edgeBetween("#health", "#sleep")?.kind, "main-simple");
	});

	test("group members exist as nodes even with no notes", () => {
		const g = built({ groupLinks: [{ parent: "#empty", child: "#alsoempty" }] });
		assert.equal(g.nodes.has("#empty"), true);
		assert.equal(g.countOf("#alsoempty"), 0);
	});

	test("group edges survive pruning that would drop a weak relation", () => {
		const g = built({ ...groupOpts, minCooccurrence: 9, minWeight: 0.9 });
		assert.equal(g.isRelated("#health", "#fitness"), true);
	});

	test("containment outranks a co-occurrence between the same tags", () => {
		// #project and #work share notes; declaring containment relabels it.
		const g = built({ groupLinks: [{ parent: "#project", child: "#work" }] });
		const edge = g.edgeBetween("#project", "#work");
		assert.equal(edge?.parent, "#project");
		assert.equal(edge?.kind, "main-simple");
		assert.equal(edge?.weight, 1);
	});

	test("showGroupConnections off keeps the nodes but draws no edges", () => {
		const g = built({ ...groupOpts, showGroupConnections: false });
		assert.equal(g.nodes.has("#fitness"), true);
		assert.equal(g.isRelated("#health", "#fitness"), false);
	});

	test("the graph exposes the group structure it was built with", () => {
		const g = built(groupOpts);
		assert.equal(g.groups.levelOf("#health"), "main");
		assert.equal(g.groups.levelOf("#fitness"), "sub");
		assert.equal(g.groups.levelOf("#running"), "simple");
	});
});

describe("a pair that is both grouped and horizontally linked", () => {
	// Both are stored: "B contains A" and "A relates to B" are different
	// claims, and removing one should not silently destroy the other.
	const both = {
		manualLinks: [{ a: "#project", b: "#work" }],
		groupLinks: [{ parent: "#project", child: "#work" }],
	};

	test("they collapse onto one edge, not two", () => {
		const g = built(both);
		assert.equal(g.edges.size, built().edges.size);
	});

	test("containment wins the edge's kind, so views draw the structure", () => {
		const edge = built(both).edgeBetween("#project", "#work");
		assert.equal(edge?.parent, "#project");
		assert.equal(edge?.kind, "main-simple");
	});

	test("but the horizontal link is not erased — the flag survives", () => {
		// This is what lets it reappear if the grouping is removed later.
		assert.equal(built(both).edgeBetween("#project", "#work")?.manual, true);
	});

	test("either alone is enough to force full strength", () => {
		assert.equal(built(both).strength("#project", "#work"), 1);
		assert.equal(
			built({ manualLinks: both.manualLinks }).strength("#project", "#work"),
			1
		);
		assert.equal(
			built({ groupLinks: both.groupLinks }).strength("#project", "#work"),
			1
		);
	});

	test("removing only the grouping brings the link back into view", () => {
		const linkOnly = built({ manualLinks: both.manualLinks });
		const edge = linkOnly.edgeBetween("#project", "#work");
		assert.equal(edge?.parent, undefined);
		assert.equal(edge?.kind, "manual");
	});
});
