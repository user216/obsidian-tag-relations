import { setIcon, setTooltip } from "obsidian";
import {
	ModeRenderer,
	ViewHost,
	applyLevelStyle,
	describeRelation,
	scaleByCount,
} from "./host";
import { tagLabel } from "./graph";
import { PanZoom } from "./panzoom";
import {
	DetailsColumn,
	DETAILS_COLUMNS,
	orderedLevels,
	separatesLevels,
	sortDetailsRows,
	visibleLevels,
} from "./levels";
import { LEVEL_LABELS, TagLevel } from "./types";
import { splitIntoBands } from "./bands";

interface PillRect {
	left: number;
	top: number;
}

/**
 * The tag cloud, in three layouts borrowed from a file browser: icons (the
 * classic weighted cloud), list (one per line) and details (a table).
 *
 * Whatever the layout, the same behaviour applies: pinned tags are held at the
 * top, selecting a tag highlights what it relates to, and in the icons layout
 * the cloud re-groups with a FLIP animation so tags visibly travel to their
 * new position rather than the layout snapping.
 */
export class CloudRenderer implements ModeRenderer {
	private container: HTMLElement;
	private panzoom: PanZoom;
	private host: ViewHost;
	private pills = new Map<string, HTMLElement>();
	/** Tag currently being renamed in place, if any. */
	private renaming: string | null = null;

	/**
	 * Column sort for the details layout, independent of the toolbar's Sort
	 * dropdown — this is the file-browser convention of clicking a column
	 * header, not the plugin's relation-aware sort.
	 */
	private detailsSort: { column: DetailsColumn; ascending: boolean } = {
		column: "name",
		ascending: true,
	};

	constructor(container: HTMLElement, host: ViewHost) {
		this.host = host;
		this.container = container.createDiv({ cls: "tr-cloud-root" });
		this.panzoom = new PanZoom(this.container, {
			onChange: (state) => host.onZoomChanged(state.scale),
		});
		this.panzoom.restoreScale(host.settings.cloudZoom);

		this.panzoom.content.addEventListener("click", (event) => {
			// A click on empty space clears, unless it ended a pan gesture.
			if (this.panzoom.didPan) return;
			if (event.target === this.panzoom.content) this.host.clearSelection();
		});
	}

	destroy(): void {
		this.pills.clear();
		this.panzoom.destroy();
		this.container.remove();
	}

	render(): void {
		const { host } = this;
		const layout = host.settings.cloudLayout;
		const animate = host.settings.animateRegroup && layout === "icons";
		const before = animate ? this.measure() : null;

		const tags = this.visible();
		const body = this.panzoom.content;
		this.pruneRemovedPills(tags);
		body.empty();
		body.dataset.layout = layout;

		if (tags.length === 0) {
			body.createDiv({
				cls: "tr-empty",
				text: host.filter
					? "No tags match this filter."
					: "No tags found in this vault yet.",
			});
			return;
		}

		const pinned = tags.filter((tag) => host.isPinned(tag));
		const rest = tags.filter((tag) => !host.isPinned(tag));

		if (layout === "details") {
			this.renderDetails(body, pinned, rest);
		} else {
			// The flow layouts band the whole list themselves, so they get it
			// intact rather than pre-split.
			this.renderFlow(body, [], tags, layout === "list");
		}

		if (before) this.flip(before);
	}

	/** Tags passing the filter, the sort, and the level filter. */
	private visible(): string[] {
		const levels = visibleLevels(this.host.settings.levelFilter);
		return this.host
			.visibleTags()
			.filter((tag) => levels.has(this.host.levelOf(tag)));
	}

	// --- Icons and list layouts ------------------------------------------

