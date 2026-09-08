/**
 * Font zoom: scaling the type in the views, independently of the cloud's
 * pan-and-zoom.
 *
 * The two are genuinely different and both are worth having. Pan-and-zoom
 * applies a transform — it magnifies spacing, borders and text together and
 * the layout does not reflow, so zooming in means scrolling around. Font zoom
 * changes the type size, so tags rewrap to fill the width: more of them fit
 * when you zoom out, and they stay readable when you zoom in.
 */
export const FONT_SCALE_MIN = 0.6;
export const FONT_SCALE_MAX = 2.5;
export const FONT_SCALE_STEP = 0.1;
export const FONT_SCALE_DEFAULT = 1;

export function clampFontScale(scale: number): number {
	if (!Number.isFinite(scale)) return FONT_SCALE_DEFAULT;
	return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
}

/**
 * One step up or down. Rounded to whole steps so repeated presses land on
 * clean values rather than drifting into 1.0999999999.
 */
export function stepFontScale(current: number, direction: number): number {
	const base = clampFontScale(current);
	const stepped = base + FONT_SCALE_STEP * Math.sign(direction);
	return clampFontScale(Math.round(stepped * 100) / 100);
}

export function fontScaleLabel(scale: number): string {
	return `${Math.round(clampFontScale(scale) * 100)}%`;
}

export function isAtMinimum(scale: number): boolean {
	return clampFontScale(scale) <= FONT_SCALE_MIN + 1e-9;
}

export function isAtMaximum(scale: number): boolean {
	return clampFontScale(scale) >= FONT_SCALE_MAX - 1e-9;
}
