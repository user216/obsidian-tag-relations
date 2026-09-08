import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	hintFor,
	parseTagList,
	rejectionFor,
	tagSuggestions,
} from "../src/tagSuggest";

const TAGS = ["#alpha", "#beta", "#alphabet", "#Gamma"];
const names = (list: { tag: string }[]) => list.map((s) => s.tag);

describe("tagSuggestions — matching", () => {
	test("an empty query lists everything", () => {
		assert.deepEqual(names(tagSuggestions("", TAGS)), TAGS);
	});

	test("matches on substring, not just prefix", () => {
		const result = tagSuggestions("phabet", TAGS, { allowNew: false });
		assert.deepEqual(names(result), ["#alphabet"]);
	});

	test("a partial match does not suppress the offer to create what was typed", () => {
		// "phabet" matches #alphabet, but is also a perfectly good tag name
		// that does not exist. Both are offered — the create row is labelled,
		// so choosing between them is the user's call, not ours.
		const result = tagSuggestions("phabet", TAGS);
		assert.deepEqual(names(result), ["#phabet", "#alphabet"]);
		assert.equal(result[0].isNew, true);
		assert.equal(result[1].isNew, false);
	});

	test("matching is case-insensitive in both directions", () => {
		assert.deepEqual(names(tagSuggestions("gamma", TAGS)), ["#Gamma"]);
		assert.deepEqual(names(tagSuggestions("ALPHA", TAGS)), ["#alpha", "#alphabet"]);
	});

	test("a leading hash in the query is ignored", () => {
		assert.deepEqual(names(tagSuggestions("#beta", TAGS)), ["#beta"]);
	});

	test("surrounding whitespace is ignored", () => {
		assert.deepEqual(names(tagSuggestions("  beta  ", TAGS)), ["#beta"]);
	});
});

describe("tagSuggestions — creating new tags", () => {
	test("offers to create a name that matches nothing", () => {
		const result = tagSuggestions("brandnew", TAGS);
		assert.deepEqual(result[0], { tag: "#brandnew", isNew: true });
	});

	test("the create row comes first, ahead of partial matches", () => {
		// "alpha" both matches existing tags and is itself a valid name — but
		// it already exists, so no create row. "alph" does not exist.
		const result = tagSuggestions("alph", TAGS);
		assert.equal(result[0].isNew, true);
		assert.equal(result[0].tag, "#alph");
		assert.ok(names(result).includes("#alpha"));
	});

	test("no create row when the name already exists, whatever its case", () => {
		assert.equal(tagSuggestions("alpha", TAGS).some((s) => s.isNew), false);
		assert.equal(tagSuggestions("GAMMA", TAGS).some((s) => s.isNew), false);
	});

	test("no create row for a name that is not a usable tag", () => {
		for (const bad of ["two words", "2024", "a/", "a,b"]) {
			assert.equal(
				tagSuggestions(bad, TAGS).some((s) => s.isNew),
				false,
				bad
			);
		}
	});

	test("no create row for an empty query", () => {
		assert.equal(tagSuggestions("", TAGS).some((s) => s.isNew), false);
		assert.equal(tagSuggestions("   ", TAGS).some((s) => s.isNew), false);
	});

	test("allowNew: false suppresses creation entirely", () => {
		const result = tagSuggestions("brandnew", TAGS, { allowNew: false });
		assert.deepEqual(result, []);
	});
});

describe("tagSuggestions — exclusions", () => {
	test("excluded tags are left out", () => {
		const result = tagSuggestions("", TAGS, { exclude: ["#alpha", "#beta"] });
		assert.deepEqual(names(result), ["#alphabet", "#Gamma"]);
	});

	test("exclusion is case-insensitive", () => {
		const result = tagSuggestions("", TAGS, { exclude: ["#GAMMA"] });
		assert.equal(names(result).includes("#Gamma"), false);
	});

	test("an already-chosen tag is not offered for creation either", () => {
		// Typing the full name of something already added should offer
		// nothing, rather than offering to "create" a duplicate.
		const result = tagSuggestions("alpha", TAGS, { exclude: ["#alpha"] });
		assert.equal(result.some((s) => s.isNew), false);
		assert.equal(names(result).includes("#alpha"), false);
	});

	test("excluding everything leaves an empty list", () => {
		assert.deepEqual(tagSuggestions("", TAGS, { exclude: TAGS }), []);
	});
});