	private renderFlow(
		body: HTMLElement,
		pinned: string[],
		rest: string[],
		compact: boolean
	): void {
		const { host } = this;
		const field = body.createDiv({
			cls: compact ? "tr-cloud tr-cloud-list" : "tr-cloud",
		});

		// Pinned and bookmarked come out first, whatever else the cloud is
		// doing with the remainder. Previously the selection regrouping and
		// the level bands each returned early, so selecting anything made the
		// pinned band disappear — which defeats the point of a pin.
		const bands = splitIntoBands(rest, {
			pinned: host.settings.pinnedTags,
			bookmarked: host.bookmarkedTags(),
			showPinned: host.settings.showPinnedBand,
			showBookmarked: host.settings.showBookmarkedBand,
			bookmarkedPosition: host.settings.bookmarkedBandPosition,
		});
		const banded = (id: string) => bands.find((band) => band.id === id);
		const pinnedBand = banded("pinned");
		const bookmarkedBand = banded("bookmarked");
		const remainder = banded("rest")?.tags ?? [];
		const bookmarksOnTop = host.settings.bookmarkedBandPosition === "top";

		if (pinnedBand) {
			this.appendGroup(field, `Pinned (${pinnedBand.tags.length})`, pinnedBand.tags);
		}
		if (bookmarkedBand && bookmarksOnTop) {
			this.appendGroup(
				field,
				`Bookmarked (${bookmarkedBand.tags.length})`,
				bookmarkedBand.tags
			);
		}

		this.renderRemainder(field, remainder, pinnedBand !== undefined || bookmarkedBand !== undefined);

		if (bookmarkedBand && !bookmarksOnTop) {
			this.appendGroup(
				field,
				`Bookmarked (${bookmarkedBand.tags.length})`,
				bookmarkedBand.tags
			);
		}
	}

	/** Everything that is neither pinned nor bookmarked, grouped as usual. */
	private renderRemainder(
		field: HTMLElement,
		rest: string[],
		bandsAbove: boolean
	): void {
		const { host } = this;
		if (rest.length === 0) return;

		const grouped =
			host.selection.length > 0 &&
			host.settings.regroupOnSelect &&
			rest.length > 1;

		if (grouped) {
			const selected: string[] = [];
			const related: string[] = [];
			const unrelated: string[] = [];
			for (const tag of rest) {
				if (host.isSelected(tag)) selected.push(tag);
				else if (host.isRelatedToSelection(tag)) related.push(tag);
				else unrelated.push(tag);
			}
			related.sort(
				(a, b) =>
					host.selectionStrength(b) - host.selectionStrength(a) ||
					a.localeCompare(b)
			);
			this.appendGroup(
				field,
				selected.length > 1 ? `Selected (${selected.length})` : "Selected",
				selected
			);
			this.appendGroup(field, `Related (${related.length})`, related);
			if (unrelated.length > 0) {
				this.appendGroup(field, `Unrelated (${unrelated.length})`, unrelated);
			}
			return;
		}

		if (separatesLevels(host.settings.levelFilter)) {
			for (const level of orderedLevels(host.settings.levelFilter)) {
				const band = rest.filter((tag) => host.levelOf(tag) === level);
				if (band.length > 0) {
					this.appendGroup(field, `${LEVEL_LABELS[level]}s (${band.length})`, band);
				}
			}
			return;
		}

		// A heading only when something is above it to distinguish it from.
		if (bandsAbove) {
			this.appendGroup(field, `Other tags (${rest.length})`, rest);
			return;
		}
		for (const tag of rest) field.appendChild(this.pillFor(tag));
	}

	private appendGroup(
		field: HTMLElement,
		label: string,
		tags: string[]
	): void {
		if (tags.length === 0) return;
		field.createDiv({ cls: "tr-cloud-group", text: label });
		for (const tag of tags) field.appendChild(this.pillFor(tag));
	}

	// --- Details layout ---------------------------------------------------

	private renderDetails(
		body: HTMLElement,
		pinned: string[],
		rest: string[]
	): void {
		const { host } = this;
		const table = body.createEl("table", { cls: "tr-details" });
		const head = table.createEl("thead").createEl("tr");
		for (const [column, label] of DETAILS_COLUMNS) {
			const th = head.createEl("th", { text: label });
			if (this.detailsSort.column === column) {
				th.createSpan({
					cls: "tr-details-th-arrow",
					text: this.detailsSort.ascending ? "▲" : "▼",
				});
			}
			th.addEventListener("click", () => {
				if (this.detailsSort.column === column) {
					this.detailsSort.ascending = !this.detailsSort.ascending;
				} else {
					this.detailsSort = { column, ascending: true };
				}
				this.render();
			});
		}
		const tbody = table.createEl("tbody");

		const sorted = this.sortByColumn(rest);
		const section = (label: string, tags: string[]) => {
			if (tags.length === 0) return;
			if (label) {
				const row = tbody.createEl("tr", { cls: "tr-details-section" });
				row.createEl("td", { text: label, attr: { colspan: "5" } });
			}
			for (const tag of tags) this.renderDetailRow(tbody, tag);
		};

		// Pinned tags stay pinned-first (that is the point of pinning); the
		// column sort applies to everything else, matching a file browser
		// where favourites still sit above a sorted list.
		section(pinned.length > 0 ? `Pinned (${pinned.length})` : "", this.sortByColumn(pinned));
		section(pinned.length > 0 ? "All tags" : "", sorted);
	}

