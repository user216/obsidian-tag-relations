import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	rewriteBody,
	rewriteFrontmatter,
	validateTagName,
} from "../src/edit";

/** Build TagCache-shaped hits by locating each tag literally in the text. */
function hitsFor(content: string, tags: string[]): any[] {
	const hits: any[] = [];
	for (const tag of tags) {
		let from = 0;
		for (;;) {
			const index = content.indexOf(tag, from);
			if (index < 0) break;
			hits.push({
				tag,
				position: {
					start: { offset: index, line: 0, col: 0 },
					end: { offset: index + tag.length, line: 0, col: 0 },
				},
			});
			from = index + tag.length;
		}
	}
	return hits;
}

const rename = (from: string, to: string) => (tag: string) =>
	tag === from ? to : null;
const remove = (target: string) => (tag: string) => (tag === target ? "" : null);

describe("rewriteBody", () => {
	test("replaces every occurrence", () => {
		const content = "Intro #alpha middle #alpha end";
		const r = rewriteBody(content, hitsFor(content, ["#alpha"]), rename("#alpha", "#beta"));
		assert.equal(r.content, "Intro #beta middle #beta end");
		assert.equal(r.changed, 2);
	});

	test("a longer replacement does not corrupt earlier offsets", () => {
		// This is what the back-to-front pass exists for.
		const content = "#a one #a two #a";
		const r = rewriteBody(content, hitsFor(content, ["#a"]), rename("#a", "#much-longer"));
		assert.equal(r.content, "#much-longer one #much-longer two #much-longer");
		assert.equal(r.changed, 3);
	});

	test("leaves non-matching tags alone", () => {
		const content = "#keep and #alpha and #keep2";
		const hits = hitsFor(content, ["#keep", "#alpha", "#keep2"]);
		const r = rewriteBody(content, hits, rename("#alpha", "#beta"));
		assert.equal(r.content, "#keep and #beta and #keep2");
		assert.equal(r.changed, 1);
	});

	test("a stale cache entry is skipped, not applied blindly", () => {
		const content = "Some text without that tag at all";
		const stale = [
			{ tag: "#alpha", position: { start: { offset: 5 }, end: { offset: 11 } } },
		] as any[];
		const r = rewriteBody(content, stale, rename("#alpha", "#beta"));
		assert.equal(r.content, content);
		assert.equal(r.changed, 0);
	});

	test("out-of-range offsets are ignored", () => {
		const bad = [
			{ tag: "#a", position: { start: { offset: 50 }, end: { offset: 60 } } },
		] as any[];
		const r = rewriteBody("#a", bad, rename("#a", "#b"));
		assert.equal(r.content, "#a");
		assert.equal(r.changed, 0);
	});

	test("inverted offsets are ignored", () => {
		const bad = [
			{ tag: "#a", position: { start: { offset: 2 }, end: { offset: 1 } } },
		] as any[];
		assert.equal(rewriteBody("#a x", bad, rename("#a", "#b")).changed, 0);
	});

	test("no hits leaves the content untouched", () => {
		const r = rewriteBody("nothing here", [], rename("#a", "#b"));
		assert.equal(r.content, "nothing here");
		assert.equal(r.changed, 0);
	});
});

describe("rewriteBody removal", () => {
	test("a tag-only line is removed entirely", () => {
		const content = "Title\n\n#gone\n\nBody text";
		const r = rewriteBody(content, hitsFor(content, ["#gone"]), remove("#gone"));
		assert.equal(r.content, "Title\n\n\nBody text");
		assert.equal(r.changed, 1);
	});

	test("an inline removal keeps its line", () => {
		const content = "Some #gone inline text";
		const r = rewriteBody(content, hitsFor(content, ["#gone"]), remove("#gone"));
		assert.equal(r.content, "Some  inline text");
	});

	test("blank lines the author wrote are preserved", () => {
		const content = "Keep\n\nReal blank line above stays\n\n#gone";
		const r = rewriteBody(content, hitsFor(content, ["#gone"]), remove("#gone"));
		assert.equal(r.content, "Keep\n\nReal blank line above stays\n");
	});

	test("several tags on one line collapse to an empty line once", () => {
		const content = "Head\n\n#a #b\n\nTail";
		const r = rewriteBody(content, hitsFor(content, ["#a", "#b"]), (tag) =>
			tag === "#a" || tag === "#b" ? "" : null
		);
		assert.equal(r.changed, 2);
		assert.equal(r.content, "Head\n\n\nTail");
	});
});

