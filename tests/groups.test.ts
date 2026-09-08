import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TagGroups, UNGROUPED_KEY, groupSections } from "../src/groups";
import { visibleGroupChildren } from "../src/groupsView";
import { GroupLink } from "../src/types";

/** health > fitness > running, plus health > sleep. Three levels exactly. */
function nested(): TagGroups {
	return new TagGroups([
		{ parent: "#health", child: "#fitness" },
		{ parent: "#fitness", child: "#running" },
		{ parent: "#health", child: "#sleep" },
	]);
}

describe("levels", () => {
	test("a tag with no members is simple", () => {
		assert.equal(new TagGroups().levelOf("#a"), "simple");
		assert.equal(nested().levelOf("#running"), "simple");
		assert.equal(nested().levelOf("#sleep"), "simple");
	});

	test("a tag with members and no container is a main group", () => {
		assert.equal(nested().levelOf("#health"), "main");
	});

	test("a tag with members that is itself contained is a sub-group", () => {
		assert.equal(nested().levelOf("#fitness"), "sub");
	});

	test("level is derived, so demoting is just gaining a parent", () => {
		const groups = new TagGroups([{ parent: "#a", child: "#b" }]);
		assert.equal(groups.levelOf("#a"), "main");
		groups.add("#root", "#a");
		assert.equal(groups.levelOf("#a"), "sub");
	});

	test("and promoting is just losing it", () => {
		const groups = nested();
		assert.equal(groups.levelOf("#fitness"), "sub");
		groups.remove("#health", "#fitness");
		assert.equal(groups.levelOf("#fitness"), "main");
	});

	test("main and sub group listings", () => {
		assert.deepEqual(nested().mainGroups(), ["#health"]);
		assert.deepEqual(nested().subGroups(), ["#fitness"]);
	});
});

describe("depth invariant", () => {
	test("ancestor and descendant depths", () => {
		const g = nested();
		assert.equal(g.ancestorDepth("#health"), 0);
		assert.equal(g.ancestorDepth("#fitness"), 1);
		assert.equal(g.ancestorDepth("#running"), 2);
		assert.equal(g.descendantDepth("#health"), 2);
		assert.equal(g.descendantDepth("#fitness"), 1);
		assert.equal(g.descendantDepth("#running"), 0);
	});

	test("a plain tag may join a main group", () => {
		assert.equal(nested().canAdd("#health", "#newtag").ok, true);
	});

	test("a plain tag may join a sub-group — that is the third level", () => {
		assert.equal(nested().canAdd("#fitness", "#newtag").ok, true);
	});

	test("a sub-group may not hold another group", () => {
		// #fitness is already a sub-group; #other holds tags of its own.
		const g = nested();
		g.add("#other", "#x");
		const check = g.canAdd("#fitness", "#other");
		assert.equal(check.ok, false);
		assert.match(check.reason ?? "", /sub-group cannot hold another group/i);
	});

	test("a group holding sub-groups may not be demoted", () => {
		// #health holds #fitness, which is itself a group, so #health cannot
		// move inside anything — that would make a fourth level.
		const check = nested().canAdd("#root", "#health");
		assert.equal(check.ok, false);
		assert.match(check.reason ?? "", /already holds sub-groups/i);
	});

	test("but a group holding only plain tags may be demoted", () => {
		// This is the user's rule: a main group can become a sub-group as long
		// as it does not already contain sub-groups.
		const g = new TagGroups([{ parent: "#fitness", child: "#running" }]);
		assert.equal(g.canAdd("#health", "#fitness").ok, true);
		g.add("#health", "#fitness");
		assert.equal(g.levelOf("#fitness"), "sub");
		assert.equal(g.levelOf("#running"), "simple");
	});

	test("no chain ever exceeds three levels", () => {
		const g = nested();
		// Every legal insertion keeps the deepest path at 2 links.
		g.add("#health", "#extra");
		g.add("#fitness", "#gym");
		for (const tag of ["#health", "#fitness", "#running", "#gym", "#extra"]) {
			assert.ok(g.ancestorDepth(tag) <= 2, tag);
		}
	});
});

