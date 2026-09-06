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
