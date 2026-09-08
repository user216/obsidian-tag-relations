import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	countRemovable,
	describeRemovable,
	removableRelations,
	withoutAllRelations,
	withoutMembership,
	withoutRelation,
} from "../src/relations";
import type { RelationStore } from "../src/relations";
import {
	ACTION_GROUP_ORDER,
	TAG_ACTIONS,
	actionById,
	actionsInGroup,
	iconFor,
} from "../src/actions";

/**
 * #a is horizontally linked to #b, contains #c, and sits inside #d.
 * #a is also both linked to and containing #e — the both-at-once case.
 */
function store(): RelationStore {
	return {
		manualLinks: [
			{ a: "#a", b: "#b" },
			{ a: "#e", b: "#a" },
			{ a: "#x", b: "#y" }, // unrelated to #a
		],
		groupLinks: [
			{ parent: "#a", child: "#c" },
			{ parent: "#d", child: "#a" },
			{ parent: "#a", child: "#e" },
			{ parent: "#x", child: "#y" }, // unrelated to #a
		],
	};
}

describe("removableRelations", () => {
	test("finds horizontal links in either stored direction", () => {
		const found = removableRelations("#a", store());
		assert.deepEqual(
			found.find((r) => r.other === "#b")?.kinds,
			["link"]
		);
	});

	test("distinguishes containing from being inside", () => {
		const found = removableRelations("#a", store());
		assert.deepEqual(found.find((r) => r.other === "#c")?.kinds, ["contains"]);
		assert.deepEqual(found.find((r) => r.other === "#d")?.kinds, ["inside"]);
	});

	test("reports both kinds when a pair is linked and grouped", () => {
		const kinds = removableRelations("#a", store()).find(
			(r) => r.other === "#e"
		)?.kinds;
		assert.deepEqual(kinds?.slice().sort(), ["contains", "link"]);
	});

	test("ignores relations between other tags entirely", () => {
		const others = removableRelations("#a", store()).map((r) => r.other);
		assert.equal(others.includes("#x"), false);
		assert.equal(others.includes("#y"), false);
	});

	test("results are sorted by the other tag's name", () => {
		const others = removableRelations("#a", store()).map((r) => r.other);
		assert.deepEqual(others, others.slice().sort());
	});

	test("a tag with nothing removable returns an empty list", () => {
		assert.deepEqual(removableRelations("#lonely", store()), []);
		assert.deepEqual(
			removableRelations("#a", { manualLinks: [], groupLinks: [] }),
			[]
		);
	});

	test("countRemovable counts every tie, not every tag", () => {
		// #b link, #c contains, #d inside, #e link + contains = 5
		assert.equal(countRemovable("#a", store()), 5);
		assert.equal(countRemovable("#lonely", store()), 0);
	});

	test("describeRemovable names each kind", () => {
		assert.equal(describeRemovable({ other: "#b", kinds: ["link"] }), "horizontal link");
		assert.equal(
			describeRemovable({ other: "#e", kinds: ["link", "contains"] }),
			"horizontal link + contains it"
		);
	});
});

describe("withoutRelation", () => {
	test("removes a horizontal link", () => {
		const next = withoutRelation("#a", "#b", store());
		assert.equal(
			next.manualLinks.some((l) => l.a === "#b" || l.b === "#b"),
			false
		);
	});

	test("removes containment in either direction", () => {
		assert.equal(
			withoutRelation("#a", "#c", store()).groupLinks.some(
				(l) => l.child === "#c"
			),
			false
		);
		assert.equal(
			withoutRelation("#a", "#d", store()).groupLinks.some(
				(l) => l.parent === "#d"
			),
			false
		);
	});

	test("removes BOTH ties when a pair is linked and grouped", () => {
		// Half-removing would leave the two tags still joined, which is not
		// what "remove this relation" can reasonably mean.
		const next = withoutRelation("#a", "#e", store());
		assert.equal(countRemovable("#a", next), 3);
		assert.equal(
			removableRelations("#a", next).some((r) => r.other === "#e"),
			false
		);
	});

	test("leaves every other relation untouched", () => {
		const next = withoutRelation("#a", "#b", store());
		assert.equal(next.groupLinks.length, store().groupLinks.length);
		assert.ok(next.manualLinks.some((l) => l.a === "#x"));
	});

	test("removing a relation that does not exist changes nothing", () => {
		const before = store();
		const next = withoutRelation("#a", "#nope", before);
		assert.deepEqual(next.manualLinks, before.manualLinks);
		assert.deepEqual(next.groupLinks, before.groupLinks);
	});

	test("does not mutate the store it was given", () => {
		const before = store();
		withoutRelation("#a", "#b", before);
		assert.equal(before.manualLinks.length, 3);
	});
});

describe("withoutAllRelations", () => {
	test("clears every removable tie of the tag, in both roles", () => {
		const next = withoutAllRelations("#a", store());
		assert.equal(countRemovable("#a", next), 0);
	});

	test("spares relations that do not involve the tag", () => {
		const next = withoutAllRelations("#a", store());
		assert.deepEqual(next.manualLinks, [{ a: "#x", b: "#y" }]);
		assert.deepEqual(next.groupLinks, [{ parent: "#x", child: "#y" }]);
	});

	test("the other tags keep their own remaining relations", () => {
		// #d only related #a; #x/#y are untouched, so #x still has one.
		const next = withoutAllRelations("#a", store());
		assert.equal(countRemovable("#d", next), 0);
		assert.equal(countRemovable("#x", next), 2);
	});

	test("clearing a tag with nothing to clear is a no-op", () => {
		const before = store();
		const next = withoutAllRelations("#lonely", before);
		assert.deepEqual(next.manualLinks, before.manualLinks);
		assert.deepEqual(next.groupLinks, before.groupLinks);
	});
});

