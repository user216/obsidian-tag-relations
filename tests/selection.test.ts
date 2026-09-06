import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	applySelection,
	filterTags,
	isSnapshotStale,
	sortTags,
} from "../src/selection";
import type { SortContext } from "../src/selection";

describe("applySelection — replace", () => {
	test("selects a single tag from nothing", () => {
		assert.deepEqual(applySelection([], "#a", "replace"), ["#a"]);
	});

	test("narrows a multi-tag selection to one", () => {
		assert.deepEqual(applySelection(["#a", "#b"], "#c", "replace"), ["#c"]);
	});

	test("clicking the only selected tag clears the selection", () => {
		assert.deepEqual(applySelection(["#a"], "#a", "replace"), []);
	});

	test("clicking one of several narrows rather than clearing", () => {
		assert.deepEqual(applySelection(["#a", "#b"], "#a", "replace"), ["#a"]);
	});
});

describe("applySelection — toggle", () => {
	test("adds a tag that is not selected", () => {
		assert.deepEqual(applySelection(["#a"], "#b", "toggle"), ["#a", "#b"]);
	});

	test("removes a tag that is selected", () => {
		assert.deepEqual(applySelection(["#a", "#b"], "#a", "toggle"), ["#b"]);
	});

	test("toggling the last tag off empties the selection", () => {
		assert.deepEqual(applySelection(["#a"], "#a", "toggle"), []);
	});

	test("preserves the order tags were picked in", () => {
		let selection: string[] = [];
		for (const tag of ["#c", "#a", "#b"]) {
			selection = applySelection(selection, tag, "toggle");
		}
		assert.deepEqual(selection, ["#c", "#a", "#b"]);
	});

	test("never mutates the array it was given", () => {
		const original = ["#a", "#b"];
		applySelection(original, "#a", "toggle");
		applySelection(original, "#c", "toggle");
		assert.deepEqual(original, ["#a", "#b"]);
	});
});

describe("filterTags", () => {
	const tags = ["#alpha", "#beta", "#gamma"];
	const none = () => false;

	test("an empty filter keeps everything", () => {
		assert.deepEqual(filterTags(tags, "", none), tags);
	});

	test("matches on substring", () => {
		assert.deepEqual(filterTags(tags, "a", none), ["#alpha", "#beta", "#gamma"]);
		assert.deepEqual(filterTags(tags, "et", none), ["#beta"]);
	});

	test("a non-matching filter yields nothing", () => {
		assert.deepEqual(filterTags(tags, "zzz", none), []);
	});

	test("selected tags survive a filter they do not match", () => {
		assert.deepEqual(
			filterTags(tags, "zzz", (tag) => tag === "#beta"),
			["#beta"]
		);
	});
});

describe("sortTags", () => {
	const counts: Record<string, number> = { "#a": 3, "#b": 1, "#c": 3 };
	const strengths: Record<string, number> = { "#a": 0.1, "#b": 0.9, "#c": 0 };
	const tags = ["#c", "#a", "#b"];

	function ctx(overrides: Partial<SortContext> = {}): SortContext {
		return {
			countOf: (tag) => counts[tag] ?? 0,
			strengthTo: (tag) => strengths[tag] ?? 0,
			isSelected: () => false,
			hasSelection: false,
			...overrides,
		};
	}

	test("name ascending and descending", () => {
		assert.deepEqual(sortTags(tags, "name-asc", ctx()), ["#a", "#b", "#c"]);
		assert.deepEqual(sortTags(tags, "name-desc", ctx()), ["#c", "#b", "#a"]);
	});

	test("count sorts break ties by name", () => {
		assert.deepEqual(sortTags(tags, "count-desc", ctx()), ["#a", "#c", "#b"]);
		assert.deepEqual(sortTags(tags, "count-asc", ctx()), ["#b", "#a", "#c"]);
	});

	test("relatedness falls back to name when nothing is selected", () => {
		assert.deepEqual(sortTags(tags, "relatedness", ctx()), ["#a", "#b", "#c"]);
	});

	test("relatedness ranks by strength when something is selected", () => {
		const sorted = sortTags(
			tags,
			"relatedness",
			ctx({ hasSelection: true })
		);
		assert.deepEqual(sorted, ["#b", "#a", "#c"]);
	});

	test("selected tags head the relatedness list regardless of strength", () => {
		const sorted = sortTags(
			tags,
			"relatedness",
			ctx({ hasSelection: true, isSelected: (tag) => tag === "#c" })
		);
		assert.deepEqual(sorted, ["#c", "#b", "#a"]);
	});

	test("does not mutate the input", () => {
		const input = ["#c", "#a"];
		sortTags(input, "name-asc", ctx());
		assert.deepEqual(input, ["#c", "#a"]);
	});
});

describe("isSnapshotStale", () => {
	const snapshot = { tags: ["#a", "#b"], mode: "all" as const };

	test("no snapshot is never stale", () => {
		assert.equal(isSnapshotStale(null, ["#a"], "all", true), false);
	});

	test("matching selection and mode is fresh", () => {
		assert.equal(isSnapshotStale(snapshot, ["#a", "#b"], "all", false), false);
	});

	test("selection order does not matter", () => {
		assert.equal(isSnapshotStale(snapshot, ["#b", "#a"], "all", false), false);
	});

	test("a changed match mode makes it stale", () => {
		assert.equal(isSnapshotStale(snapshot, ["#a", "#b"], "any", false), true);
	});

	test("adding, removing or swapping a tag makes it stale", () => {
		assert.equal(isSnapshotStale(snapshot, ["#a"], "all", false), true);
		assert.equal(isSnapshotStale(snapshot, ["#a", "#b", "#c"], "all", false), true);
		assert.equal(isSnapshotStale(snapshot, ["#a", "#c"], "all", false), true);
	});

	test("a vault rebuild makes it stale even when nothing else changed", () => {
		assert.equal(isSnapshotStale(snapshot, ["#a", "#b"], "all", true), true);
	});
});
