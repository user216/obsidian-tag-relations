export type ViewMode = "cloud" | "map" | "tree" | "groups" | "plex";

export type SortMode =
	| "name-asc"
	| "name-desc"
	| "count-desc"
	| "count-asc"
	| "relatedness";

/** How the strength of an implicit (co-occurrence based) relation is scored. */
export type WeightMetric = "cooccurrence" | "jaccard" | "cosine";

export const SORT_LABELS: Record<SortMode, string> = {
	"name-asc": "Name A → Z",
	"name-desc": "Name Z → A",
	"count-desc": "Notes (most first)",
	"count-asc": "Notes (fewest first)",
	relatedness: "Relatedness to selection",
};

/** A manual, user-declared relation between two tags. */
export interface ManualLink {
	a: string;
	b: string;
	label?: string;
}

/**
 * Whether a note must carry every selected tag or just one of them to appear
 * in the notes panel.
 */
export type NoteMatchMode = "all" | "any";

export const MATCH_LABELS: Record<NoteMatchMode, string> = {
	all: "All tags",
	any: "Any tag",
};

/**
 * How a click changes the selection. "replace" is a plain click (select just
 * this tag, or deselect it if it was the only one); "toggle" is a
 * modifier-click or a click in sticky multi-select mode (add/remove).
 */
export type SelectMode = "replace" | "toggle";

/**
 * A containment link: `parent` is a tag acting as a group, `child` is a tag
 * inside it. Membership is a DAG — a tag may sit in several groups at once.
 */
export interface GroupLink {
	parent: string;
	child: string;
}

/**
 * The three kinds of tag, derived from the group structure rather than stored:
 * a tag with members is a group, and it is a sub-group when something contains
 * it in turn.
 */
export type TagLevel = "main" | "sub" | "simple";

/** Deepest allowed chain of containers, so there are MAX + 1 = 3 levels. */
export const MAX_GROUP_DEPTH = 2;

export const LEVEL_LABELS: Record<TagLevel, string> = {
	main: "Main-tag",
	sub: "Sub-tag",
	simple: "Tag",
};

export const LEVEL_ORDER: TagLevel[] = ["main", "sub", "simple"];

/**
 * Which tag levels a view draws, and whether it separates them.
 * "all" places the levels in side-by-side columns; "merged" mixes them.
 */
export type LevelFilter = "tags" | "groups" | "all" | "merged";

export const LEVEL_FILTER_LABELS: Record<LevelFilter, string> = {
	tags: "Plain tags only",
	groups: "Tags + main-tags",
	all: "All levels, side by side",
	merged: "All levels, together",
};

/** How the tag cloud lays its tags out, in the manner of a file browser. */
export type CloudLayout = "icons" | "list" | "details" | "groups";

export const CLOUD_LAYOUT_LABELS: Record<CloudLayout, string> = {
	icons: "Icons",
	list: "List",
	details: "Details",
	groups: "Groups",
};

/** How strongly the three levels are told apart visually. */
export type LevelStylePreset = "subtle" | "balanced" | "bold" | "custom";

export const LEVEL_STYLE_LABELS: Record<LevelStylePreset, string> = {
	subtle: "Subtle",
	balanced: "Balanced",
	bold: "Bold",
	custom: "Custom",
};

export interface LevelStyle {
	/** Multiplier applied to the tag's computed font size. */
	scale: number;
	/** Shadow strength, 0 (flat) to 1 (pronounced). */
	shadow: number;
	/** CSS colour, or empty to inherit the theme's normal text colour. */
	color: string;
}

export type LevelStyles = Record<TagLevel, LevelStyle>;

export const LEVEL_STYLE_PRESETS: Record<
	Exclude<LevelStylePreset, "custom">,
	LevelStyles
> = {
	subtle: {
		main: { scale: 1.15, shadow: 0.2, color: "" },
		sub: { scale: 1.05, shadow: 0.1, color: "" },
		simple: { scale: 1, shadow: 0, color: "" },
	},
	balanced: {
		main: { scale: 1.4, shadow: 0.5, color: "#e0803c" },
		sub: { scale: 1.18, shadow: 0.28, color: "#3c9ee0" },
		simple: { scale: 1, shadow: 0, color: "" },
	},
	bold: {
		main: { scale: 1.8, shadow: 0.85, color: "#e0603c" },
		sub: { scale: 1.35, shadow: 0.5, color: "#3c7de0" },
		simple: { scale: 1, shadow: 0, color: "" },
	},
};

/**
 * Which pair of levels a relation joins. Group membership is drawn in its own
 * colour per pairing, so the structure is readable at a glance.
 */
export type ConnectionKind =
	| "cooccurrence"
	| "manual"
	| "main-sub"
	| "main-simple"
	| "sub-simple";

export const CONNECTION_LABELS: Record<ConnectionKind, string> = {
	cooccurrence: "Shared notes",
	manual: "Horizontal link",
	"main-sub": "Main-tag → sub-tag",
	"main-simple": "Main-tag → tag",
	"sub-simple": "Sub-tag → tag",
};

export const DEFAULT_CONNECTION_COLORS: Record<ConnectionKind, string> = {
	cooccurrence: "",
	manual: "",
	"main-sub": "#e0803c",
	"main-simple": "#c86ad0",
	"sub-simple": "#3c9ee0",
};
