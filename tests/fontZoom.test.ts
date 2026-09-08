import test from "node:test";
import assert from "node:assert/strict";
import {
	FONT_SCALE_DEFAULT,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STOPS,
	clampFontScale,
	fontScaleLabel,
	isAtMaximum,
	isAtMinimum,
	stepFontScale,
} from "../src/fontZoom";

test("clampFontScale keeps values inside the range", () => {
	assert.equal(clampFontScale(1), 1);
	assert.equal(clampFontScale(0.1), FONT_SCALE_MIN);
	assert.equal(clampFontScale(99), FONT_SCALE_MAX);
	assert.equal(clampFontScale(FONT_SCALE_MIN), FONT_SCALE_MIN);
	assert.equal(clampFontScale(FONT_SCALE_MAX), FONT_SCALE_MAX);
});

test("clampFontScale falls back to the default for junk", () => {
	// A hand-edited data.json can hold anything at all.
	assert.equal(clampFontScale(NaN), FONT_SCALE_DEFAULT);
	assert.equal(clampFontScale(Infinity), FONT_SCALE_DEFAULT);
	assert.equal(clampFontScale(-Infinity), FONT_SCALE_DEFAULT);
	assert.equal(clampFontScale(undefined as unknown as number), FONT_SCALE_DEFAULT);
});

test("stepFontScale moves to the neighbouring stop", () => {
	assert.equal(stepFontScale(1, 1), 1.15);
	assert.equal(stepFontScale(1, -1), 0.85);
});

test("stepFontScale reads only the sign of the direction", () => {
	assert.equal(stepFontScale(1, 5), 1.15);
	assert.equal(stepFontScale(1, -0.2), 0.85);
	assert.equal(stepFontScale(1, 0), 1);
});

test("a value between two stops steps past it, not back to it", () => {
	// The settings slider sets values off the ladder; pressing + there should
	// go up, never sideways or down.
	assert.equal(stepFontScale(0.9, 1), 1);
	assert.equal(stepFontScale(0.9, -1), 0.85);
	assert.equal(stepFontScale(1.05, 1), 1.15);
	assert.equal(stepFontScale(1.05, -1), 1);
});

test("every stop is reachable in both directions", () => {
	let scale = FONT_SCALE_MIN;
	const up: number[] = [scale];
	for (let i = 0; i < FONT_SCALE_STOPS.length; i++) {
		scale = stepFontScale(scale, 1);
		if (up[up.length - 1] !== scale) up.push(scale);
	}
	assert.deepEqual(up, FONT_SCALE_STOPS);

	const down: number[] = [scale];
	for (let i = 0; i < FONT_SCALE_STOPS.length; i++) {
		scale = stepFontScale(scale, -1);
		if (down[down.length - 1] !== scale) down.push(scale);
	}
	assert.deepEqual(down, [...FONT_SCALE_STOPS].reverse());
});

test("stepping stops at the bounds instead of running past them", () => {
	let scale = FONT_SCALE_DEFAULT;
	for (let i = 0; i < 100; i++) scale = stepFontScale(scale, 1);
	assert.equal(scale, FONT_SCALE_MAX);
	for (let i = 0; i < 100; i++) scale = stepFontScale(scale, -1);
	assert.equal(scale, FONT_SCALE_MIN);
});

test("the stops are ordered, distinct, and round when read as percentages", () => {
	for (let i = 1; i < FONT_SCALE_STOPS.length; i++) {
		assert.ok(
			FONT_SCALE_STOPS[i] > FONT_SCALE_STOPS[i - 1],
			`stop ${i} is not above the one before it`
		);
	}
	for (const stop of FONT_SCALE_STOPS) {
		// Whole percentages to within float error — 1.15 * 100 is famously
		// 114.99999999999999, and the label rounds it, so the requirement is
		// that it is a whole percent, not that the product is exact.
		const percent = stop * 100;
		assert.ok(
			Math.abs(percent - Math.round(percent)) < 1e-9,
			`${stop} is not a whole percent`
		);
	}
});

test("the range reaches well below the old 60% floor", () => {
	// The point of the wider range: fitting many more tags on screen.
	assert.ok(FONT_SCALE_MIN < 0.6);
	assert.ok(FONT_SCALE_MAX > 2.5);
	assert.ok(FONT_SCALE_STOPS.includes(0.6));
});