describe("rejections", () => {
	test("a tag cannot contain itself", () => {
		const check = new TagGroups().canAdd("#a", "#a");
		assert.equal(check.ok, false);
		assert.match(check.reason ?? "", /cannot contain itself/i);
	});

	test("a duplicate link is refused", () => {
		const check = nested().canAdd("#health", "#sleep");
		assert.equal(check.ok, false);
		assert.match(check.reason ?? "", /already in that group/i);
	});

	test("a direct loop is refused", () => {
		const check = nested().canAdd("#fitness", "#health");
		assert.equal(check.ok, false);
		assert.match(check.reason ?? "", /loop/i);
	});

	test("an indirect loop is refused", () => {
		const check = nested().canAdd("#running", "#health");
		assert.equal(check.ok, false);
	});

	test("add() refuses exactly what canAdd() refuses", () => {
		const g = nested();
		const before = g.all.length;
		assert.equal(g.add("#fitness", "#health").ok, false);
		assert.equal(g.all.length, before);
	});

	test("every rejection explains itself", () => {
		const g = nested();
		for (const [p, c] of [
			["#a", "#a"],
			["#health", "#sleep"],
			["#fitness", "#health"],
			["#root", "#health"],
		]) {
			const check = g.canAdd(p, c);
			assert.equal(check.ok, false, `${p} <- ${c}`);
			assert.ok((check.reason ?? "").length > 0, `${p} <- ${c}`);
		}
	});
});

describe("a tag may belong to several groups", () => {
	test("the same tag can sit in two main groups", () => {
		const g = new TagGroups();
		assert.equal(g.add("#health", "#running").ok, true);
		assert.equal(g.add("#hobby", "#running").ok, true);
		assert.deepEqual(g.parentsOf("#running").sort(), ["#health", "#hobby"]);
		assert.equal(g.levelOf("#running"), "simple");
	});

	test("a sub-group can also belong to another main group", () => {
		// The user's rule: sub-groups "can combine with other main-group-tags
		// as any regular tag".
		const g = nested();
		assert.equal(g.add("#work", "#fitness").ok, true);
		assert.deepEqual(g.parentsOf("#fitness").sort(), ["#health", "#work"]);
		assert.equal(g.levelOf("#fitness"), "sub");
	});

	test("membership is a DAG, not a tree", () => {
		const g = new TagGroups([
			{ parent: "#a", child: "#shared" },
			{ parent: "#b", child: "#shared" },
		]);
		assert.equal(g.parentsOf("#shared").length, 2);
		assert.deepEqual(g.mainGroups(), ["#a", "#b"]);
	});
});

describe("membership queries", () => {
	test("children keep insertion order", () => {
		const g = new TagGroups([
			{ parent: "#p", child: "#z" },
			{ parent: "#p", child: "#a" },
		]);
		assert.deepEqual(g.childrenOf("#p"), ["#z", "#a"]);
	});

	test("ungrouped excludes anything with a container", () => {
		const g = nested();
		assert.deepEqual(
			g.ungrouped(["#health", "#fitness", "#running", "#loose"]),
			["#health", "#loose"]
		);
	});

	test("involved lists every tag in the structure", () => {
		assert.deepEqual(
			Array.from(nested().involved()).sort(),
			["#fitness", "#health", "#running", "#sleep"]
		);
	});

	test("isDescendantOf walks the whole subtree", () => {
		const g = nested();
		assert.equal(g.isDescendantOf("#running", "#health"), true);
		assert.equal(g.isDescendantOf("#health", "#running"), false);
		assert.equal(g.isDescendantOf("#sleep", "#fitness"), false);
	});

	test("queries on unknown tags are empty, not undefined", () => {
		const g = nested();
		assert.deepEqual(g.childrenOf("#ghost"), []);
		assert.deepEqual(g.parentsOf("#ghost"), []);
		assert.equal(g.levelOf("#ghost"), "simple");
		assert.equal(g.ancestorDepth("#ghost"), 0);
	});
});

