import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_PINNED,
	levelCss,
	orderedLevels,
	resolveLevelStyles,
	separatesLevels,
	sortDetailsRows,
	togglePinned,
	visibleLevels,
} from "../src/levels";
import { clampScale } from "../src/panzoom";
import { LEVEL_STYLE_PRESETS, LevelStyles } from "../src/types";

describe("level style resolution", () => {
	test("a named preset wins over the stored custom values", () => {
		const custom: LevelStyles = {
			main: { scale: 9, shadow: 1, color: "#fff" },
			sub: { scale: 9, shadow: 1, color: "#fff" },
			simple: { scale: 9, shadow: 1, color: "#fff" },
		};
		assert.deepEqual(
			resolveLevelStyles("balanced", custom),
			LEVEL_STYLE_PRESETS.balanced
		);
	});

	test("custom uses the stored values", () => {
		const custom: LevelStyles = {
			main: { scale: 2, shadow: 0.5, color: "#abc" },
			sub: { scale: 1.5, shadow: 0.2, color: "" },
			simple: { scale: 1, shadow: 0, color: "" },
		};
		assert.deepEqual(resolveLevelStyles("custom", custom), custom);
	});

	test("every preset makes groups larger than plain tags", () => {
		for (const preset of Object.values(LEVEL_STYLE_PRESETS)) {
			assert.ok(preset.main.scale >= preset.sub.scale);
			assert.ok(preset.sub.scale >= preset.simple.scale);
		}
	});

	test("plain tags are left unstyled so they match the theme", () => {
		for (const preset of Object.values(LEVEL_STYLE_PRESETS)) {
			assert.equal(preset.simple.scale, 1);
			assert.equal(preset.simple.shadow, 0);
			assert.equal(preset.simple.color, "");
		}
	});
});

describe("levelCss", () => {
	test("no shadow produces no text-shadow at all", () => {
		assert.equal(levelCss({ scale: 1, shadow: 0, color: "" }).textShadow, "");
	});

	test("shadow strength drives blur and opacity together", () => {
		const soft = levelCss({ scale: 1, shadow: 0.2, color: "" }).textShadow;
		const hard = levelCss({ scale: 1, shadow: 0.9, color: "" }).textShadow;
		assert.notEqual(soft, "");
		assert.notEqual(soft, hard);
	});

	test("an empty colour stays empty so the theme shows through", () => {
		assert.equal(levelCss({ scale: 1, shadow: 0, color: "" }).color, "");
		assert.equal(levelCss({ scale: 1, shadow: 0, color: " #abc " }).color, "#abc");
	});

	test("scale is clamped to a sane range", () => {
		assert.equal(levelCss({ scale: 99, shadow: 0, color: "" }).fontScale, 4);
		assert.equal(levelCss({ scale: -5, shadow: 0, color: "" }).fontScale, 0.5);
	});

	test("a broken stored value falls back rather than producing NaN", () => {
		const css = levelCss({ scale: NaN, shadow: NaN, color: "" });
		assert.ok(Number.isFinite(css.fontScale));
		assert.equal(css.textShadow, "");
	});
});

describe("level filters", () => {
	test("tags-only hides both group levels", () => {
		const levels = visibleLevels("tags");
		assert.equal(levels.has("simple"), true);
		assert.equal(levels.has("main"), false);
		assert.equal(levels.has("sub"), false);
	});

	test("groups shows main groups but not sub-groups", () => {
		const levels = visibleLevels("groups");
		assert.equal(levels.has("main"), true);
		assert.equal(levels.has("sub"), false);
		assert.equal(levels.has("simple"), true);
	});

	test("all and merged both show everything", () => {
		for (const filter of ["all", "merged"] as const) {
			assert.equal(visibleLevels(filter).size, 3);
		}
	});

	test("only the separated filter splits levels into bands", () => {
		assert.equal(separatesLevels("all"), true);
		assert.equal(separatesLevels("merged"), false);
		assert.equal(separatesLevels("tags"), false);
	});

	test("orderedLevels goes outermost first and respects the filter", () => {
		assert.deepEqual(orderedLevels("all"), ["main", "sub", "simple"]);
		assert.deepEqual(orderedLevels("groups"), ["main", "simple"]);
		assert.deepEqual(orderedLevels("tags"), ["simple"]);
	});
});

