export type ViewMode = "cloud" | "map" | "tree";

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