describe("mutation", () => {
	test("remove drops one link and re-derives levels", () => {
		const g = nested();
		assert.equal(g.remove("#fitness", "#running"), true);
		assert.equal(g.levelOf("#fitness"), "simple");
		assert.equal(g.remove("#fitness", "#running"), false);
	});

	test("removeTag drops every link touching it", () => {
		const g = nested();
		assert.equal(g.removeTag("#fitness"), true);
		assert.deepEqual(g.childrenOf("#health"), ["#sleep"]);
		assert.deepEqual(g.parentsOf("#running"), []);
	});

	test("renameTag follows both ends", () => {
		const g = nested();
		assert.equal(g.renameTag("#fitness", "#exercise"), true);
		assert.deepEqual(g.childrenOf("#health").sort(), ["#exercise", "#sleep"]);
		assert.deepEqual(g.childrenOf("#exercise"), ["#running"]);
		assert.deepEqual(g.parentsOf("#running"), ["#exercise"]);
	});

	test("renaming into an existing name merges without duplicating", () => {
		const g = new TagGroups([
			{ parent: "#p", child: "#a" },
			{ parent: "#p", child: "#b" },
		]);
		g.renameTag("#a", "#b");
		assert.deepEqual(g.childrenOf("#p"), ["#b"]);
	});

	test("a rename that would make a self-link drops it", () => {
		const g = new TagGroups([{ parent: "#a", child: "#b" }]);
		g.renameTag("#b", "#a");
		assert.equal(g.all.length, 0);
	});

	test("renaming something absent changes nothing", () => {
		const g = nested();
		assert.equal(g.renameTag("#ghost", "#other"), false);
		assert.equal(g.all.length, 3);
	});

	test("all round-trips through the constructor", () => {
		const g = nested();
		const copy = new TagGroups(g.all);
		assert.deepEqual(copy.all, g.all);
		assert.equal(copy.levelOf("#fitness"), "sub");
	});
});

describe("resilience to a hand-edited data.json", () => {
	test("a cycle does not hang depth calculation", () => {
		const cyclic: GroupLink[] = [
			{ parent: "#a", child: "#b" },
			{ parent: "#b", child: "#a" },
		];
		const g = new TagGroups(cyclic);
		assert.doesNotThrow(() => g.ancestorDepth("#a"));
		assert.doesNotThrow(() => g.descendantDepth("#a"));
		assert.doesNotThrow(() => g.canAdd("#a", "#c"));
	});

	test("an over-deep chain is readable even though it cannot be created", () => {
		const g = new TagGroups([
			{ parent: "#a", child: "#b" },
			{ parent: "#b", child: "#c" },
			{ parent: "#c", child: "#d" },
		]);
		assert.equal(g.ancestorDepth("#d"), 3);
		// And no further insertion at that depth is permitted.
		assert.equal(g.canAdd("#d", "#e").ok, false);
	});

	test("an empty structure behaves", () => {
		const g = new TagGroups();
		assert.equal(g.isEmpty, true);
		assert.deepEqual(g.mainGroups(), []);
		assert.deepEqual(g.all, []);
	});
});

describe("visibleGroupChildren (level-filter flattening)", () => {
	// #health > #fitness > #running, plus #health > #sleep.
	function structure(): TagGroups {
		return new TagGroups([
			{ parent: "#health", child: "#fitness" },
			{ parent: "#fitness", child: "#running" },
			{ parent: "#health", child: "#sleep" },
		]);
	}

	test("all levels visible: sub-tags and plain tags split normally", () => {
		const result = visibleGroupChildren(
			structure(),
			"#health",
			new Set(["main", "sub", "simple"])
		);
		assert.deepEqual(result.subGroups, ["#fitness"]);
		assert.deepEqual(result.plain, ["#sleep"]);
	});

	test("sub-tags hidden: a sub-tag's own members surface in the parent instead of vanishing", () => {
		// This is the bug: without flattening, #running would disappear
		// entirely when the "tags + main-tags" filter hides #fitness.
		const result = visibleGroupChildren(
			structure(),
			"#health",
			new Set(["main", "simple"])
		);
		assert.deepEqual(result.subGroups, []);
		assert.deepEqual(result.plain.sort(), ["#running", "#sleep"]);
	});

	test("plain tags also hidden: nothing is flattened in for nothing to show", () => {
		const result = visibleGroupChildren(
			structure(),
			"#health",
			new Set(["main"])
		);
		assert.deepEqual(result.subGroups, []);
		assert.deepEqual(result.plain, []);
	});

	test("a flattened tag is not duplicated if it is also a direct member", () => {
		const g = new TagGroups([
			{ parent: "#health", child: "#fitness" },
			{ parent: "#fitness", child: "#running" },
			{ parent: "#health", child: "#running" }, // also directly under #health
		]);
		const result = visibleGroupChildren(
			g,
			"#health",
			new Set(["main", "simple"])
		);
		assert.deepEqual(result.plain, ["#running"]);
	});

	test("a group with no sub-tags is unaffected by the sub-tag filter", () => {
		const g = new TagGroups([{ parent: "#health", child: "#sleep" }]);
		const withSub = visibleGroupChildren(g, "#health", new Set(["main", "sub", "simple"]));
		const withoutSub = visibleGroupChildren(g, "#health", new Set(["main", "simple"]));
		assert.deepEqual(withSub, withoutSub);
	});

	test("an empty group returns two empty lists", () => {
		const result = visibleGroupChildren(
			new TagGroups(),
			"#nothing",
			new Set(["main", "sub", "simple"])
		);
		assert.deepEqual(result, { subGroups: [], plain: [] });
	});
});

