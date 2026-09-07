import { TagGraph } from "./graph";
import { TagGroups } from "./groups";
import { SelectMode } from "./types";

/**
 * Every tag action the plugin offers, defined once.
 *
 * The context menu, the button bar and the icon-customisation settings all
 * read this list rather than each maintaining their own. That is deliberate:
 * three hand-written copies of "what can you do to a tag" drift apart within
 * a release or two, and an action reachable from one surface but not another
 * is exactly the sort of gap that is invisible until someone goes looking.
 */

export type ActionGroup = "selection" | "notes" | "groups" | "links" | "edit";

export const ACTION_GROUP_LABELS: Record<ActionGroup, string> = {
	selection: "Selection",
	notes: "Notes",
	groups: "Grouping",
	links: "Links",
	edit: "Editing",
};

export const ACTION_GROUP_ORDER: ActionGroup[] = [
	"selection",
	"notes",
	"groups",
	"links",
	"edit",
];

/**
 * What an action is allowed to reach. Narrow on purpose — an action that
 * needs something outside this is a prompt to reconsider whether it belongs
 * here, the same reasoning as the ViewHost contract (ADR 0003).
 */
export interface ActionHost {
	graph: TagGraph;
	groups: TagGroups;
	selection: string[];

	isSelected(tag: string): boolean;
	isPinned(tag: string): boolean;
	/** How many of this tag's relations could actually be removed. */
	removableRelationCount(tag: string): number;

	select(tag: string, mode: SelectMode): void;
	clearSelection(): void;
	togglePin(tag: string): void;

	openTagSearch(tag: string): void;
	showNotes(): void;
	createNote(): void;

	promptAddToGroup(tag: string): void;
	promptPutInsideGroup(tag: string): void;
	promptTakeOutOfGroup(tag: string): void;

	promptHorizontalLink(tag: string): void;
	promptRemoveRelation(tag: string): void;
	promptRemoveAllRelations(tag: string): void;

	promptRename(tag: string): void;
	promptAssignTagToNotesOf(tag: string): void;
	promptRemoveTagFromNotes(tag: string): void;
	copyTag(tag: string): void;
}

export interface ActionContext {
	/** The tag being acted on: right-clicked in a menu, or the primary selection in the bar. */
	tag: string | null;
	host: ActionHost;
}

export interface TagAction {
	id: string;
	group: ActionGroup;
	/** Lucide icon name, overridable per action in settings. */
	defaultIcon: string;
	/** Label may depend on state — "Pin" versus "Unpin". */
	label(ctx: ActionContext): string;
	/** False greys the button out and hides the menu entry. */
	isEnabled(ctx: ActionContext): boolean;
	/** Marks destructive actions so surfaces can warn rather than blend in. */
	destructive?: boolean;
	run(ctx: ActionContext): void;
}

/** Most actions need a tag; this is the common guard. */
function hasTag(ctx: ActionContext): boolean {
	return ctx.tag !== null;
}

