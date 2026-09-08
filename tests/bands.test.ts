import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitIntoBands } from "../src/bands";
import type { BandOptions } from "../src/bands";

const TAGS = ["#a", "#b", "#c", "#d"];

function opts(over: Partial<BandOptions> = {}): BandOptions {
	return {
		pinned: [],
		bookmarked: [],
		showPinned: true,
		showBookmarked: true,
		bookmarkedPosition: "top",
		...over,
	};
}
const shape = (bands: ReturnType<typeof splitIntoBands>) =>
	bands.map((band) => [band.label, band.tags] as const);

describe("splitting into bands", () => {
	test("with nothing pinned or bookmarked there is one unlabelled band", () => {
		assert.deepEqual(shape(splitIntoBands(TAGS, opts())), [["", TAGS]]);
	});

	test("pinned tags are lifted out, in the order they arrived", () => {
		assert.deepEqual(shape(splitIntoBands(TAGS, opts({ pinned: ["#c", "#a"] }))), [
			["Pinned", ["#a", "#c"]],
			["Unpinned", ["#b", "#d"]],
		]);
	});

	test("bookmarked tags get their own band", () => {
		assert.deepEqual(
			shape(splitIntoBands(TAGS, opts({ bookmarked: ["#b"] }))),
			[
				["Bookmarked", ["#b"]],
				["Other tags", ["#a", "#c", "#d"]],
			]
		);
	});

	test("the bookmarked band can sit below everything else", () => {
		assert.deepEqual(
			shape(
				splitIntoBands(
					TAGS,
					opts({ bookmarked: ["#b"], bookmarkedPosition: "bottom" })
				)
			),
			[
				["Other tags", ["#a", "#c", "#d"]],
				["Bookmarked", ["#b"]],
			]
		);
	});

	test("pinned stays on top even when bookmarked goes to the bottom", () => {
		const bands = splitIntoBands(
			TAGS,
			opts({
				pinned: ["#a"],
				bookmarked: ["#b"],
				bookmarkedPosition: "bottom",
			})
		);
		assert.deepEqual(bands.map((b) => b.id), ["pinned", "rest", "bookmarked"]);
	});
});

describe("a tag in more than one band", () => {
	test("pinned wins over bookmarked, so it appears once", () => {
		const bands = splitIntoBands(
			TAGS,
			opts({ pinned: ["#a"], bookmarked: ["#a", "#b"] })
		);
		assert.deepEqual(shape(bands), [
			["Pinned", ["#a"]],
			["Bookmarked", ["#b"]],
			["Other tags", ["#c", "#d"]],
		]);
	});

	test("no tag is ever lost or duplicated across the bands", () => {
		const bands = splitIntoBands(
			TAGS,
			opts({ pinned: ["#a", "#b"], bookmarked: ["#b", "#c"] })
		);
		const all = bands.flatMap((band) => band.tags);
		assert.deepEqual(all.slice().sort(), TAGS.slice().sort());
		assert.equal(new Set(all).size, TAGS.length);
	});
});

describe("turning a band off", () => {
	test("its tags fall through to the rest rather than vanishing", () => {
		assert.deepEqual(
			shape(splitIntoBands(TAGS, opts({ pinned: ["#a"], showPinned: false }))),
			[["", TAGS]]
		);
	});

	test("turning both off leaves one plain list", () => {
		const bands = splitIntoBands(
			TAGS,
			opts({
				pinned: ["#a"],
				bookmarked: ["#b"],
				showPinned: false,
				showBookmarked: false,
			})
		);
		assert.deepEqual(shape(bands), [["", TAGS]]);
	});
});

describe("labels", () => {
	test("a lone band carries no heading, since it would describe everything", () => {
		assert.equal(splitIntoBands(TAGS, opts())[0].label, "");
	});

	test("the rest is 'Unpinned' only when pinning alone was lifted out", () => {
		assert.equal(
			splitIntoBands(TAGS, opts({ pinned: ["#a"] }))[1].label,
			"Unpinned"
		);
	});

	test("with a bookmarked band above, the rest is not called 'Unpinned'", () => {
		// Those tags are unpinned too, so the heading would be a lie.
		const bands = splitIntoBands(
			TAGS,
			opts({ pinned: ["#a"], bookmarked: ["#b"] })
		);
		assert.equal(bands[2].label, "Other tags");
	});

	test("an empty band is omitted entirely", () => {
		const bands = splitIntoBands(["#a"], opts({ pinned: ["#a"] }));
		assert.deepEqual(bands.map((b) => b.id), ["pinned"]);
	});

	test("an empty list yields no bands", () => {
		assert.deepEqual(splitIntoBands([], opts({ pinned: ["#a"] })), []);
	});
});
