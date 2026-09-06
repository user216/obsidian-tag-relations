import { NoteMatchMode, SelectMode, SortMode } from "./types";

/**
 * Selection, filtering, sorting and snapshot-staleness rules, kept free of the
 * DOM so they can be reasoned about (and tested) on their own. The view shell
 * owns the state; these functions decide what it should become.
 */

/**
 * The selection after clicking `tag`.
 *
 * "toggle" adds or removes it. "replace" narrows to just that tag — except
 * when it is already the only selected tag, where a second click clears the
 * selection instead of pointlessly reselecting it.
 */
export function applySelection(
	current: string[],
	tag: string,
	mode: SelectMode
): string[] {
	if (mode === "toggle") {
		const index = current.indexOf(tag);
		if (index >= 0) {
			const next = current.slice();
			next.splice(index, 1);
			return next;
		}
		return current.concat(tag);
	}
	const isOnlySelection = current.length === 1 && current[0] === tag;
	return isOnlySelection ? [] : [tag];
}

/**
 * Tags matching the filter text. Selected tags always survive filtering, so
 * narrowing the view never silently hides what you are working with.
 */
export function filterTags(
	tags: string[],
	filter: string,
	isSelected: (tag: string) => boolean
): string[] {
	if (!filter) return tags.slice();
	return tags.filter(
		(tag) => tag.toLowerCase().includes(filter) || isSelected(tag)
	);
}

export interface SortContext {
	countOf(tag: string): number;
	/** Strongest relation from `tag` to the current selection; 0 if unrelated. */
	strengthTo(tag: string): number;
	isSelected(tag: string): boolean;
	hasSelection: boolean;
}

export function sortTags(
	tags: string[],
	sort: SortMode,
	ctx: SortContext
): string[] {
	const sorted = tags.slice();
	switch (sort) {
		case "name-desc":
			sorted.sort((a, b) => b.localeCompare(a));
			break;
		case "count-desc":
			sorted.sort(
				(a, b) => ctx.countOf(b) - ctx.countOf(a) || a.localeCompare(b)
			);
			break;
		case "count-asc":
			sorted.sort(
				(a, b) => ctx.countOf(a) - ctx.countOf(b) || a.localeCompare(b)
			);
			break;
		case "relatedness":
			if (!ctx.hasSelection) {
				sorted.sort((a, b) => a.localeCompare(b));
				break;
			}
			sorted.sort((a, b) => {
				// Selected tags head the list, then everything else by how
				// strongly it ties to the selection.
				const aSel = ctx.isSelected(a);
				const bSel = ctx.isSelected(b);
				if (aSel !== bSel) return aSel ? -1 : 1;
				return ctx.strengthTo(b) - ctx.strengthTo(a) || a.localeCompare(b);
			});
			break;
		default:
			sorted.sort((a, b) => a.localeCompare(b));
	}
	return sorted;
}

export interface SnapshotIdentity {
	tags: string[];
	mode: NoteMatchMode;
}

/**
 * Whether a frozen notes list no longer reflects the current state. `dirty` is
 * set when the vault changed underneath it; the rest compares what the
 * snapshot was taken for against what is selected now, order-insensitively.
 */
export function isSnapshotStale(
	snapshot: SnapshotIdentity | null,
	selection: string[],
	mode: NoteMatchMode,
	dirty: boolean
): boolean {
	if (!snapshot) return false;
	if (dirty) return true;
	if (snapshot.mode !== mode) return true;
	if (snapshot.tags.length !== selection.length) return true;
	const current = selection.slice().sort();
	const taken = snapshot.tags.slice().sort();
	return current.some((tag, index) => tag !== taken[index]);
}