export const TAG_ACTIONS: TagAction[] = [
	// --- selection ---
	{
		id: "select-only",
		group: "selection",
		defaultIcon: "crosshair",
		label: (ctx) =>
			ctx.tag && ctx.host.isSelected(ctx.tag)
				? "Select only this tag"
				: "Select this tag",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.select(ctx.tag, "replace"),
	},
	{
		id: "select-toggle",
		group: "selection",
		defaultIcon: "plus-circle",
		label: (ctx) =>
			ctx.tag && ctx.host.isSelected(ctx.tag)
				? "Remove from selection"
				: "Add to selection",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.select(ctx.tag, "toggle"),
	},
	{
		id: "clear-selection",
		group: "selection",
		defaultIcon: "x-circle",
		label: () => "Clear selection",
		isEnabled: (ctx) => ctx.host.selection.length > 0,
		run: (ctx) => ctx.host.clearSelection(),
	},
	{
		id: "pin",
		group: "selection",
		defaultIcon: "pin",
		label: (ctx) =>
			ctx.tag && ctx.host.isPinned(ctx.tag) ? "Unpin" : "Pin to the top",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.togglePin(ctx.tag),
	},

	// --- notes ---
	{
		id: "search-notes",
		group: "notes",
		defaultIcon: "search",
		label: () => "Search notes with this tag",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.openTagSearch(ctx.tag),
	},
	{
		id: "show-notes",
		group: "notes",
		defaultIcon: "files",
		label: () => "Show notes for the selection",
		isEnabled: (ctx) => ctx.host.selection.length > 0,
		run: (ctx) => ctx.host.showNotes(),
	},
	{
		id: "new-note",
		group: "notes",
		defaultIcon: "file-plus",
		label: () => "Create a new note",
		isEnabled: () => true,
		run: (ctx) => ctx.host.createNote(),
	},
	{
		id: "add-tag-to-notes",
		group: "notes",
		defaultIcon: "tag",
		label: () => "Add another tag to these notes…",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.promptAssignTagToNotesOf(ctx.tag),
	},
	{
		id: "remove-tag-from-notes",
		group: "notes",
		defaultIcon: "trash-2",
		label: () => "Remove this tag from all notes…",
		destructive: true,
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.promptRemoveTagFromNotes(ctx.tag),
	},

	// --- grouping ---
	{
		id: "make-main-tag",
		group: "groups",
		defaultIcon: "folder-plus",
		label: () => "Make this a main-tag for…",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.promptAddToGroup(ctx.tag),
	},
	{
		id: "put-inside",
		group: "groups",
		defaultIcon: "corner-right-up",
		label: () => "Put this tag inside…",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.promptPutInsideGroup(ctx.tag),
	},
	{
		id: "take-out",
		group: "groups",
		defaultIcon: "folder-minus",
		label: () => "Take out of a main-tag…",
		isEnabled: (ctx) =>
			ctx.tag !== null && ctx.host.groups.parentsOf(ctx.tag).length > 0,
		run: (ctx) => ctx.tag && ctx.host.promptTakeOutOfGroup(ctx.tag),
	},

	// --- links and relations ---
	{
		id: "horizontal-link",
		group: "links",
		defaultIcon: "link",
		label: () => "Horizontal link to another tag…",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.promptHorizontalLink(ctx.tag),
	},
	{
		id: "remove-relation",
		group: "links",
		defaultIcon: "unlink",
		label: () => "Remove this relation…",
		destructive: true,
		isEnabled: (ctx) =>
			ctx.tag !== null && ctx.host.removableRelationCount(ctx.tag) > 0,
		run: (ctx) => ctx.tag && ctx.host.promptRemoveRelation(ctx.tag),
	},
	{
		id: "remove-all-relations",
		group: "links",
		defaultIcon: "scissors",
		label: () => "Remove all relations…",
		destructive: true,
		isEnabled: (ctx) =>
			ctx.tag !== null && ctx.host.removableRelationCount(ctx.tag) > 0,
		run: (ctx) => ctx.tag && ctx.host.promptRemoveAllRelations(ctx.tag),
	},

	// --- editing ---
	{
		id: "rename",
		group: "edit",
		defaultIcon: "pencil",
		label: () => "Rename tag…",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.promptRename(ctx.tag),
	},
	{
		id: "copy",
		group: "edit",
		defaultIcon: "copy",
		label: () => "Copy tag",
		isEnabled: hasTag,
		run: (ctx) => ctx.tag && ctx.host.copyTag(ctx.tag),
	},
];

export function actionById(id: string): TagAction | undefined {
	return TAG_ACTIONS.find((action) => action.id === id);
}

/** The icon to draw: the user's override if set, otherwise the default. */
export function iconFor(
	action: TagAction,
	overrides: Record<string, string>
): string {
	const custom = overrides[action.id]?.trim();
	return custom && custom.length > 0 ? custom : action.defaultIcon;
}

/** Actions in one group, in declaration order. */
export function actionsInGroup(group: ActionGroup): TagAction[] {
	return TAG_ACTIONS.filter((action) => action.group === group);
}
