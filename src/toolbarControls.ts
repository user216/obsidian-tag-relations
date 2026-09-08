/**
 * The toolbar's built-in controls — the parts that are not tag actions.
 *
 * Tag actions already have placement and ordering (`actionLayout.ts`); these
 * are the view controls that sit alongside them: the mode switcher, the
 * filter box, the sort dropdown and the various toggles. Each can be hidden,
 * because a toolbar carrying every control at once leaves little room for the
 * buttons someone actually reaches for.
 *
 * Nothing here can be made unrecoverable by hiding it: every control has an
 * equivalent in settings or the command palette, and this list itself is
 * always reachable from settings.
 */
export interface ToolbarControl {
	id: ToolbarControlId;
	label: string;
	/** What is lost by hiding it, and where the equivalent lives. */
	description: string;
}

export type ToolbarControlId =
	| "modes"
	| "search"
	| "tagFind"
	| "sort"
	| "editMode"
	| "stickySelect"
	| "notes"
	| "actionBarToggle"
	| "viewOptions"
	| "inspectorToggle"
	| "refresh"
	| "zen"
	| "fontZoom"
	| "plexDepth"
	| "plexPreview"
	| "plexPreviewLines";

export const TOOLBAR_CONTROLS: ToolbarControl[] = [
	{
		id: "modes",
		label: "View switcher",
		description:
			"Cloud, mind-map, tree and groups. Hiding it leaves the view fixed to whichever was last used.",
	},
	{
		id: "search",
		label: "Filter box",
		description: "Narrows every view to matching tags as you type.",
	},
	{
		id: "tagFind",
		label: "Find a tag box",
		description:
			"Jumps straight to a tag without narrowing anything, unlike the filter beside it. Also the “Focus a tag” command.",
	},
	{
		id: "sort",
		label: "Sort dropdown",
		description: "Also available per-view; the chosen sort still applies when hidden.",
	},
	{
		id: "editMode",
		label: "Edit mode toggle",
		description:
			"Shows inline rename controls on tags. Also in Settings → Editing.",
	},
	{
		id: "stickySelect",
		label: "Sticky multi-select toggle",
		description:
			"Makes every click add to the selection. Ctrl/Cmd or Shift click does this anyway.",
	},
	{
		id: "notes",
		label: "Match mode and Show notes",
		description:
			"The All/Any dropdown and the Show notes button. Both remain available as actions.",
	},
	{
		id: "actionBarToggle",
		label: "Action bar toggle",
		description: "Shows or hides the button row. Also in Settings → Buttons.",
	},
	{
		id: "viewOptions",
		label: "View options menu",
		description:
			"Per-view switches such as layout and level filters. Their defaults live in settings.",
	},
	{
		id: "inspectorToggle",
		label: "Side panel toggle",
		description: "Shows or hides the panel of pinned tags, bookmarks and groups.",
	},
	{
		id: "plexDepth",
		label: "Plex depth button",
		description:
			"Chooses how far the plex reaches around the active tag. Only appears in the plex view; the same choice is in Settings → Views.",
	},
	{
		id: "plexPreview",
		label: "Plex note preview button",
		description:
			"Shows or hides the list of notes under the plex. Only appears in the plex view; also a command and a switch in Settings → Views.",
	},
	{
		id: "plexPreviewLines",
		label: "Plex preview length buttons",
		description:
			"Name only, 3, 5 or 10 opening lines of each previewed note. Only appears in the plex view; any exact count can be set in Settings → Views.",
	},
	{
		id: "fontZoom",
		label: "Font zoom buttons",
		description:
			"Makes the tags larger or smaller, reflowing the layout. Separate from the cloud's pan-and-zoom, which magnifies without reflowing. Also available as commands.",
	},
	{
		id: "zen",
		label: "Zen mode button",
		description:
			"Enters zen mode. Hiding it leaves the command and, once inside, the floating exit button — zen mode can always be left.",
	},
	{
		id: "refresh",
		label: "Rescan button",
		description:
			"Rebuilds the graph from the vault. Also a command, and it rebuilds automatically anyway.",
	},
];

/** Controls are shown unless explicitly turned off. */
export function isControlVisible(
	id: ToolbarControlId,
	hidden: Record<string, boolean>
): boolean {
	return hidden[id] !== true;
}

export function visibleControls(
	hidden: Record<string, boolean>
): ToolbarControl[] {
	return TOOLBAR_CONTROLS.filter((control) =>
		isControlVisible(control.id, hidden)
	);
}