describe("tagSuggestions — limit", () => {
	test("caps the number of rows", () => {
		assert.equal(tagSuggestions("", TAGS, { limit: 2 }).length, 2);
	});

	test("the create row survives the cap, being first", () => {
		const result = tagSuggestions("alph", TAGS, { limit: 1 });
		assert.equal(result.length, 1);
		assert.equal(result[0].isNew, true);
	});

	test("no limit returns everything", () => {
		assert.equal(tagSuggestions("", TAGS).length, TAGS.length);
	});
});

describe("parseTagList — when it is a list", () => {
	test("a single name is not a list, so normal typing is untouched", () => {
		assert.equal(parseTagList("alpha", TAGS).isList, false);
		assert.equal(parseTagList("  alpha  ", TAGS).isList, false);
		assert.equal(parseTagList("", TAGS).isList, false);
	});

	test("two or more names is a list", () => {
		assert.equal(parseTagList("alpha beta", TAGS).isList, true);
		assert.equal(parseTagList("alpha,beta,gamma", TAGS).isList, true);
	});

	test("commas, semicolons and spaces all separate", () => {
		for (const query of ["a b", "a,b", "a;b", "a, b", "a ;  b"]) {
			assert.deepEqual(
				names(parseTagList(query, []).valid),
				["#a", "#b"],
				query
			);
		}
	});

	test("a leading hash on each name is accepted", () => {
		assert.deepEqual(names(parseTagList("#one #two", []).valid), ["#one", "#two"]);
	});
});

describe("parseTagList — classifying the names", () => {
	test("marks which names are new and which already exist", () => {
		const parsed = parseTagList("alpha brandnew", TAGS);
		assert.deepEqual(parsed.valid, [
			{ tag: "#alpha", isNew: false },
			{ tag: "#brandnew", isNew: true },
		]);
	});

	test("several new tags can be created at once", () => {
		const parsed = parseTagList("one two three", TAGS);
		assert.deepEqual(names(parsed.valid), ["#one", "#two", "#three"]);
		assert.ok(parsed.valid.every((entry) => entry.isNew));
	});

	test("typed order is preserved", () => {
		assert.deepEqual(names(parseTagList("zebra apple mango", []).valid), [
			"#zebra",
			"#apple",
			"#mango",
		]);
	});

	test("unusable names are collected with the reason, not silently dropped", () => {
		const parsed = parseTagList("good 2024 alsogood", TAGS);
		assert.deepEqual(names(parsed.valid), ["#good", "#alsogood"]);
		assert.deepEqual(parsed.invalid.map((r) => r.name), ["2024"]);
		assert.match(parsed.invalid[0].reason, /only digits/i);
	});

	test("already-chosen names are reported as duplicates, not re-added", () => {
		const parsed = parseTagList("alpha beta", TAGS, { exclude: ["#alpha"] });
		assert.deepEqual(names(parsed.valid), ["#beta"]);
		assert.deepEqual(parsed.duplicates, ["alpha"]);
	});

	test("duplicate detection ignores case", () => {
		const parsed = parseTagList("ALPHA beta", TAGS, { exclude: ["#alpha"] });
		assert.deepEqual(parsed.duplicates, ["ALPHA"]);
	});

	test("the same name twice in one list is added once", () => {
		const parsed = parseTagList("dup dup other", []);
		assert.deepEqual(names(parsed.valid), ["#dup", "#other"]);
	});

	test("a list of only unusable names yields nothing to add", () => {
		const parsed = parseTagList("2024 2025", TAGS);
		assert.deepEqual(parsed.valid, []);
		assert.deepEqual(parsed.invalid.map((r) => r.name), ["2024", "2025"]);
	});
});


describe("explaining why a name is refused", () => {
	test("a usable name has no rejection", () => {
		assert.equal(rejectionFor("project"), null);
		assert.equal(rejectionFor("  "), null);
	});

	test("an all-digit name is refused, with Obsidian's actual reason", () => {
		// This is the reported case: typing "108" appeared to do nothing.
		const rejection = rejectionFor("108");
		assert.ok(rejection);
		assert.equal(rejection!.name, "108");
		assert.match(rejection!.reason, /only digits/i);
	});

	test("the digits hint suggests a concrete fix", () => {
		const hint = hintFor(rejectionFor("108")!);
		assert.ok(hint);
		assert.match(hint!, /at least one letter/i);
		assert.match(hint!, /108/);
	});

	test("a spaced name is refused with a usable hint", () => {
		const rejection = rejectionFor("two words");
		assert.ok(rejection);
		assert.match(hintFor(rejection!) ?? "", /hyphen or underscore/i);
	});

	test("reasons without an obvious fix simply have no hint", () => {
		const rejection = rejectionFor("a//b");
		assert.ok(rejection);
		assert.equal(hintFor(rejection!), null);
	});
});
