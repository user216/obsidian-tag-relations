/**
 * The plex: one tag in the middle, its relatives arranged by *what kind of
 * relation* they have to it.
 *
 * This is TheBrain's arrangement applied to tags rather than thoughts. The
 * axes carry the meaning, so the position of a tag tells you what it is to the
 * one in the centre without reading a label:
 *
 *          main-tags        (what contains it)
 *              |
 *   shared  [ TAG ]  linked (what it appears with / what it was joined to)
 *              |
 *          sub-tags         (what it contains)
 *
 * The two side bands are split by **where the relation lives**, which is the
 * distinction that matters most in this plugin. On the left are tags related
 * through the notes themselves — they share a note, so the relation is a fact
 * about the vault and cannot be removed from here. On the right are tags
 * joined by a horizontal link, which exists only in plugin data and was made
 * by hand. Mixing the two in one band would hide the difference between an
 * observation and a decision.
 *
 * Only the immediate neighbourhood is drawn, which is the whole point: a full
 * graph of a real vault is unreadable, and walking it one step at a time is
 * not. Depth adds context around that ring rather than expanding it.
 */

export type PlexDepth = "immediate" | "siblings" | "extended";

export const PLEX_DEPTH_LABELS: Record<PlexDepth, string> = {
	immediate: "Immediate relatives",
	siblings: "Relatives and siblings",
	extended: "Relatives, siblings and beyond",
};

export const PLEX_DEPTH_DESCRIPTIONS: Record<PlexDepth, string> = {
	immediate: "Main-tags above, sub-tags below, the two side bands. Nothing else.",
	siblings: "Adds the other tags sharing a main-tag with this one.",
	extended:
		"Adds siblings, plus the level above the main-tags and below the sub-tags, drawn faintly.",
};

export type PlexRowId =
	| "grandparents"
	| "parents"
	| "siblings"
	| "children"
	| "grandchildren";

export interface PlexRow {
	id: PlexRowId;
	label: string;
	tags: string[];
	/** How many were cut by the cap, so the view can say so. */
	hidden: number;
	/** Context rather than the immediate ring; drawn faintly. */
	dim: boolean;
}

export interface PlexSideBand {
	id: "shared" | "linked";
	label: string;
	tags: string[];
	hidden: number;
}

export interface PlexLayout {
	active: string;
	/** Rows above the active tag, outermost first. */
	above: PlexRow[];
	/** Rows below the active tag, innermost first. */
	below: PlexRow[];
	left: PlexSideBand;
	right: PlexSideBand;
	/** True when nothing at all relates to the active tag. */
	isolated: boolean;
}

/**
 * What the plex needs to know, as plain queries. Keeping the graph and the
 * group DAG behind this makes the arrangement testable on its own, which is
 * where the interesting rules live.
 */
export interface PlexSource {
	/** Groups containing this tag. */
	parentsOf(tag: string): string[];
	/** Tags this group contains. */
	childrenOf(tag: string): string[];
	/** Tags joined to this one by a horizontal link. */
	linkedTo(tag: string): string[];
	/** Tags sharing at least one note with this one, strongest first. */
	sharedWith(tag: string): string[];
	/** Whether a tag survives the filter and the level filter. */
	isVisible(tag: string): boolean;
}

export interface PlexOptions {
	active: string;
	source: PlexSource;
	depth: PlexDepth;
	/** Most tags to show in any one row or band; 0 means no limit. */
	cap: number;
}

const ROW_LABELS: Record<PlexRowId, string> = {
	grandparents: "Above the main-tags",
	parents: "Main-tags",
	siblings: "Siblings",
	children: "Sub-tags",
	grandchildren: "Below the sub-tags",
};

/**
 * Arrange the neighbourhood of one tag.
 *
 * A tag appears in exactly one place. Precedence runs hierarchy → linked →
 * shared, because the axes are supposed to *mean* something: a tag drawn both
 * above and to the side would turn the arrangement into two overlapping lists
 * rather than one partition, and you could no longer read a tag's relation off
 * its position. The same reasoning governs the pinned/bookmarked bands.
 */
