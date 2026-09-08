import test from "node:test";
import assert from "node:assert/strict";
import {
	PLEX_DEPTH_LABELS,
	PLEX_LAUNCHER_SIDE_LABELS,
	PlexDepth,
	PlexSource,
	buildPlex,
	startingTag,
} from "../src/plex";

/** A tiny vault: #work contains #urgent and #email; #urgent contains #bug. */
function source(overrides: Partial<PlexSource> = {}): PlexSource {
	const children: Record<string, string[]> = {
		"#life": ["#work"],
		"#work": ["#urgent", "#email"],
		"#urgent": ["#bug"],
		"#bug": ["#crash"],
	};
	const parents: Record<string, string[]> = {};
	for (const [parent, kids] of Object.entries(children)) {
		for (const kid of kids) (parents[kid] ??= []).push(parent);
	}
	return {
		parentsOf: (tag) => parents[tag] ?? [],
		childrenOf: (tag) => children[tag] ?? [],
		linkedTo: () => [],
		sharedWith: () => [],
		isVisible: () => true,
		...overrides,
	};
}

const plex = (active: string, depth: PlexDepth, overrides = {}) =>
	buildPlex({ active, source: source(overrides), depth, cap: 0 });

function rowTags(layout: ReturnType<typeof buildPlex>, id: string): string[] {
	return (
		[...layout.above, ...layout.below].find((row) => row.id === id)?.tags ?? []
	);
}

test("main-tags go above and sub-tags below", () => {
	const layout = plex("#urgent", "immediate");
	assert.deepEqual(rowTags(layout, "parents"), ["#work"]);
	assert.deepEqual(rowTags(layout, "children"), ["#bug"]);
	assert.equal(layout.active, "#urgent");
});

test("the immediate depth shows no siblings and no outer ring", () => {
	const layout = plex("#urgent", "immediate");
	assert.deepEqual(
		[...layout.above, ...layout.below].map((row) => row.id),
		["parents", "children"]
	);
});

test("siblings are the other members of the same main-tag", () => {
	const layout = plex("#urgent", "siblings");
	assert.deepEqual(rowTags(layout, "siblings"), ["#email"]);
});

test("the active tag is never its own sibling", () => {
	const layout = plex("#urgent", "siblings");
	for (const row of [...layout.above, ...layout.below]) {
		assert.ok(!row.tags.includes("#urgent"));
	}
});

test("the extended depth reaches one level further each way", () => {
	const layout = plex("#urgent", "extended");
	assert.deepEqual(rowTags(layout, "grandparents"), ["#life"]);
	assert.deepEqual(rowTags(layout, "grandchildren"), ["#crash"]);
});

test("the outer rings are dim and the immediate ring is not", () => {
	const layout = plex("#urgent", "extended");
	const dim = Object.fromEntries(
		[...layout.above, ...layout.below].map((row) => [row.id, row.dim])
	);
	assert.equal(dim.parents, false);
	assert.equal(dim.children, false);
	assert.equal(dim.grandparents, true);
	assert.equal(dim.grandchildren, true);
	assert.equal(dim.siblings, true);
});

test("the left band is shared notes and the right band is horizontal links", () => {
	// The split is by where the relation lives: the left one is a fact about
	// the vault, the right one a decision someone made.
	const layout = plex("#urgent", "immediate", {
		linkedTo: () => ["#meeting"],
		sharedWith: () => ["#today"],
	});
	assert.equal(layout.left.id, "shared");
	assert.deepEqual(layout.left.tags, ["#today"]);
	assert.equal(layout.right.id, "linked");
	assert.deepEqual(layout.right.tags, ["#meeting"]);
});

test("a tag appears in exactly one place", () => {
	// Position carries the meaning here, so a tag drawn twice would turn the
	// arrangement into overlapping lists rather than one partition.
	const layout = plex("#urgent", "extended", {
		linkedTo: () => ["#work", "#bug", "#meeting"],
		sharedWith: () => ["#work", "#meeting", "#today"],
	});
	const seen: string[] = [
		...[...layout.above, ...layout.below].flatMap((row) => row.tags),
		...layout.left.tags,
		...layout.right.tags,
	];
	assert.deepEqual(seen, Array.from(new Set(seen)));
	// Hierarchy wins over the side bands...
	assert.deepEqual(rowTags(layout, "parents"), ["#work"]);
	assert.deepEqual(rowTags(layout, "children"), ["#bug"]);
	// ...and a declared link wins over an observed one.
	assert.deepEqual(layout.right.tags, ["#meeting"]);
	assert.deepEqual(layout.left.tags, ["#today"]);
});

test("invisible tags are left out of every row and band", () => {
	const layout = plex("#urgent", "extended", {
		isVisible: (tag: string) => tag !== "#work" && tag !== "#today",
		sharedWith: () => ["#today", "#email"],
	});
	assert.deepEqual(rowTags(layout, "parents"), []);
	assert.ok(!layout.left.tags.includes("#today"));
});

test("hiding a main-tag does not dissolve the sibling relation under it", () => {
	// #work is filtered out, but #urgent and #email are still each other's
	// siblings. The row label explains the relation, so the tag they share
	// does not have to be on screen for it to hold.
	const layout = plex("#urgent", "siblings", {
		isVisible: (tag: string) => tag !== "#work",
	});
	assert.deepEqual(rowTags(layout, "parents"), []);
	assert.deepEqual(rowTags(layout, "siblings"), ["#email"]);
});

