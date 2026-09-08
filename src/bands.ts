/**
 * Splitting a list of tags into labelled bands — pinned, bookmarked, and
 * everything else — so the views can show them separated rather than mixed.
 *
 * Shared by the cloud, tree and groups views. A tag belongs to exactly one
 * band, by precedence, because showing the same tag twice under two headings
 * would make the bands read as filters rather than as a partition of the list.
 */
export type BandId = "pinned" | "bookmarked" | "rest";

export interface TagBand {
	id: BandId;
	label: string;
	tags: string[];
}

export type BandPosition = "top" | "bottom";

export interface BandOptions {
	pinned: Iterable<string>;
	bookmarked: Iterable<string>;
	showPinned: boolean;
	showBookmarked: boolean;
	/** Where the bookmarked band sits relative to everything else. */
	bookmarkedPosition: BandPosition;
}

export const BAND_POSITION_LABELS: Record<BandPosition, string> = {
	top: "Above the rest",
	bottom: "Below the rest",
};

/**
 * Partition `tags` into bands, preserving the order they arrived in within
 * each band — that order is the view's chosen sort, and re-sorting here would
 * silently override it.
 *
 * A disabled band is not dropped: its tags fall through into the rest, so
 * turning a band off never hides anything.
 */
export function splitIntoBands(
	tags: string[],
	options: BandOptions
): TagBand[] {
	const pinned = new Set(options.pinned);
	const bookmarked = new Set(options.bookmarked);

	const pinnedTags: string[] = [];
	const bookmarkedTags: string[] = [];
	const rest: string[] = [];

	for (const tag of tags) {
		// Precedence, so a tag that is both lands in one band only. Pinned
		// wins because it is the stronger, deliberately-capped signal.
		if (options.showPinned && pinned.has(tag)) pinnedTags.push(tag);
		else if (options.showBookmarked && bookmarked.has(tag)) {
			bookmarkedTags.push(tag);
		} else rest.push(tag);
	}

	const hasPinned = pinnedTags.length > 0;
	const hasBookmarked = bookmarkedTags.length > 0;

	const bands: TagBand[] = [];
	if (hasPinned) {
		bands.push({ id: "pinned", label: "Pinned", tags: pinnedTags });
	}
	if (hasBookmarked && options.bookmarkedPosition === "top") {
		bands.push({ id: "bookmarked", label: "Bookmarked", tags: bookmarkedTags });
	}
	if (rest.length > 0) {
		bands.push({
			id: "rest",
			// "Unpinned" is only accurate when pinning is the sole thing
			// lifted out; with a bookmarked band above, its tags are unpinned
			// too and the heading would be a lie.
			label: hasPinned && !hasBookmarked ? "Unpinned" : "Other tags",
			tags: rest,
		});
	}
	if (hasBookmarked && options.bookmarkedPosition === "bottom") {
		bands.push({ id: "bookmarked", label: "Bookmarked", tags: bookmarkedTags });
	}

	// One band holding everything needs no heading — the label would be
	// describing the entire list, which says nothing.
	if (bands.length === 1) return [{ ...bands[0], label: "" }];
	return bands;
}
