import test from "node:test";
import assert from "node:assert/strict";
import {
	FONT_SCALE_DEFAULT,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STEP,
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

test("stepFontScale moves one step in each direction", () => {
	assert.equal(stepFontScale(1, 1), 1.1);
	assert.equal(stepFontScale(1, -1), 0.9);
});

test("stepFontScale reads only the sign of the direction", () => {
	assert.equal(stepFontScale(1, 5), 1.1);
	assert.equal(stepFontScale(1, -0.2), 0.9);
	assert.equal(stepFontScale(1, 0), 1);
});

test("repeated steps land on clean values", () => {
	// Without rounding this drifts into 1.0999999999999999 and the label
	// starts reading 110% for a value that is not 1.1.
	let scale = FONT_SCALE_DEFAULT;
	for (let i = 0; i < 6; i++) scale = stepFontScale(scale, 1);
	assert.equal(scale, 1.6);
	for (let i = 0; i < 6; i++) scale = stepFontScale(scale, -1);
	assert.equal(scale, FONT_SCALE_DEFAULT);
});

test("stepping stops at the bounds instead of running past them", () => {
	let scale = FONT_SCALE_DEFAULT;
	for (let i = 0; i < 100; i++) scale = stepFontScale(scale, 1);
	assert.equal(scale, FONT_SCALE_MAX);
	for (let i = 0; i < 100; i++) scale = stepFontScale(scale, -1);
	assert.equal(scale, FONT_SCALE_MIN);
});

test("every step between the bounds is reachable", () => {
	// The bounds are step-aligned, so no step is ever swallowed by the clamp.
	const steps = Math.round((FONT_SCALE_MAX - FONT_SCALE_MIN) / FONT_SCALE_STEP);
	let scale = FONT_SCALE_MIN;
	const seen = new Set<number>([scale]);
	for (let i = 0; i < steps; i++) {
		scale = stepFontScale(scale, 1);
		seen.add(scale);
	}
	assert.equal(scale, FONT_SCALE_MAX);
	assert.equal(seen.size, steps + 1);
});

test("fontScaleLabel reads as a whole percentage", () => {
	assert.equal(fontScaleLabel(1), "100%");
	assert.equal(fontScaleLabel(1.1), "110%");
	assert.equal(fontScaleLabel(FONT_SCALE_MIN), "60%");
	assert.equal(fontScaleLabel(FONT_SCALE_MAX), "250%");
	assert.equal(fontScaleLabel(NaN), "100%");
});

test("fontScaleLabel clamps before formatting", () => {
	// An out-of-range value must not be reported back as if it applied.
	assert.equal(fontScaleLabel(9), "250%");
	assert.equal(fontScaleLabel(0), "60%");
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
