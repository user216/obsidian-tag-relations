import { App } from "obsidian";
import { TagGraph } from "./graph";
import { TagRelationsSettings } from "./settings";
import { TagGroups } from "./groups";
import { levelCss } from "./levels";
import { LevelStyles, SelectMode, SortMode, TagLevel } from "./types";

/**
 * What each mode renderer is allowed to see and do. Keeping this narrow lets
 * the cloud / map / tree renderers stay independent of the view shell.
 */
export interface ViewHost {
	app: App;
	graph: TagGraph;
	settings: TagRelationsSettings;
	/** Currently selected tags, in the order they were picked. Empty when nothing is selected. */
	selection: string[];
	/** Text typed into the filter box, lower-cased. */
	filter: string;
	sort: SortMode;

	/** Tags passing the current text filter, in the current sort order. */
	visibleTags(): string[];

	isSelected(tag: string): boolean;
	/** True when `tag` is related to at least one selected tag. */
	isRelatedToSelection(tag: string): boolean;
	/** Strongest relation from `tag` to the selection; 0 when unrelated. */
	selectionStrength(tag: string): number;

	select(tag: string, mode: SelectMode): void;
	/**
	 * Apply a click to the selection, reading modifier keys (and the sticky
	 * multi-select setting) to decide between replace and toggle. Renderers
	 * use this rather than deciding the modifier convention themselves.
	 */
	selectFromEvent(tag: string, event: MouseEvent | PointerEvent): void;
	clearSelection(): void;

	/** True when edit mode is on — renderers show inline rename affordances. */
	editMode: boolean;

	/** Group membership, and the visual treatment of the three tag levels. */
	groups: TagGroups;
	levelOf(tag: string): TagLevel;
	levelStyles: LevelStyles;

	isPinned(tag: string): boolean;
	togglePin(tag: string): void;

	isGroupCollapsed(tag: string): boolean;
	toggleGroupCollapsed(tag: string): void;
	/** Ask the user which tag to put inside `parent`. */
	promptAddToGroup(parent: string): void;
	removeFromGroup(parent: string, child: string): void;
	/** Open the full rename dialog, with its preview of what will change. */
	promptRename(tag: string): void;
	/** Commit an inline rename typed directly into a view. */
	renameInline(tag: string, next: string): void;

	/** Open the tag context menu at the given mouse position. */
	openContextMenu(tag: string, event: MouseEvent): void;
	openTagSearch(tag: string): void;
	/** Ask the shell to re-render the active mode plus the inspector. */
	requestRender(): void;
	/** Report a pan-zoom scale change so it can be persisted. */
	onZoomChanged(scale: number): void;
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

/** A modifier-click always means "add/remove", regardless of sticky mode. */
export function hasToggleModifier(event: MouseEvent | PointerEvent): boolean {
	return event.ctrlKey || event.metaKey || event.shiftKey;
}

/** Apply a level's font scale, shadow and colour to a rendered tag. */
export function applyLevelStyle(
	el: HTMLElement,
	level: TagLevel,
	styles: LevelStyles
): void {
	const css = levelCss(styles[level]);
	el.style.setProperty("--tr-level-scale", String(css.fontScale));
	el.style.textShadow = css.textShadow;
	// An empty colour means "inherit the theme", which is the default for
	// plain tags so they keep looking like the rest of Obsidian.
	el.style.color = css.color;
	el.dataset.level = level;
}
