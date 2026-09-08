import { App, setIcon, setTooltip } from "obsidian";
import { TagEdge, tagLabel } from "./graph";
import { TagGraph } from "./graph";
import { TagRelationsSettings } from "./settings";
import { TagGroups } from "./groups";
import { levelCss } from "./levels";
import { clampFontScale } from "./fontZoom";
import { LevelStyles, SelectMode, SortMode, TagLevel } from "./types";
import { BandId } from "./bands";

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
	isBookmarked(tag: string): boolean;
	/** Every bookmarked tag, for splitting a list into bands. */
	bookmarkedTags(): string[];
	togglePin(tag: string): void;
	toggleBookmark(tag: string): void;

	isGroupCollapsed(tag: string): boolean;
	toggleGroupCollapsed(tag: string): void;
	/** Whether a band heading is folded shut, hiding its tags. */
	isBandCollapsed(id: BandId): boolean;
	toggleBandCollapsed(id: BandId): void;
	/** Ask the user which tag to put inside `parent`. */
	promptAddToGroup(parent: string): void;
	/** Ask the user which main-tag/sub-tag should contain `child`. */
	promptPutInsideGroup(child: string): void;
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

export interface PillSizeOptions {
	count: number;
	maxCount: number;
	/** The cloud's configured size range, in pixels. */
	minSize: number;
	maxSize: number;
	/** The level's own multiplier, from `levelCss`. */
	levelScale: number;
	/** The font zoom multiplier. */
	fontScale: number;
}

/**
 * The type size for a tag pill, in pixels.
 *
 * All three factors are combined here rather than split between code and CSS.
 * The count-based size has to be an inline style — it differs per tag — and an
 * inline `font-size` beats any stylesheet rule, so a `--tr-level-scale` applied
 * in CSS could never actually reach a pill. Doing the multiplication in one
 * place also keeps the cloud and groups views from drifting apart.
 */
export function pillFontSize(options: PillSizeOptions): number {
	const base =
		options.minSize +
		(options.maxSize - options.minSize) *
			scaleByCount(options.count, options.maxCount);
	const size = base * options.levelScale * clampFontScale(options.fontScale);
	// A stored range or level style could be anything; never return a size a
	// browser would reject or a person could not read.
	if (!Number.isFinite(size)) return options.minSize;
	return Math.max(1, size);
}

export interface BandHeaderOptions {
	/** The view's own class for the heading, so each keeps its look. */
	cls: string;
	label: string;
	count: number;
	collapsed: boolean;
	onToggle: () => void;
}

/**
 * A band heading with a fold twisty — the one place that draws one.
 *
 * Collapsing is deliberately allowed to hide tags, which every other feature
 * here refuses to do, because here the affordance is the point: the heading
 * stays put with its count, the twisty says which way it goes, and one click
 * brings the tags back. A count that reads "Pinned (12)" with nothing under it
 * is a fold, not a disappearance.
 */
export function renderBandHeader(
	parent: HTMLElement,
	options: BandHeaderOptions
): HTMLElement {
	const header = parent.createDiv({ cls: `tr-band-head ${options.cls}` });
	header.toggleClass("is-collapsed", options.collapsed);

	const twisty = header.createSpan({ cls: "tr-twisty tr-band-twisty" });
	setIcon(twisty, "chevron-right");
	twisty.toggleClass("is-open", !options.collapsed);

	header.createSpan({
		cls: "tr-band-head-text",
		text: `${options.label} (${options.count})`,
	});
	setTooltip(
		header,
		options.collapsed
			? `Show the ${options.count} tag${options.count === 1 ? "" : "s"}`
			: "Fold this band away",
		{ placement: "top" }
	);
	header.addEventListener("click", (event) => {
		event.stopPropagation();
		options.onToggle();
	});
	return header;
}

/** A modifier-click always means "add/remove", regardless of sticky mode. */
export function hasToggleModifier(event: MouseEvent | PointerEvent): boolean {
	return event.ctrlKey || event.metaKey || event.shiftKey;
}

/**
 * Shared inline-rename field: an input that replaces a tag's label in place.
 * Enter commits (through the host, which still previews and confirms the
 * rewrite); Escape or losing focus cancels. Used by every view offering
 * inline rename, so the keyboard and blur behaviour never drifts between them.
 */
export function attachRenameInput(
	container: HTMLElement,
	tag: string,
	onCommit: (next: string) => void,
	onCancel: () => void
): void {
	const input = container.createEl("input", {
		cls: "tr-inline-input",
		type: "text",
	});
	input.value = tagLabel(tag);

	let settled = false;
	const cancel = () => {
		if (settled) return;
		settled = true;
		onCancel();
	};
	const commit = () => {
		if (settled) return;
		settled = true;
		const next = input.value.trim();
		if (next.length > 0 && next !== tagLabel(tag)) onCommit(next);
		else onCancel();
	};

	input.addEventListener("click", (event) => event.stopPropagation());
	input.addEventListener("keydown", (event) => {
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			commit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancel();
		}
	});
	input.addEventListener("blur", cancel);
	window.setTimeout(() => {
		input.focus();
		input.select();
	}, 0);
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

/**
 * How to describe an edge to someone looking from `viewpoint` toward `other`
 * — the single place that decides between "this contains/is inside that",
 * "horizontally linked", and "N% related", so the priority (group beats
 * manual beats plain relatedness) can never drift between renderers again.
 * `strength` is passed in rather than read off the edge because callers
 * already have it (often the *strongest* tie across a multi-tag selection,
 * which need not be `edge.weight` when `edge` is just the closest match).
 */
export interface RelationDescription {
	kind: "group-contains" | "group-inside" | "manual" | "relation";
	/** A short word or two, for a compact label. */
	short: string;
	/** A full sentence, for a tooltip. */
	long: string;
}

export function describeRelation(
	edge: TagEdge | undefined,
	viewpoint: string,
	other: string,
	strength: number
): RelationDescription {
	const otherLabel = tagLabel(other);
	if (edge?.parent !== undefined) {
		if (edge.parent === viewpoint) {
			return {
				kind: "group-contains",
				short: "contains",
				long: `Contains ${otherLabel}`,
			};
		}
		return {
			kind: "group-inside",
			short: "inside",
			long: `Inside ${otherLabel}`,
		};
	}
	if (edge?.manual) {
		return {
			kind: "manual",
			short: "manual",
			long: `Horizontal link to ${otherLabel}${edge.label ? ` — ${edge.label}` : ""}`,
		};
	}
	const pct = Math.round(strength * 100);
	return {
		kind: "relation",
		// Compact form still carries the evidence (shared-note count), not
		// just the percentage — matching what the fuller sentence says.
		short: edge ? `${pct}% · ${edge.cooccur}` : `${pct}%`,
		long: edge
			? `${pct}% related to ${otherLabel} · ${edge.cooccur} shared note${
					edge.cooccur === 1 ? "" : "s"
			  }`
			: `${pct}% related to ${otherLabel}`,
	};
}
