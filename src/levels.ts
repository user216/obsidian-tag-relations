import {
	LEVEL_STYLE_PRESETS,
	LevelFilter,
	LevelStyle,
	LevelStylePreset,
	LevelStyles,
	TagLevel,
} from "./types";

/**
 * How the three tag levels are told apart on screen, and which of them a view
 * is currently showing. Kept free of the DOM so the rules are testable.
 */

/** The styles actually in force: a preset, or the user's own numbers. */
export function resolveLevelStyles(
	preset: LevelStylePreset,
	custom: LevelStyles
): LevelStyles {
	return preset === "custom" ? custom : LEVEL_STYLE_PRESETS[preset];
}

/** Which levels a filter admits. */
export function visibleLevels(filter: LevelFilter): Set<TagLevel> {
	switch (filter) {
		case "tags":
			return new Set<TagLevel>(["simple"]);
		case "groups":
			return new Set<TagLevel>(["main", "simple"]);
		default:
			return new Set<TagLevel>(["main", "sub", "simple"]);
	}
}

/**
 * Whether the view splits levels into their own areas. "all" separates them
 * so each level reads as its own band; "merged" shows the same tags mixed
 * together in one field.
 */
export function separatesLevels(filter: LevelFilter): boolean {
	return filter === "all";
}

export interface LevelCss {
	/** Multiplier on the tag's computed font size. */
	fontScale: number;
	/** Ready-to-assign `text-shadow`, or "" for none. */
	textShadow: string;
	/** Ready-to-assign `color`, or "" to inherit the theme. */
	color: string;
}

/**
 * Turn a level's style into CSS values. The shadow grows in both blur and
 * opacity together, so a higher setting reads as "raised" rather than just
 * "blurrier".
 */
export function levelCss(style: LevelStyle): LevelCss {
	const shadow = clamp(style.shadow, 0, 1);
	return {
		fontScale: clamp(style.scale, 0.5, 4),
		textShadow:
			shadow <= 0
				? ""
				: `0 ${(shadow * 2).toFixed(2)}px ${(shadow * 6).toFixed(
						2
				  )}px rgba(0, 0, 0, ${(shadow * 0.55).toFixed(3)})`,
		color: style.color.trim(),
	};
}

/** Levels in the order they are drawn when a view separates them. */
export function orderedLevels(filter: LevelFilter): TagLevel[] {
	const visible = visibleLevels(filter);
	return (["main", "sub", "simple"] as TagLevel[]).filter((level) =>
		visible.has(level)
	);
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/**
 * Pinned tags, capped so the pinned strip stays a shortlist rather than a
 * second copy of the cloud.
 */
export const MAX_PINNED = 10;

export function togglePinned(pinned: string[], tag: string): {
	pinned: string[];
	changed: boolean;
	reason?: string;
} {
	const index = pinned.indexOf(tag);
	if (index >= 0) {
		const next = pinned.slice();
		next.splice(index, 1);
		return { pinned: next, changed: true };
	}
	if (pinned.length >= MAX_PINNED) {
		return {
			pinned,
			changed: false,
			reason: `Only ${MAX_PINNED} tags can be pinned. Unpin one first.`,
		};
	}
	return { pinned: pinned.concat(tag), changed: true };
}