describe("withoutMembership", () => {
	test("removes only that one parent, leaving other parents alone", () => {
		const multi: RelationStore = {
			manualLinks: [],
			groupLinks: [
				{ parent: "#p1", child: "#kid" },
				{ parent: "#p2", child: "#kid" },
			],
		};
		const next = withoutMembership("#kid", "#p1", multi);
		assert.deepEqual(next.groupLinks, [{ parent: "#p2", child: "#kid" }]);
	});

	test("is directional — it never removes the reverse containment", () => {
		const next = withoutMembership("#a", "#c", store());
		// #a contains #c, not the other way round, so nothing matches.
		assert.equal(next.groupLinks.length, store().groupLinks.length);
	});

	test("never touches horizontal links", () => {
		const next = withoutMembership("#a", "#d", store());
		assert.deepEqual(next.manualLinks, store().manualLinks);
	});
});

describe("the action registry", () => {
	test("every action has a unique id", () => {
		const ids = TAG_ACTIONS.map((a) => a.id);
		assert.equal(new Set(ids).size, ids.length);
	});

	test("every action has a non-empty default icon and label", () => {
		const ctx = { tag: "#tag", host: fakeHost() };
		for (const action of TAG_ACTIONS) {
			assert.ok(action.defaultIcon.length > 0, action.id);
			assert.ok(action.label(ctx).length > 0, action.id);
		}
	});

	test("actions needing a tag are disabled when there is none", () => {
		const ctx = { tag: null, host: fakeHost() };
		const needsTag = TAG_ACTIONS.filter((a) => !a.isEnabled(ctx));
		assert.ok(needsTag.length > 0);
		// The only actions that work without a tag are the ones about the
		// whole structure rather than one tag in it. clear-selection and
		// show-notes are additionally gated on there being a selection, so
		// with an empty one they stay disabled here.
		const tagless = TAG_ACTIONS.filter((a) => a.isEnabled(ctx)).map((a) => a.id);
		assert.deepEqual(tagless.sort(), [
			"export-relations",
			"import-relations",
			"new-note",
		]);
	});

	test("export and import never depend on a tag or a selection", () => {
		for (const id of ["export-relations", "import-relations"]) {
			const action = actionById(id)!;
			assert.equal(action.isEnabled({ tag: null, host: fakeHost() }), true, id);
			assert.equal(action.destructive, undefined, id);
		}
	});

	test("destructive actions are flagged as such", () => {
		const destructive = TAG_ACTIONS.filter((a) => a.destructive).map((a) => a.id);
		assert.deepEqual(destructive.sort(), [
			"remove-all-relations",
			"remove-relation",
			"remove-tag-from-notes",
		]);
	});

	test("actionById finds a known action and misses an unknown one", () => {
		assert.equal(actionById("rename")?.group, "edit");
		assert.equal(actionById("nope"), undefined);
	});

	test("every action belongs to exactly one listed group", () => {
		// Reads the canonical order rather than a copy of it, so adding a
		// group cannot leave this test silently checking the old set.
		const grouped = ACTION_GROUP_ORDER.flatMap((g) => actionsInGroup(g)).map(
			(a) => a.id
		);
		assert.equal(grouped.length, TAG_ACTIONS.length);
		assert.equal(new Set(grouped).size, TAG_ACTIONS.length);
	});

	test("iconFor prefers a user override and falls back to the default", () => {
		const rename = actionById("rename")!;
		assert.equal(iconFor(rename, {}), rename.defaultIcon);
		assert.equal(iconFor(rename, { rename: "star" }), "star");
	});

	test("a blank or whitespace override falls back rather than blanking the button", () => {
		const rename = actionById("rename")!;
		assert.equal(iconFor(rename, { rename: "" }), rename.defaultIcon);
		assert.equal(iconFor(rename, { rename: "   " }), rename.defaultIcon);
	});
});

/** Minimal host: actions under test only read state, never run here. */
function fakeHost(): any {
	const noop = () => undefined;
	return {
		graph: { countOf: () => 0, neighbors: () => [] },
		groups: { parentsOf: () => [] },
		selection: [],
		isSelected: () => false,
		isPinned: () => false,
		isBookmarked: () => false,
		removableRelationCount: () => 0,
		select: noop,
		clearSelection: noop,
		togglePin: noop,
		toggleBookmark: noop,
		promptBookmarkInside: noop,
		openTagSearch: noop,
		showNotes: noop,
		createNote: noop,
		promptAddToGroup: noop,
		promptPutInsideGroup: noop,
		promptTakeOutOfGroup: noop,
		promptHorizontalLink: noop,
		promptRemoveRelation: noop,
		promptRemoveAllRelations: noop,
		promptRename: noop,
		exportRelations: noop,
		importRelations: noop,
		promptAssignTagToNotesOf: noop,
		promptRemoveTagFromNotes: noop,
		copyTag: noop,
	};
}
