import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tagSuggestions } from "../src/tagSuggest";

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