export function buildPlex(options: PlexOptions): PlexLayout {
	const { active, source, depth } = options;
	const visible = (tags: string[]): string[] =>
		tags.filter((tag) => tag !== active && source.isVisible(tag));

	// Claimed as we go, so later rows never repeat an earlier one.
	const taken = new Set<string>([active]);
	const claim = (tags: string[]): string[] => {
		const kept: string[] = [];
		for (const tag of tags) {
			if (taken.has(tag)) continue;
			taken.add(tag);
			kept.push(tag);
		}
		return kept;
	};

	const parents = claim(visible(source.parentsOf(active)));
	const children = claim(visible(source.childrenOf(active)));

	// Siblings come from the *unclaimed* children of this tag's parents, so a
	// tag that is both a sibling and a sub-group stays where it is.
	const siblings =
		depth === "immediate"
			? []
			: claim(
					visible(
						unique(
							source
								.parentsOf(active)
								.flatMap((parent) => source.childrenOf(parent))
						)
					)
			  );

	const grandparents =
		depth === "extended"
			? claim(
					visible(
						unique(parents.flatMap((parent) => source.parentsOf(parent)))
					)
			  )
			: [];
	const grandchildren =
		depth === "extended"
			? claim(
					visible(unique(children.flatMap((child) => source.childrenOf(child))))
			  )
			: [];

	// Hand-made links before observed ones: a relation someone declared is a
	// stronger statement than one the vault happens to contain.
	const linked = claim(visible(source.linkedTo(active)));
	const shared = claim(visible(source.sharedWith(active)));

	const above: PlexRow[] = [];
	if (grandparents.length > 0) {
		above.push(row("grandparents", grandparents, options.cap, true));
	}
	if (parents.length > 0) above.push(row("parents", parents, options.cap, false));
	if (siblings.length > 0) {
		above.push(row("siblings", siblings, options.cap, true));
	}

	const below: PlexRow[] = [];
	if (children.length > 0) below.push(row("children", children, options.cap, false));
	if (grandchildren.length > 0) {
		below.push(row("grandchildren", grandchildren, options.cap, true));
	}

	const left = band("shared", "Shares notes with", shared, options.cap);
	const right = band("linked", "Linked to", linked, options.cap);

	return {
		active,
		above,
		below,
		left,
		right,
		isolated:
			above.length === 0 &&
			below.length === 0 &&
			left.tags.length === 0 &&
			right.tags.length === 0,
	};
}

function row(id: PlexRowId, tags: string[], cap: number, dim: boolean): PlexRow {
	const shown = cap > 0 ? tags.slice(0, cap) : tags;
	return {
		id,
		label: ROW_LABELS[id],
		tags: shown,
		hidden: tags.length - shown.length,
		dim,
	};
}

function band(
	id: "shared" | "linked",
	label: string,
	tags: string[],
	cap: number
): PlexSideBand {
	const shown = cap > 0 ? tags.slice(0, cap) : tags;
	return { id, label, tags: shown, hidden: tags.length - shown.length };
}

function unique(tags: string[]): string[] {
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const tag of tags) {
		if (seen.has(tag)) continue;
		seen.add(tag);
		kept.push(tag);
	}
	return kept;
}

export interface NotePreview {
	/** Paths to list, already capped. */
	paths: string[];
	/** How many the cap left out. */
	hidden: number;
	/** The heading, which says what is being previewed and how much of it. */
	heading: string;
}

/**
 * What the note preview under the plex should show for the active tag.
 *
 * Pure, because the interesting part is the counting: a preview that says
 * "6 notes" while the tag has ninety would be worse than no preview, so the
 * total is always in the heading and the remainder is always counted.
 */
export function previewNotes(
	tag: string,
	paths: string[],
	cap: number
): NotePreview {
	const shown = cap > 0 ? paths.slice(0, cap) : paths;
	const label = tag.startsWith("#") ? tag : `#${tag}`;
	return {
		paths: shown,
		hidden: paths.length - shown.length,
		heading:
			paths.length === 0
				? `No notes carry ${label}`
				: `${paths.length} note${paths.length === 1 ? "" : "s"} tagged ${label}`,
	};
}

/**
 * Where the plex opens when nothing is selected.
 *
 * A pinned tag first — pinning is the one signal that says "this is where I
 * work" — then the most connected tag, which is at least a place the vault is
 * built around. An empty plex asking to be filled in would make the view cost
 * a click every time it is opened.
 */
export function startingTag(options: {
	selection: string[];
	pinned: string[];
	visible: string[];
	degreeOf(tag: string): number;
}): string | null {
	// The last tag picked is the active one, the way clicking through a plex
	// makes each tag active in turn.
	const selected = options.selection[options.selection.length - 1];
	if (selected) return selected;

	const present = new Set(options.visible);
	const pinned = options.pinned.find((tag) => present.has(tag));
	if (pinned) return pinned;

	let best: string | null = null;
	let bestDegree = -1;
	for (const tag of options.visible) {
		const degree = options.degreeOf(tag);
		// Ties break alphabetically so the view opens on the same tag twice.
		if (degree > bestDegree || (degree === bestDegree && best && tag < best)) {
			best = tag;
			bestDegree = degree;
		}
	}
	return best;
}