	private sortByColumn(tags: string[]): string[] {
		const { host } = this;
		return sortDetailsRows(
			tags,
			this.detailsSort.column,
			this.detailsSort.ascending,
			{
				nameOf: tagLabel,
				levelOf: (tag) => host.levelOf(tag),
				countOf: (tag) => host.graph.countOf(tag),
				relationsOf: (tag) => host.graph.neighbors(tag).length,
				groupsOf: (tag) => host.groups.parentsOf(tag).length,
			}
		);
	}

	private renderDetailRow(tbody: HTMLElement, tag: string): void {
		const { host } = this;
		const level = host.levelOf(tag);
		const row = tbody.createEl("tr", { cls: "tr-details-row" });
		row.toggleClass("is-selected", host.isSelected(tag));
		row.toggleClass(
			"is-related",
			!host.isSelected(tag) && host.isRelatedToSelection(tag)
		);

		const nameCell = row.createEl("td");
		const name = nameCell.createSpan({
			cls: "tr-details-name",
			text: tagLabel(tag),
		});
		applyLevelStyle(name, level, host.levelStyles);
		if (host.isPinned(tag)) {
			const pin = nameCell.createSpan({ cls: "tr-details-pin" });
			setIcon(pin, "pin");
		}

		row.createEl("td", {
			cls: "tr-details-kind",
			text: LEVEL_LABELS[level],
		});
		row.createEl("td", {
			cls: "tr-details-number",
			text: String(host.graph.countOf(tag)),
		});
		row.createEl("td", {
			cls: "tr-details-number",
			text: String(host.graph.neighbors(tag).length),
		});
		const parents = host.groups.parentsOf(tag);
		row.createEl("td", {
			cls: "tr-details-groups",
			text: parents.length > 0 ? parents.map(tagLabel).join(", ") : "—",
		});

		row.addEventListener("click", (event) => host.selectFromEvent(tag, event));
		row.addEventListener("dblclick", (event) => {
			event.preventDefault();
			host.openTagSearch(tag);
		});
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			host.openContextMenu(tag, event);
		});
	}

	// --- Pills ------------------------------------------------------------

	private pruneRemovedPills(tags: string[]): void {
		const live = new Set(tags);
		for (const tag of Array.from(this.pills.keys())) {
			if (!live.has(tag)) this.pills.delete(tag);
		}
	}

	/** Pills are reused across renders so FLIP can animate them between layouts. */
	private pillFor(tag: string): HTMLElement {
		const { host } = this;
		let pill = this.pills.get(tag);
		if (!pill) {
			pill = createSpan({ cls: "tr-pill" });
			pill.dataset.tag = tag;
			pill.addEventListener("click", (event) => {
				event.stopPropagation();
				host.selectFromEvent(tag, event);
			});
			pill.addEventListener("dblclick", (event) => {
				event.stopPropagation();
				event.preventDefault();
				host.openTagSearch(tag);
			});
			pill.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				host.openContextMenu(tag, event);
			});
			this.pills.set(tag, pill);
		}

		const node = host.graph.node(tag);
		const count = node?.count ?? 0;
		const level = host.levelOf(tag);
		const size = scaleByCount(count, host.graph.maxCount);
		const { cloudMinFontSize, cloudMaxFontSize } = host.settings;
		pill.style.fontSize =
			(cloudMinFontSize + (cloudMaxFontSize - cloudMinFontSize) * size).toFixed(
				1
			) + "px";
		applyLevelStyle(pill, level, host.levelStyles);

		pill.empty();
		if (this.renaming === tag) {
			this.renderRenameInput(pill, tag);
			return pill;
		}
		if (host.isPinned(tag)) {
			const pin = pill.createSpan({ cls: "tr-pill-pin" });
			setIcon(pin, "pin");
		}
		if (host.groups.isGroup(tag)) {
			const badge = pill.createSpan({ cls: "tr-pill-group" });
			setIcon(badge, level === "main" ? "folder" : "folder-open");
		}
		pill.createSpan({ cls: "tr-pill-name", text: tagLabel(tag) });
		pill.createSpan({ cls: "tr-pill-count", text: String(count) });
		if (host.editMode) {
			const edit = pill.createSpan({ cls: "tr-pill-edit" });
			setIcon(edit, "pencil");
			setTooltip(edit, `Rename ${tagLabel(tag)}`, { placement: "top" });
			edit.addEventListener("click", (event) => {
				event.stopPropagation();
				this.renaming = tag;
				this.render();
			});
		}

		const isSelected = host.isSelected(tag);
		const hasSelection = host.selection.length > 0;
		const related = !isSelected && host.isRelatedToSelection(tag);
		const strength = related ? host.selectionStrength(tag) : 0;

		// A group edge and a horizontal link are visually distinct even though
		// both force full strength — the group check runs first so a pair that
		// happens to carry both (grouped, and separately linked) still reads
		// as "grouped", which is the stronger structural fact.
		const relatedEdges = related
			? host.selection
					.map((other) => host.graph.edgeBetween(other, tag))
					.filter((edge): edge is NonNullable<typeof edge> => edge !== undefined)
			: [];
		pill.toggleClass("is-selected", isSelected);
		pill.toggleClass("is-related", related);
		pill.toggleClass("is-pinned", host.isPinned(tag));
		pill.toggleClass(
			"is-group-edge",
			relatedEdges.some((edge) => edge.parent !== undefined)
		);
		pill.toggleClass(
			"is-manual",
			relatedEdges.some((edge) => edge.parent === undefined && edge.manual)
		);
		pill.toggleClass(
			"is-dim",
			host.settings.dimUnrelated && hasSelection && !related && !isSelected
		);
		pill.style.setProperty("--tr-strength", strength.toFixed(3));

		setTooltip(pill, this.tooltipFor(tag, count, related, strength, level), {
			placement: "top",
		});
		return pill;
	}

	private tooltipFor(
		tag: string,
		count: number,
		related: boolean,
		strength: number,
		level: TagLevel
	): string {
		const lines = [`${tag} — ${count} note${count === 1 ? "" : "s"}`];
		if (level !== "simple") {
			const members = this.host.groups.childrenOf(tag).length;
			lines.push(
				`${LEVEL_LABELS[level]} · ${members} member${members === 1 ? "" : "s"}`
			);
		}
		if (related) {
			let closest: string | null = null;
			for (const other of this.host.selection) {
				if (other !== tag && this.host.graph.strength(other, tag) === strength) {
					closest = other;
					break;
				}
			}
			if (closest) {
				const edge = this.host.graph.edgeBetween(closest, tag);
				lines.push(describeRelation(edge, tag, closest, strength).long);
			}
		}
		return lines.join("\n");
	}

	private renderRenameInput(pill: HTMLElement, tag: string): void {
		pill.addClass("is-renaming");
		const input = pill.createEl("input", { cls: "tr-pill-input", type: "text" });
		input.value = tagLabel(tag);

		let settled = false;
		const cancel = () => {
			if (settled) return;
			settled = true;
			this.renaming = null;
			this.render();
		};
		const commit = () => {
			if (settled) return;
			settled = true;
			const next = input.value.trim();
			this.renaming = null;
			this.render();
			if (next.length > 0 && next !== tagLabel(tag)) {
				this.host.renameInline(tag, next);
			}
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

	// --- FLIP -------------------------------------------------------------

	private measure(): Map<string, PillRect> {
		const rects = new Map<string, PillRect>();
		for (const [tag, pill] of this.pills) {
			if (!pill.isConnected) continue;
			const box = pill.getBoundingClientRect();
			rects.set(tag, { left: box.left, top: box.top });
		}
		return rects;
	}

	/**
	 * First-Last-Invert-Play. Measurements are screen pixels, but the pill's
	 * own transform lives inside the zoomed layer, so the delta is divided by
	 * the current scale to land in the right coordinate space.
	 */
	private flip(before: Map<string, PillRect>): void {
		const scale = this.panzoom.scale || 1;
		const moved: HTMLElement[] = [];
		for (const [tag, pill] of this.pills) {
			const previous = before.get(tag);
			if (!previous || !pill.isConnected) continue;
			const box = pill.getBoundingClientRect();
			const dx = (previous.left - box.left) / scale;
			const dy = (previous.top - box.top) / scale;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
			pill.style.transition = "none";
			pill.style.transform = `translate(${dx}px, ${dy}px)`;
			moved.push(pill);
		}
		if (moved.length === 0) return;
		void this.container.offsetHeight;
		for (const pill of moved) {
			pill.style.transition = "transform 260ms cubic-bezier(0.2, 0, 0.2, 1)";
			pill.style.transform = "";
		}
		window.setTimeout(() => {
			for (const pill of moved) pill.style.transition = "";
		}, 300);
	}
}