describe("rewriteFrontmatter", () => {
	test("a list stays a list and keeps its hash-less form", () => {
		const fm: Record<string, unknown> = { tags: ["alpha", "keep"] };
		assert.equal(rewriteFrontmatter(fm, rename("#alpha", "#beta")), 1);
		assert.deepEqual(fm.tags, ["beta", "keep"]);
	});

	test("entries written with a hash keep it", () => {
		const fm: Record<string, unknown> = { tags: ["#alpha", "#keep"] };
		rewriteFrontmatter(fm, rename("#alpha", "#beta"));
		assert.deepEqual(fm.tags, ["#beta", "#keep"]);
	});

	test("a string stays a string", () => {
		const fm: Record<string, unknown> = { tags: "alpha, keep" };
		rewriteFrontmatter(fm, rename("#alpha", "#beta"));
		assert.equal(fm.tags, "beta, keep");
	});

	test("an untouched key is never reshaped", () => {
		// Regression: a counter shared across keys made `tag` rewrite because
		// `tags` had changed, turning a string into a list.
		const fm: Record<string, unknown> = { tags: ["alpha"], tag: "untouched" };
		rewriteFrontmatter(fm, rename("#alpha", "#beta"));
		assert.deepEqual(fm.tags, ["beta"]);
		assert.equal(fm.tag, "untouched");
	});

	test("both tag keys are considered", () => {
		const fm: Record<string, unknown> = { tag: ["alpha"] };
		assert.equal(rewriteFrontmatter(fm, rename("#alpha", "#beta")), 1);
		assert.deepEqual(fm.tag, ["beta"]);
	});

	test("removal drops the entry", () => {
		const fm: Record<string, unknown> = { tags: ["alpha", "keep"] };
		assert.equal(rewriteFrontmatter(fm, remove("#alpha")), 1);
		assert.deepEqual(fm.tags, ["keep"]);
	});

	test("emptying the list deletes the key but spares the rest", () => {
		const fm: Record<string, unknown> = { tags: ["alpha"], title: "Note" };
		rewriteFrontmatter(fm, remove("#alpha"));
		assert.equal("tags" in fm, false);
		assert.equal(fm.title, "Note");
	});

	test("missing or empty tag keys are no-ops", () => {
		assert.equal(rewriteFrontmatter({}, rename("#a", "#b")), 0);
		assert.equal(rewriteFrontmatter({ tags: [] }, rename("#a", "#b")), 0);
		assert.equal(rewriteFrontmatter({ tags: null }, rename("#a", "#b")), 0);
	});

	test("case folding is the transform's responsibility, not the rewriter's", () => {
		const fm: Record<string, unknown> = { tags: ["Alpha"] };
		assert.equal(rewriteFrontmatter(fm, rename("#alpha", "#beta")), 0);
		assert.deepEqual(fm.tags, ["Alpha"]);
		const folding = (t: string) => (t.toLowerCase() === "#alpha" ? "#beta" : null);
		assert.equal(rewriteFrontmatter(fm, folding), 1);
		assert.deepEqual(fm.tags, ["beta"]);
	});
});

describe("validateTagName", () => {
	test("accepts ordinary names", () => {
		assert.deepEqual(validateTagName("project"), { ok: true, tag: "#project" });
		assert.deepEqual(validateTagName("#project"), { ok: true, tag: "#project" });
		assert.deepEqual(validateTagName("  project  "), { ok: true, tag: "#project" });
	});

	test("accepts hyphen, underscore and unicode letters", () => {
		assert.equal(validateTagName("a-b_c").ok, true);
		assert.deepEqual(validateTagName("проєкт"), { ok: true, tag: "#проєкт" });
		assert.equal(validateTagName("日本語").ok, true);
	});

	test("accepts a slash — valid, though nesting is out of scope (ADR 0007)", () => {
		assert.deepEqual(validateTagName("area/health"), {
			ok: true,
			tag: "#area/health",
		});
	});

	test("rejects empty, spaced and punctuated names", () => {
		assert.equal(validateTagName("").ok, false);
		assert.equal(validateTagName("   ").ok, false);
		assert.equal(validateTagName("two words").ok, false);
		assert.equal(validateTagName("a,b").ok, false);
		assert.equal(validateTagName("a#b").ok, false);
	});

	test("rejects all-digit names but allows digits with letters", () => {
		assert.equal(validateTagName("2024").ok, false);
		assert.equal(validateTagName("y2024").ok, true);
	});

	test("rejects misplaced slashes", () => {
		assert.equal(validateTagName("/a").ok, false);
		assert.equal(validateTagName("a/").ok, false);
		assert.equal(validateTagName("a//b").ok, false);
	});

	test("every rejection explains itself", () => {
		for (const bad of ["", "two words", "2024", "a/"]) {
			const result = validateTagName(bad);
			assert.equal(result.ok, false);
			assert.ok(result.error && result.error.length > 0);
		}
	});
});
