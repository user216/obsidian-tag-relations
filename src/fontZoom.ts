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

/**
 * The stops the buttons and commands move between, in the manner of a
 * browser's own zoom menu.
 *
 * A fixed step cannot serve a range this wide. Ten percentage points is a
 * third of the way out of 30% and a rounding error at 400%, so a linear step
 * is either too coarse at the small end or turns the large end into a hundred
 * clicks. The stops are spaced roughly proportionally instead, which keeps
 * every press a similar *relative* change and keeps the readings round.
 *
 * The slider in settings is not restricted to these — it sets any value in
 * range, and stepping from an off-ladder value moves to the next stop past it
 * rather than snapping backwards first.
 */
export const FONT_SCALE_STOPS = [
	0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5,
	3, 4,
];

export const FONT_SCALE_MIN = FONT_SCALE_STOPS[0];
export const FONT_SCALE_MAX = FONT_SCALE_STOPS[FONT_SCALE_STOPS.length - 1];
export const FONT_SCALE_DEFAULT = 1;

/** The slider's granularity — finer than the stops, since it is dragged. */
export const FONT_SCALE_STEP = 0.05;

export function clampFontScale(scale: number): number {
	if (!Number.isFinite(scale)) return FONT_SCALE_DEFAULT;
	return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
}

/**
 * The next stop up or down.
 *
 * "Next past the current value" rather than "one index along", so a value the
 * slider produced between two stops steps to the neighbouring stop instead of
 * first jumping to whichever stop it happens to sit nearest.
 */
export function stepFontScale(current: number, direction: number): number {
	const base = clampFontScale(current);
	const sign = Math.sign(direction);
	if (sign === 0) return base;

	// A hair of tolerance, so a value that *is* a stop is not blocked from
	// moving by floating-point noise in the stored number.
	const epsilon = 1e-9;
	if (sign > 0) {
		const next = FONT_SCALE_STOPS.find((stop) => stop > base + epsilon);
		return next ?? FONT_SCALE_MAX;
	}
	const previous = [...FONT_SCALE_STOPS]
		.reverse()
		.find((stop) => stop < base - epsilon);
	return previous ?? FONT_SCALE_MIN;
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