describe("pinning", () => {
	test("pins a tag that is not pinned", () => {
		const result = togglePinned(["#a"], "#b");
		assert.deepEqual(result.pinned, ["#a", "#b"]);
		assert.equal(result.changed, true);
	});

	test("unpins a tag that is", () => {
		const result = togglePinned(["#a", "#b"], "#a");
		assert.deepEqual(result.pinned, ["#b"]);
		assert.equal(result.changed, true);
	});

	test("unpinning always works even at the cap", () => {
		const full = Array.from({ length: MAX_PINNED }, (_, i) => `#t${i}`);
		const result = togglePinned(full, "#t0");
		assert.equal(result.changed, true);
		assert.equal(result.pinned.length, MAX_PINNED - 1);
	});

	test("refuses to pin past the cap, and explains why", () => {
		const full = Array.from({ length: MAX_PINNED }, (_, i) => `#t${i}`);
		const result = togglePinned(full, "#extra");
		assert.equal(result.changed, false);
		assert.deepEqual(result.pinned, full);
		assert.match(result.reason ?? "", new RegExp(String(MAX_PINNED)));
	});

	test("the cap is ten, as specified", () => {
		assert.equal(MAX_PINNED, 10);
	});

	test("never mutates the array it was given", () => {
		const original = ["#a"];
		togglePinned(original, "#b");
		togglePinned(original, "#a");
		assert.deepEqual(original, ["#a"]);
	});

	test("pin order is preserved", () => {
		let pinned: string[] = [];
		for (const tag of ["#c", "#a", "#b"]) {
			pinned = togglePinned(pinned, tag).pinned;
		}
		assert.deepEqual(pinned, ["#c", "#a", "#b"]);
	});
});

describe("zoom clamping", () => {
	test("keeps the scale within usable bounds", () => {
		assert.equal(clampScale(1), 1);
		assert.equal(clampScale(0.01), 0.2);
		assert.equal(clampScale(99), 5);
	});

	test("a broken stored zoom falls back to 1, not to a bound", () => {
		// NaN and Infinity both mean the stored value is unusable, so neither
		// should be clamped into a legitimate-looking extreme zoom.
		assert.equal(clampScale(NaN), 1);
		assert.equal(clampScale(Infinity), 1);
		assert.equal(clampScale(-Infinity), 1);
	});
});

describe("sortDetailsRows", () => {
	const rows: Record<string, { level: "main" | "sub" | "simple"; count: number; relations: number; groups: number }> = {
		"#zebra": { level: "simple", count: 5, relations: 2, groups: 1 },
		"#apple": { level: "main", count: 2, relations: 9, groups: 0 },
		"#mango": { level: "sub", count: 2, relations: 1, groups: 2 },
	};
	const ctx = {
		nameOf: (tag: string) => tag.replace("#", ""),
		levelOf: (tag: string) => rows[tag].level,
		countOf: (tag: string) => rows[tag].count,
		relationsOf: (tag: string) => rows[tag].relations,
		groupsOf: (tag: string) => rows[tag].groups,
	};
	const tags = Object.keys(rows);

	test("name ascending and descending", () => {
		assert.deepEqual(sortDetailsRows(tags, "name", true, ctx), [
			"#apple", "#mango", "#zebra",
		]);
		assert.deepEqual(sortDetailsRows(tags, "name", false, ctx), [
			"#zebra", "#mango", "#apple",
		]);
	});

	test("kind sorts by level order: main, sub, simple", () => {
		assert.deepEqual(sortDetailsRows(tags, "kind", true, ctx), [
			"#apple", "#mango", "#zebra",
		]);
	});

	test("notes, relations and groups sort numerically", () => {
		assert.deepEqual(sortDetailsRows(tags, "notes", true, ctx), [
			"#apple", "#mango", "#zebra",
		]);
		assert.deepEqual(sortDetailsRows(tags, "relations", false, ctx), [
			"#apple", "#zebra", "#mango",
		]);
		assert.deepEqual(sortDetailsRows(tags, "groups", true, ctx), [
			"#apple", "#zebra", "#mango",
		]);
	});

	test("ties break by name regardless of direction", () => {
		// #apple and #mango both have count 2.
		const ascending = sortDetailsRows(tags, "notes", true, ctx);
		assert.deepEqual(ascending.slice(0, 2), ["#apple", "#mango"]);
	});

	test("does not mutate the input array", () => {
		const input = tags.slice();
		sortDetailsRows(input, "name", false, ctx);
		assert.deepEqual(input, tags);
	});

	test("an empty list stays empty", () => {
		assert.deepEqual(sortDetailsRows([], "name", true, ctx), []);
	});
});
