import { GroupLink, ManualLink } from "./types";

/**
 * Which relations a tag has that the plugin is actually able to remove.
 *
 * The distinction matters and is worth stating plainly: a co-occurrence
 * relation is not stored anywhere — it is *observed*, from two tags appearing
 * on the same note. There is nothing to delete. Removing one would mean
 * editing notes, which is a different and far more destructive operation
 * (that is what "Remove this tag from all notes" is for).
 *
 * So "remove a relation" here means exactly: drop a horizontal link, drop a
 * group membership, or both — all of which live in plugin data and cost
 * nothing to undo by redoing them.
 */
export type RemovableKind = "link" | "contains" | "inside";

export interface RemovableRelation {
	/** The tag at the other end. */
	other: string;
	/**
	 * Every removable tie to `other`. More than one is possible: two tags can
	 * be horizontally linked *and* one contain the other.
	 */
	kinds: RemovableKind[];
}

export interface RelationStore {
	manualLinks: ManualLink[];
	groupLinks: GroupLink[];
}

const KIND_LABELS: Record<RemovableKind, string> = {
	link: "horizontal link",
	contains: "contains it",
	inside: "inside it",
};

/** Human-readable summary of one relation, for pickers and confirmations. */
export function describeRemovable(relation: RemovableRelation): string {
	return relation.kinds.map((kind) => KIND_LABELS[kind]).join(" + ");
}

function samePair(a: string, b: string, x: string, y: string): boolean {
	return (a === x && b === y) || (a === y && b === x);
}

/**
 * Every relation of `tag` that can be removed, grouped by the tag at the
 * other end and ordered by that tag's name so the list is stable.
 */
export function removableRelations(
	tag: string,
	store: RelationStore
): RemovableRelation[] {
	const byOther = new Map<string, RemovableKind[]>();
	const add = (other: string, kind: RemovableKind) => {
		const kinds = byOther.get(other);
		if (kinds) {
			if (!kinds.includes(kind)) kinds.push(kind);
		} else {
			byOther.set(other, [kind]);
		}
	};

	for (const link of store.manualLinks) {
		if (link.a === tag) add(link.b, "link");
		else if (link.b === tag) add(link.a, "link");
	}
	for (const link of store.groupLinks) {
		// From `tag`'s point of view: it either contains the other, or sits
		// inside it. Naming them separately is what lets a picker say which.
		if (link.parent === tag) add(link.child, "contains");
		else if (link.child === tag) add(link.parent, "inside");
	}

	return Array.from(byOther.entries())
		.map(([other, kinds]) => ({ other, kinds }))
		.sort((a, b) => a.other.localeCompare(b.other));
}

export function countRemovable(tag: string, store: RelationStore): number {
	return removableRelations(tag, store).reduce(
		(total, relation) => total + relation.kinds.length,
		0
	);
}

/**
 * Drop every removable tie between `tag` and `other` — both the horizontal
 * link and any containment, in either direction. Removing "the relation"
 * between two tags should leave nothing behind that still joins them, or the
 * action would only half-work in the case where both exist.
 */
export function withoutRelation(
	tag: string,
	other: string,
	store: RelationStore
): RelationStore {
	return {
		manualLinks: store.manualLinks.filter(
			(link) => !samePair(link.a, link.b, tag, other)
		),
		groupLinks: store.groupLinks.filter(
			(link) => !samePair(link.parent, link.child, tag, other)
		),
	};
}

/** Drop every removable relation touching `tag`, in either role. */
export function withoutAllRelations(
	tag: string,
	store: RelationStore
): RelationStore {
	return {
		manualLinks: store.manualLinks.filter(
			(link) => link.a !== tag && link.b !== tag
		),
		groupLinks: store.groupLinks.filter(
			(link) => link.parent !== tag && link.child !== tag
		),
	};
}

/** Drop only the membership that puts `tag` inside `parent`. */
export function withoutMembership(
	tag: string,
	parent: string,
	store: RelationStore
): RelationStore {
	return {
		manualLinks: store.manualLinks,
		groupLinks: store.groupLinks.filter(
			(link) => !(link.parent === parent && link.child === tag)
		),
	};
}