// --- groupSections ------------------------------------------------------

test("groupSections lists each group with the members that are visible", () => {
	const groups = new TagGroups([
		{ parent: "#work", child: "#urgent" },
		{ parent: "#work", child: "#email" },
		{ parent: "#home", child: "#garden" },
	]);
	const sections = groupSections(groups, [
		"#work",
		"#home",
		"#urgent",
		"#email",
		"#garden",
	]);
	assert.deepEqual(
		sections.map((section) => section.group),
		["#home", "#work"]
	);
	assert.deepEqual(sections[1].members, ["#urgent", "#email"]);
});

test("groupSections drops members that are filtered out", () => {
	const groups = new TagGroups([
		{ parent: "#work", child: "#urgent" },
		{ parent: "#work", child: "#email" },
	]);
	const sections = groupSections(groups, ["#work", "#email"]);
	assert.equal(sections.length, 1);
	assert.deepEqual(sections[0].members, ["#email"]);
});

test("a group whose members are all filtered out keeps its heading", () => {
	// Otherwise the main-tag itself falls through to "Ungrouped", which is
	// the one thing it definitely is not.
	const groups = new TagGroups([{ parent: "#work", child: "#urgent" }]);
	const sections = groupSections(groups, ["#work"]);
	assert.deepEqual(sections, [{ group: "#work", members: [] }]);
});

test("a group with nothing visible at all gets no section", () => {
	const groups = new TagGroups([{ parent: "#work", child: "#urgent" }]);
	assert.deepEqual(groupSections(groups, ["#other"]), []);
});

test("sub-group sections come after the main groups holding them", () => {
	const groups = new TagGroups([
		{ parent: "#work", child: "#projects" },
		{ parent: "#projects", child: "#alpha" },
	]);
	const sections = groupSections(groups, ["#work", "#projects", "#alpha"]);
	assert.deepEqual(
		sections.map((section) => section.group),
		["#work", "#projects"]
	);
	// The sub-group appears as a member above and as a heading below, which
	// is how the nesting stays readable in a flat list of sections.
	assert.deepEqual(sections[0].members, ["#projects"]);
	assert.deepEqual(sections[1].members, ["#alpha"]);
});

test("a tag in two groups appears under both", () => {
	// The thing nested tags cannot express, so it must not be collapsed to one.
	const groups = new TagGroups([
		{ parent: "#work", child: "#urgent" },
		{ parent: "#home", child: "#urgent" },
	]);
	const sections = groupSections(groups, ["#work", "#home", "#urgent"]);
	assert.equal(sections.length, 2);
	for (const section of sections) {
		assert.deepEqual(section.members, ["#urgent"]);
	}
});

test("every visible tag is covered by a section or by the ungrouped list", () => {
	const groups = new TagGroups([
		{ parent: "#work", child: "#urgent" },
		{ parent: "#work", child: "#projects" },
		{ parent: "#projects", child: "#alpha" },
	]);
	const visible = ["#work", "#projects", "#urgent", "#alpha", "#loose", "#solo"];
	const sections = groupSections(groups, visible);
	const covered = new Set<string>();
	for (const section of sections) {
		covered.add(section.group);
		for (const member of section.members) covered.add(member);
	}
	for (const tag of groups.ungrouped(visible)) {
		if (!groups.isGroup(tag)) covered.add(tag);
	}
	assert.deepEqual(
		visible.filter((tag) => !covered.has(tag)),
		[]
	);
});

test("the Ungrouped key cannot collide with a tag name", () => {
	// It is stored in the same list as real tags, so it has to be something
	// no tag can be. Tag names always carry their leading "#".
	assert.ok(!UNGROUPED_KEY.startsWith("#"));
	assert.ok(UNGROUPED_KEY.length > 0);
});