test("the cap trims rows but always reports what it trimmed", () => {
	const many = Array.from({ length: 30 }, (_, i) => `#t${i}`);
	const layout = buildPlex({
		active: "#urgent",
		source: source({ sharedWith: () => many }),
		depth: "immediate",
		cap: 5,
	});
	assert.equal(layout.left.tags.length, 5);
	assert.equal(layout.left.hidden, 25);
});

test("a cap of zero means no limit", () => {
	const many = Array.from({ length: 30 }, (_, i) => `#t${i}`);
	const layout = buildPlex({
		active: "#urgent",
		source: source({ sharedWith: () => many }),
		depth: "immediate",
		cap: 0,
	});
	assert.equal(layout.left.tags.length, 30);
	assert.equal(layout.left.hidden, 0);
});

test("a tag with nothing around it reports itself isolated", () => {
	const layout = buildPlex({
		active: "#lonely",
		source: source({ isVisible: (tag: string) => tag === "#lonely" }),
		depth: "extended",
		cap: 0,
	});
	assert.equal(layout.isolated, true);
	assert.equal(layout.active, "#lonely");
});

test("a tag with any relation at all is not isolated", () => {
	assert.equal(plex("#urgent", "immediate").isolated, false);
});

test("every depth has a label", () => {
	for (const depth of ["immediate", "siblings", "extended"] as PlexDepth[]) {
		assert.ok(PLEX_DEPTH_LABELS[depth].length > 0);
	}
});

// --- where the plex opens ----------------------------------------------

const degrees: Record<string, number> = { "#a": 1, "#b": 5, "#c": 5, "#d": 2 };
const degreeOf = (tag: string) => degrees[tag] ?? 0;

test("the selection is the active tag, most recent first", () => {
	assert.equal(
		startingTag({
			selection: ["#a", "#d"],
			pinned: ["#b"],
			visible: ["#a", "#b", "#c", "#d"],
			degreeOf,
		}),
		"#d"
	);
});

test("with nothing selected it opens on a pinned tag", () => {
	assert.equal(
		startingTag({
			selection: [],
			pinned: ["#a"],
			visible: ["#a", "#b", "#c"],
			degreeOf,
		}),
		"#a"
	);
});

test("a pin naming a tag that is not there is skipped", () => {
	assert.equal(
		startingTag({
			selection: [],
			pinned: ["#gone", "#d"],
			visible: ["#b", "#c", "#d"],
			degreeOf,
		}),
		"#d"
	);
});

test("with no pins it opens on the most connected tag", () => {
	assert.equal(
		startingTag({
			selection: [],
			pinned: [],
			visible: ["#a", "#b", "#d"],
			degreeOf,
		}),
		"#b"
	);
});

test("ties break alphabetically, so it opens on the same tag twice", () => {
	const pick = () =>
		startingTag({
			selection: [],
			pinned: [],
			visible: ["#c", "#b"],
			degreeOf,
		});
	assert.equal(pick(), "#b");
	assert.equal(pick(), pick());
});

test("an empty vault has nowhere to open", () => {
	assert.equal(
		startingTag({ selection: [], pinned: [], visible: [], degreeOf }),
		null
	);
});

// --- the note preview ---------------------------------------------------

import { previewNotes } from "../src/plex";

test("the preview heading counts every note, not just the listed ones", () => {
	// A preview reading "6 notes" for a tag carrying ninety would be worse
	// than no preview at all.
	const paths = Array.from({ length: 90 }, (_, i) => `notes/n${i}.md`);
	const preview = previewNotes("#urgent", paths, 6);
	assert.equal(preview.paths.length, 6);
	assert.equal(preview.hidden, 84);
	assert.equal(preview.heading, "90 notes tagged #urgent");
});

test("one note reads in the singular", () => {
	const preview = previewNotes("#urgent", ["a.md"], 6);
	assert.equal(preview.heading, "1 note tagged #urgent");
	assert.equal(preview.hidden, 0);
});

test("a tag no note carries says so plainly", () => {
	const preview = previewNotes("#urgent", [], 6);
	assert.equal(preview.heading, "No notes carry #urgent");
	assert.deepEqual(preview.paths, []);
	assert.equal(preview.hidden, 0);
});

test("the heading always shows the tag with its hash", () => {
	assert.match(previewNotes("urgent", ["a.md"], 6).heading, /#urgent/);
	assert.match(previewNotes("#urgent", ["a.md"], 6).heading, /#urgent/);
	assert.ok(!previewNotes("#urgent", ["a.md"], 6).heading.includes("##"));
});

test("a preview count of zero lists everything rather than nothing", () => {
	const paths = ["a.md", "b.md", "c.md"];
	const preview = previewNotes("#urgent", paths, 0);
	assert.deepEqual(preview.paths, paths);
	assert.equal(preview.hidden, 0);
});

test("both launcher sides are offered and labelled", () => {
	// A stored value outside this record is repaired on load, so the record
	// is the authority on what the setting may hold.
	assert.deepEqual(Object.keys(PLEX_LAUNCHER_SIDE_LABELS).sort(), [
		"left",
		"right",
	]);
	for (const label of Object.values(PLEX_LAUNCHER_SIDE_LABELS)) {
		assert.ok(label.length > 0);
	}
});
