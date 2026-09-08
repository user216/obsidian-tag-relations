import { TagAction } from "./actions";

/**
 * Where each action's button appears, and in what order.
 *
 * Both surfaces read one shared order rather than keeping their own. Two
 * independent orderings would be more expressive and much harder to hold in
 * your head — "why is Rename third here and seventh there" is a question
 * nobody should have to answer.
 */
export type ActionPlacement = "hidden" | "bar" | "toolbar" | "both";

export const PLACEMENT_LABELS: Record<ActionPlacement, string> = {
	// Not "Hidden": the right-click menu is controlled separately, so an
	// action with no button is not thereby out of reach.
	hidden: "No button",
	bar: "Action bar",
	toolbar: "Toolbar",
	both: "Both",
};

export type ActionSurface = "bar" | "toolbar";

/**
 * Defaults chosen to reproduce the layout that existed before any of this was
 * configurable: these two were hard-coded toolbar buttons, everything else
 * lived on the action bar.
 */
export const DEFAULT_PLACEMENTS: Record<string, ActionPlacement> = {
	"new-note": "toolbar",
	"clear-selection": "toolbar",
	// This one already has a dedicated toolbar button that knows to appear
	// only in the plex; a second, mode-blind copy on the bar by default would
	// be two controls for one switch.
	"toggle-plex-preview": "hidden",
};

export function placementOf(
	id: string,
	placements: Record<string, ActionPlacement>
): ActionPlacement {
	return placements[id] ?? DEFAULT_PLACEMENTS[id] ?? "bar";
}

export function isOn(
	placement: ActionPlacement,
	surface: ActionSurface
): boolean {
	if (placement === "both") return true;
	return placement === surface;
}

/**
 * Actions in the configured order. Anything the stored order does not mention
 * keeps its registry position at the end, so an action added by a later
 * version appears rather than silently vanishing from a saved layout.
 */
export function orderedActions(
	actions: TagAction[],
	order: string[]
): TagAction[] {
	const rank = new Map<string, number>();
	order.forEach((id, index) => rank.set(id, index));
	return actions
		.map((action, index) => ({ action, index }))
		.sort((a, b) => {
			const ra = rank.get(a.action.id);
			const rb = rank.get(b.action.id);
			if (ra !== undefined && rb !== undefined) return ra - rb;
			// Unknown ids sort after known ones, keeping registry order.
			if (ra !== undefined) return -1;
			if (rb !== undefined) return 1;
			return a.index - b.index;
		})
		.map((entry) => entry.action);
}

export function actionsForSurface(
	surface: ActionSurface,
	actions: TagAction[],
	order: string[],
	placements: Record<string, ActionPlacement>
): TagAction[] {
	return orderedActions(actions, order).filter((action) =>
		isOn(placementOf(action.id, placements), surface)
	);
}

/**
 * Move one action up or down. `allIds` supplies the full list in current
 * order, so a stored order that is partial or empty still moves sensibly
 * rather than needing to be materialised first by the caller.
 */
/**
 * Whether an action offers a line in the right-click menu.
 *
 * The menu is kept as its own on/off map rather than becoming a fourth value
 * of `ActionPlacement`. Three surfaces would need eight placement values to
 * express every combination, which is a dropdown nobody can read; and the menu
 * is a different sort of surface anyway — a list of labelled lines, where the
 * only meaningful controls are whether a line is there and where it sits.
 * Order is still shared with the buttons, for the reason above: one order
 * means an action keeps its relative place wherever it appears.
 *
 * Lines are shown unless explicitly turned off, so a menu entry added by a
 * later version appears rather than needing to be found and enabled.
 */
export function isInMenu(id: string, hidden: Record<string, boolean>): boolean {
	return hidden[id] !== true;
}

/** The menu's lines, in the shared order. */
export function menuActions(
	actions: TagAction[],
	order: string[],
	hidden: Record<string, boolean>
): TagAction[] {
	return orderedActions(actions, order).filter((action) =>
		isInMenu(action.id, hidden)
	);
}

export function moveInOrder(
	allIds: string[],
	id: string,
	delta: number
): string[] {
	const next = allIds.slice();
	const from = next.indexOf(id);
	if (from < 0) return next;
	const to = from + delta;
	if (to < 0 || to >= next.length) return next;
	next.splice(to, 0, next.splice(from, 1)[0]);
	return next;
}
