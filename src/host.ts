import { App } from "obsidian";
import { TagGraph } from "./graph";
import { TagRelationsSettings } from "./settings";
import { SortMode } from "./types";

/**
 * What each mode renderer is allowed to see and do. Keeping this narrow lets
 * the cloud / map / tree renderers stay independent of the view shell.
 */
export interface ViewHost {
	app: App;
	graph: TagGraph;
	settings: TagRelationsSettings;
	/** Currently focused tag, or null when nothing is selected. */
	selected: string | null;
	/** Text typed into the filter box, lower-cased. */
	filter: string;
	sort: SortMode;

	/** Tags passing the current text filter, in the current sort order. */
	visibleTags(): string[];
	select(tag: string | null): void;
	/** Open the tag context menu at the given mouse position. */
	openContextMenu(tag: string, event: MouseEvent): void;
	openTagSearch(tag: string): void;
	/** Ask the shell to re-render the active mode plus the inspector. */
	requestRender(): void;
}

export interface ModeRenderer {
	render(): void;
	destroy(): void;
}

/** Maps a note count onto a 0..1 scale, compressed so huge tags don't dominate. */
export function scaleByCount(count: number, maxCount: number): number {
	if (maxCount <= 1) return count > 0 ? 1 : 0;
	return Math.log(count + 1) / Math.log(maxCount + 1);
}