test("no single press changes the size by more than half again", () => {
	// The reason for a ladder rather than a fixed step: every press should
	// feel like the same size of change, wherever you are in the range.
	for (let i = 1; i < FONT_SCALE_STOPS.length; i++) {
		const ratio = FONT_SCALE_STOPS[i] / FONT_SCALE_STOPS[i - 1];
		assert.ok(ratio <= 1.5, `${FONT_SCALE_STOPS[i]} is too big a jump`);
		assert.ok(ratio > 1, `${FONT_SCALE_STOPS[i]} is not a step up`);
	}
});

test("fontScaleLabel reads as a whole percentage", () => {
	assert.equal(fontScaleLabel(1), "100%");
	assert.equal(fontScaleLabel(1.15), "115%");
	assert.equal(fontScaleLabel(FONT_SCALE_MIN), "25%");
	assert.equal(fontScaleLabel(FONT_SCALE_MAX), "400%");
	assert.equal(fontScaleLabel(NaN), "100%");
});

test("fontScaleLabel clamps before formatting", () => {
	// An out-of-range value must not be reported back as if it applied.
	assert.equal(fontScaleLabel(9), "400%");
	assert.equal(fontScaleLabel(0), "25%");
});

test("bounds report themselves, and only themselves", () => {
	assert.ok(isAtMinimum(FONT_SCALE_MIN));
	assert.ok(isAtMinimum(0.2));
	assert.ok(!isAtMinimum(FONT_SCALE_DEFAULT));
	assert.ok(isAtMaximum(FONT_SCALE_MAX));
	assert.ok(isAtMaximum(80));
	assert.ok(!isAtMaximum(FONT_SCALE_DEFAULT));
});

test("the default is neither bound, so reset is always a move", () => {
	assert.ok(!isAtMinimum(FONT_SCALE_DEFAULT));
	assert.ok(!isAtMaximum(FONT_SCALE_DEFAULT));
	assert.ok(FONT_SCALE_MIN < FONT_SCALE_DEFAULT);
	assert.ok(FONT_SCALE_DEFAULT < FONT_SCALE_MAX);
});

import { pillFontSize } from "../src/host";

const RANGE = { minSize: 10, maxSize: 30 };

test("pillFontSize scales a lone tag to the top of the range", () => {
	const size = pillFontSize({
		count: 1,
		maxCount: 1,
		...RANGE,
		levelScale: 1,
		fontScale: 1,
	});
	assert.equal(size, 30);
});

test("pillFontSize multiplies the level scale and the font zoom together", () => {
	const base = pillFontSize({
		count: 4,
		maxCount: 8,
		...RANGE,
		levelScale: 1,
		fontScale: 1,
	});
	const levelled = pillFontSize({
		count: 4,
		maxCount: 8,
		...RANGE,
		levelScale: 1.5,
		fontScale: 1,
	});
	const both = pillFontSize({
		count: 4,
		maxCount: 8,
		...RANGE,
		levelScale: 1.5,
		fontScale: 2,
	});
	assert.ok(Math.abs(levelled - base * 1.5) < 1e-9);
	assert.ok(Math.abs(both - base * 3) < 1e-9);
});

test("pillFontSize keeps larger counts larger", () => {
	const small = pillFontSize({
		count: 1,
		maxCount: 100,
		...RANGE,
		levelScale: 1,
		fontScale: 1,
	});
	const big = pillFontSize({
		count: 90,
		maxCount: 100,
		...RANGE,
		levelScale: 1,
		fontScale: 1,
	});
	assert.ok(small < big);
	assert.ok(small >= RANGE.minSize);
	assert.ok(big <= RANGE.maxSize);
});

test("pillFontSize clamps an out-of-range font zoom", () => {
	// The stored value goes through the same clamp as the buttons, so a
	// hand-edited data.json cannot produce unreadable tags.
	const huge = pillFontSize({
		count: 1,
		maxCount: 1,
		...RANGE,
		levelScale: 1,
		fontScale: 100,
	});
	assert.equal(huge, 30 * FONT_SCALE_MAX);
	const tiny = pillFontSize({
		count: 1,
		maxCount: 1,
		...RANGE,
		levelScale: 1,
		fontScale: 0.001,
	});
	assert.equal(tiny, 30 * FONT_SCALE_MIN);
});

test("pillFontSize never returns a size a browser would reject", () => {
	const junk = pillFontSize({
		count: 1,
		maxCount: 1,
		...RANGE,
		levelScale: NaN,
		fontScale: 1,
	});
	assert.equal(junk, RANGE.minSize);
	const tiny = pillFontSize({
		count: 0,
		maxCount: 100,
		minSize: 0,
		maxSize: 0,
		levelScale: 1,
		fontScale: 1,
	});
	assert.ok(tiny >= 1);
});
