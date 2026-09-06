import {
	ItemView,
	Menu,
	Notice,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
	setTooltip,
} from "obsidian";
import type TagRelationsPlugin from "./main";
import { NoteMatch, TagGraph, tagLabel } from "./graph";
import { ModeRenderer, ViewHost, hasToggleModifier } from "./host";
import { CloudRenderer } from "./cloud";
import { MapRenderer } from "./map";
import { TreeRenderer } from "./tree";
import { TagSuggestModal } from "./modals";
import {
	MATCH_LABELS,
	NoteMatchMode,
	SORT_LABELS,
	SelectMode,
	SortMode,
	ViewMode,
} from "./types";

export const VIEW_TYPE_TAG_RELATIONS = "tag-relations-view";

const MODE_META: Array<{ mode: ViewMode; icon: string; label: string }> = [
	{ mode: "cloud", icon: "hash", label: "Cloud" },
	{ mode: "map", icon: "git-fork", label: "Mind-map" },
	{ mode: "tree", icon: "list-tree", label: "Tree" },
];

/**
 * A frozen result set. The notes panel deliberately does not follow the
 * selection: it shows what was true when "Show notes" was pressed, and flags
 * itself as stale when the selection, the match mode, or the vault moves on.
 */
interface NotesSnapshot {
	tags: string[];
	mode: NoteMatchMode;
	matches: NoteMatch[];
	takenAt: number;
}

export class TagRelationsView extends ItemView implements ViewHost {
	plugin: TagRelationsPlugin;
	selection: string[] = [];
	filter = "";

	private mainEl!: HTMLElement;
	private notesEl!: HTMLElement;
	private inspectorEl!: HTMLElement;
	private renderer: ModeRenderer | null = null;
	private rendererMode: ViewMode | null = null;
	private modeButtons = new Map<ViewMode, HTMLElement>();
	private searchInput!: HTMLInputElement;
	private stickyButton!: HTMLElement;
	private matchSelect!: HTMLSelectElement;

	private snapshot: NotesSnapshot | null = null;
	/** Set when the graph rebuilds, so an open snapshot can flag itself stale. */
	private snapshotDirty = false;

	constructor(leaf: WorkspaceLeaf, plugin: TagRelationsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	get graph(): TagGraph {
		return this.plugin.graph;
	}

	get settings() {
		return this.plugin.settings;
	}

	get sort(): SortMode {
		return this.plugin.settings.sort;
	}

	getViewType(): string {
		return VIEW_TYPE_TAG_RELATIONS;
	}

	getDisplayText(): string {
		return "Tag relations";
	}

	getIcon(): string {
		return "tags";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("tr-root");
		this.buildToolbar();
		const body = this.contentEl.createDiv({ cls: "tr-body" });
		const column = body.createDiv({ cls: "tr-main-column" });
		this.mainEl = column.createDiv({ cls: "tr-main" });
		this.notesEl = column.createDiv({ cls: "tr-notes-panel" });
		this.inspectorEl = body.createDiv({ cls: "tr-inspector" });
		this.renderAll();
	}

	async onClose(): Promise<void> {
		this.renderer?.destroy();
		this.renderer = null;
		this.rendererMode = null;
	}

	// --- Selection (ViewHost) --------------------------------------------

	isSelected(tag: string): boolean {
		return this.selection.includes(tag);
	}

	isRelatedToSelection(tag: string): boolean {
		return this.graph.isRelatedToAny(tag, this.selection);
	}

	selectionStrength(tag: string): number {
		return this.graph.maxStrengthTo(tag, this.selection);
	}

	select(tag: string, mode: SelectMode): void {
		if (!this.graph.nodes.has(tag)) return;
		if (mode === "toggle") {
			const index = this.selection.indexOf(tag);
			if (index >= 0) this.selection.splice(index, 1);
			else this.selection.push(tag);
		} else {
			// A plain click on the only selected tag clears the selection.
			const isOnlySelection =
				this.selection.length === 1 && this.selection[0] === tag;
			this.selection = isOnlySelection ? [] : [tag];
		}
		this.afterSelectionChange();
	}

	selectFromEvent(tag: string, event: MouseEvent | PointerEvent): void {
		const toggle = hasToggleModifier(event) || this.settings.stickyMultiSelect;
		this.select(tag, toggle ? "toggle" : "replace");
	}

	clearSelection(): void {
		if (this.selection.length === 0) return;
		this.selection = [];
		this.afterSelectionChange();
	}

	private afterSelectionChange(): void {
		this.renderActiveMode();
		this.renderInspector();
		// The snapshot stays put; only its stale badge reacts.
		this.renderNotesPanel();
	}

	// --- Other ViewHost members ------------------------------------------

	visibleTags(): string[] {
		const graph = this.graph;
		const filter = this.filter;
		let tags = graph.tagList;
		if (filter) {
			// Selected tags stay visible even when they don't match the filter,
			// so filtering never silently hides what you are working with.
			tags = tags.filter(
				(tag) => tag.toLowerCase().includes(filter) || this.isSelected(tag)
			);
		}
		const sorted = tags.slice();
		switch (this.sort) {
			case "name-desc":
				sorted.sort((a, b) => b.localeCompare(a));
				break;
			case "count-desc":
				sorted.sort(
					(a, b) => graph.countOf(b) - graph.countOf(a) || a.localeCompare(b)
				);
				break;
			case "count-asc":
				sorted.sort(
					(a, b) => graph.countOf(a) - graph.countOf(b) || a.localeCompare(b)
				);
				break;
			case "relatedness":
				if (this.selection.length > 0) {
					sorted.sort((a, b) => {
						const aSel = this.isSelected(a);
						const bSel = this.isSelected(b);
						if (aSel !== bSel) return aSel ? -1 : 1;
						return (
							this.selectionStrength(b) - this.selectionStrength(a) ||
							a.localeCompare(b)
						);
					});
				} else {
					sorted.sort((a, b) => a.localeCompare(b));
				}
				break;
			default:
				sorted.sort((a, b) => a.localeCompare(b));
		}
		return sorted;
	}

	requestRender(): void {
		this.renderAll();
	}

	openTagSearch(tag: string): void {
		this.runSearch(`tag:${tag}`);
	}

	/** Search for the whole selection, honouring the current match mode. */
	openSelectionSearch(): void {
		if (this.selection.length === 0) return;
		const clauses = this.selection.map((tag) => `tag:${tag}`);
		this.runSearch(
			this.settings.noteMatchMode === "any"
				? clauses.join(" OR ")
				: clauses.join(" ")
		);
	}

	private runSearch(query: string): void {
		const internal = (this.app as unknown as InternalPluginHost).internalPlugins;
		const search = internal?.getPluginById?.("global-search");
		if (search?.instance?.openGlobalSearch) {
			search.instance.openGlobalSearch(query);
		} else {
			new Notice("Enable the core Search plugin to search notes by tag.");
		}
	}

	openContextMenu(tag: string, event: MouseEvent): void {
		const menu = new Menu();
		const selected = this.isSelected(tag);

		menu.addItem((item) =>
			item
				.setTitle(selected ? "Select only this tag" : "Select this tag")
				.setIcon("crosshair")
				.onClick(() => this.select(tag, "replace"))
		);
		menu.addItem((item) =>
			item
				.setTitle(selected ? "Remove from selection" : "Add to selection")
				.setIcon(selected ? "minus-circle" : "plus-circle")
				.onClick(() => this.select(tag, "toggle"))
		);
		menu.addItem((item) =>
			item
				.setTitle("Search notes with this tag")
				.setIcon("search")
				.onClick(() => this.openTagSearch(tag))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Connect to another tag…")
				.setIcon("link")
				.onClick(() => this.promptConnect(tag))
		);

		const manual = this.graph
			.neighbors(tag)
			.filter((edge) => edge.manual)
			.map((edge) => (edge.a === tag ? edge.b : edge.a));
		if (manual.length > 0) {
			menu.addItem((item) => {
				item.setTitle("Remove connection").setIcon("unlink");
				// Submenus exist at runtime but are not part of the public API,
				// so fall back to a picker when they are unavailable.
				const withSubmenu = item as unknown as { setSubmenu?: () => Menu };
				if (typeof withSubmenu.setSubmenu === "function") {
					const submenu = withSubmenu.setSubmenu();
					for (const other of manual) {
						submenu.addItem((sub) =>
							sub
								.setTitle(tagLabel(other))
								.onClick(() => void this.plugin.removeManualLink(tag, other))
						);
					}
				} else {
					item.onClick(() =>
						new TagSuggestModal(
							this.app,
							manual,
							`Disconnect ${tagLabel(tag)} from…`,
							(other) => void this.plugin.removeManualLink(tag, other)
						).open()
					);
				}
			});
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Copy tag")
				.setIcon("copy")
				.onClick(() => {
					void navigator.clipboard.writeText(tag);
					new Notice(`Copied ${tag}`);
				})
		);
		menu.showAtMouseEvent(event);
	}

	// --- Notes panel ------------------------------------------------------

	/**
	 * Freeze the current selection into the notes panel. This is the only
	 * thing that fills the panel — it never follows the selection on its own.
	 */
	showNotes(): void {
		if (this.selection.length === 0) {
			new Notice("Select at least one tag first.");
			return;
		}
		const mode = this.settings.noteMatchMode;
		this.snapshot = {
			tags: this.selection.slice(),
			mode,
			matches: this.graph.matchNotes(this.selection, mode),
			takenAt: Date.now(),
		};
		this.snapshotDirty = false;
		this.renderNotesPanel();
	}

	closeNotes(): void {
		this.snapshot = null;
		this.snapshotDirty = false;
		this.renderNotesPanel();
	}

	/** True when the panel no longer reflects the selection, mode, or vault. */
	private isSnapshotStale(): boolean {
		if (!this.snapshot) return false;
		if (this.snapshotDirty) return true;
		if (this.snapshot.mode !== this.settings.noteMatchMode) return true;
		if (this.snapshot.tags.length !== this.selection.length) return true;
		const current = this.selection.slice().sort();
		const taken = this.snapshot.tags.slice().sort();
		return current.some((tag, index) => tag !== taken[index]);
	}

	private renderNotesPanel(): void {
		const el = this.notesEl;
		el.empty();
		const snapshot = this.snapshot;
		el.toggleClass("is-hidden", snapshot === null);
		if (!snapshot) return;

		el.style.height = this.settings.notesPanelHeight + "px";

		const header = el.createDiv({ cls: "tr-notes-header" });
		const title = header.createDiv({ cls: "tr-notes-title" });
		const total = snapshot.matches.length;
		title.createSpan({
			cls: "tr-notes-count",
			text: `${total} note${total === 1 ? "" : "s"}`,
		});
		title.createSpan({
			cls: "tr-notes-query",
			text: `${MATCH_LABELS[snapshot.mode].toLowerCase()}: ${snapshot.tags
				.map(tagLabel)
				.join(", ")}`,
		});

		if (this.isSnapshotStale()) {
			const badge = header.createSpan({
				cls: "tr-notes-stale",
				text: "Outdated",
			});
			setTooltip(
				badge,
				"The selection, match mode, or vault changed since this list was taken. Press refresh to rebuild it.",
				{ placement: "top" }
			);
		}

		const actions = header.createDiv({ cls: "tr-notes-actions" });
		const refresh = actions.createDiv({ cls: "tr-icon-button" });
		setIcon(refresh, "refresh-cw");
		setTooltip(refresh, "Rebuild from the current selection", {
			placement: "top",
		});
		refresh.addEventListener("click", () => this.showNotes());

		const close = actions.createDiv({ cls: "tr-icon-button" });
		setIcon(close, "x");
		setTooltip(close, "Close notes panel", { placement: "top" });
		close.addEventListener("click", () => this.closeNotes());

		const list = el.createDiv({ cls: "tr-notes-list" });
		if (total === 0) {
			list.createDiv({
				cls: "tr-empty",
				text:
					snapshot.mode === "all"
						? "No note carries all of these tags. Try “Any tag” instead."
						: "No notes carry these tags.",
			});
			return;
		}

		const cap = this.settings.notesMaxResults;
		for (const match of snapshot.matches.slice(0, cap)) {
			const row = list.createDiv({ cls: "tr-note-row" });
			row.createSpan({ cls: "tr-note-name", text: basename(match.path) });
			const folder = dirname(match.path);
			if (folder) row.createSpan({ cls: "tr-note-folder", text: folder });
			// Under "all" every note matches every tag, so the count says nothing.
			if (snapshot.mode === "any" && snapshot.tags.length > 1) {
				row.createSpan({
					cls: "tr-note-matched",
					text: `${match.matched}/${snapshot.tags.length}`,
				});
			}
			setTooltip(row, match.path, { placement: "top" });
			row.addEventListener("click", (event) => {
				const file = this.app.vault.getAbstractFileByPath(match.path);
				if (!(file instanceof TFile)) return;
				const newTab = event.ctrlKey || event.metaKey;
				void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
			});
		}
		if (total > cap) {
			list.createDiv({
				cls: "tr-note-more",
				text: `+ ${total - cap} more (raise the cap in settings)`,
			});
		}
	}

	// --- Rendering --------------------------------------------------------

	renderAll(): void {
		this.syncToolbar();
		this.renderActiveMode();
		this.renderInspector();
		this.renderNotesPanel();
	}

	/** Called by the plugin after the graph is rebuilt. */
	onGraphChanged(): void {
		this.selection = this.selection.filter((tag) => this.graph.nodes.has(tag));
		// Any rebuild can add or remove notes behind an open snapshot, so mark
		// it stale rather than silently letting it drift out of date.
		if (this.snapshot) this.snapshotDirty = true;
		this.renderAll();
	}

	private buildToolbar(): void {
		const toolbar = this.contentEl.createDiv({ cls: "tr-toolbar" });

		const modes = toolbar.createDiv({ cls: "tr-modes" });
		for (const meta of MODE_META) {
			const button = modes.createDiv({ cls: "tr-mode-button" });
			setIcon(button.createSpan({ cls: "tr-mode-icon" }), meta.icon);
			button.createSpan({ cls: "tr-mode-label", text: meta.label });
			setTooltip(button, `${meta.label} view`, { placement: "bottom" });
			button.addEventListener("click", () => void this.setMode(meta.mode));
			this.modeButtons.set(meta.mode, button);
		}

		const search = toolbar.createDiv({ cls: "tr-search" });
		setIcon(search.createSpan({ cls: "tr-search-icon" }), "search");
		this.searchInput = search.createEl("input", {
			type: "text",
			placeholder: "Filter tags…",
			cls: "tr-search-input",
		});
		const applyFilter = debounce(
			(value: string) => {
				this.filter = value.trim().toLowerCase();
				this.renderActiveMode();
			},
			150,
			true
		);
		this.searchInput.addEventListener("input", () =>
			applyFilter(this.searchInput.value)
		);
		this.searchInput.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				this.searchInput.value = "";
				this.filter = "";
				this.renderActiveMode();
			}
		});

		const sortSelect = toolbar.createEl("select", { cls: "tr-sort dropdown" });
		for (const key of Object.keys(SORT_LABELS) as SortMode[]) {
			sortSelect.createEl("option", { value: key, text: SORT_LABELS[key] });
		}
		sortSelect.value = this.sort;
		sortSelect.addEventListener("change", () => {
			this.plugin.settings.sort = sortSelect.value as SortMode;
			void this.plugin.saveSettings();
			this.renderActiveMode();
		});

		this.stickyButton = toolbar.createDiv({ cls: "tr-icon-button" });
		setIcon(this.stickyButton, "list-checks");
		setTooltip(
			this.stickyButton,
			"Sticky multi-select — every click adds or removes a tag (Ctrl/Cmd or Shift click does this anyway)",
			{ placement: "bottom" }
		);
		this.stickyButton.addEventListener("click", () => {
			this.settings.stickyMultiSelect = !this.settings.stickyMultiSelect;
			void this.plugin.saveSettings();
			this.syncToolbar();
		});

		const notesGroup = toolbar.createDiv({ cls: "tr-notes-group" });
		this.matchSelect = notesGroup.createEl("select", {
			cls: "tr-match dropdown",
		});
		for (const key of Object.keys(MATCH_LABELS) as NoteMatchMode[]) {
			this.matchSelect.createEl("option", {
				value: key,
				text: MATCH_LABELS[key],
			});
		}
		this.matchSelect.value = this.settings.noteMatchMode;
		setTooltip(
			this.matchSelect,
			"Whether a note must carry every selected tag or just one",
			{ placement: "bottom" }
		);
		this.matchSelect.addEventListener("change", () => {
			this.settings.noteMatchMode = this.matchSelect.value as NoteMatchMode;
			void this.plugin.saveSettings();
			// Existing results stay frozen; they just flag themselves stale.
			this.renderNotesPanel();
		});

		const showNotes = notesGroup.createEl("button", {
			cls: "tr-show-notes mod-cta",
			text: "Show notes",
		});
		setTooltip(showNotes, "List the notes matching the selected tags", {
			placement: "bottom",
		});
		showNotes.addEventListener("click", () => this.showNotes());

		const actions = toolbar.createDiv({ cls: "tr-actions" });
		const clearButton = actions.createDiv({ cls: "tr-icon-button" });
		setIcon(clearButton, "x-circle");
		setTooltip(clearButton, "Clear selection", { placement: "bottom" });
		clearButton.addEventListener("click", () => this.clearSelection());

		const inspectorButton = actions.createDiv({ cls: "tr-icon-button" });
		setIcon(inspectorButton, "panel-right");
		setTooltip(inspectorButton, "Toggle details panel", { placement: "bottom" });
		inspectorButton.addEventListener("click", () => {
			this.plugin.settings.showInspector = !this.plugin.settings.showInspector;
			void this.plugin.saveSettings();
			this.renderInspector();
			this.syncToolbar();
		});

		const refreshButton = actions.createDiv({ cls: "tr-icon-button" });
		setIcon(refreshButton, "refresh-cw");
		setTooltip(refreshButton, "Rescan vault", { placement: "bottom" });
		refreshButton.addEventListener("click", () => this.plugin.rebuildGraph());
	}

	private syncToolbar(): void {
		for (const [mode, button] of this.modeButtons) {
			button.toggleClass("is-active", mode === this.settings.mode);
		}
		this.stickyButton?.toggleClass(
			"is-active",
			this.settings.stickyMultiSelect
		);
		if (this.matchSelect) this.matchSelect.value = this.settings.noteMatchMode;
	}

	private async setMode(mode: ViewMode): Promise<void> {
		if (this.settings.mode === mode) return;
		this.settings.mode = mode;
		await this.plugin.saveSettings();
		this.syncToolbar();
		this.renderActiveMode();
	}

	private renderActiveMode(): void {
		const mode = this.settings.mode;
		if (this.rendererMode !== mode || !this.renderer) {
			this.renderer?.destroy();
			this.mainEl.empty();
			this.renderer =
				mode === "map"
					? new MapRenderer(this.mainEl, this)
					: mode === "tree"
					? new TreeRenderer(this.mainEl, this)
					: new CloudRenderer(this.mainEl, this);
			this.rendererMode = mode;
		}
		this.renderer.render();
	}

	private renderInspector(): void {
		const el = this.inspectorEl;
		el.empty();
		el.toggleClass("is-hidden", !this.settings.showInspector);
		if (!this.settings.showInspector) return;

		if (this.selection.length === 0) {
			el.createDiv({ cls: "tr-inspector-empty" }).setText(
				"Select a tag to see what it connects to. Ctrl/Cmd or Shift click to select several."
			);
			this.renderVaultSummary(el);
			return;
		}

		if (this.selection.length === 1) this.renderSingleSelection(el);
		else this.renderMultiSelection(el);

		el.createDiv({ cls: "tr-inspector-section", text: "Related tags" });
		const related = this.graph.relatedToSelection(this.selection);
		if (related.length === 0) {
			el.createDiv({
				cls: "tr-inspector-empty",
				text: "No relations yet. Use “Connect to…” to link these tags to another one, or add them to the same note.",
			});
			return;
		}
		const list = el.createDiv({ cls: "tr-related-list" });
		for (const other of related) {
			const strength = this.selectionStrength(other);
			const closest = this.selection.find(
				(tag) => this.graph.strength(tag, other) === strength
			);
			const edge = closest ? this.graph.edgeBetween(closest, other) : undefined;
			const row = list.createDiv({ cls: "tr-related-row" });
			row.createSpan({ cls: "tr-related-name", text: tagLabel(other) });
			const bar = row.createSpan({ cls: "tr-strength-bar" });
			bar.style.setProperty("--tr-strength", strength.toFixed(3));
			bar.toggleClass("is-manual", edge?.manual === true);
			row.createSpan({
				cls: "tr-related-meta",
				text: edge?.manual
					? "manual"
					: `${Math.round(strength * 100)}% · ${edge?.cooccur ?? 0}`,
			});
			setTooltip(
				row,
				edge?.manual
					? `Manual connection to ${closest}${edge.label ? ` — ${edge.label}` : ""}`
					: `Closest to ${closest} · ${edge?.cooccur ?? 0} shared note${
							edge?.cooccur === 1 ? "" : "s"
					  }`,
				{ placement: "left" }
			);
			row.addEventListener("click", (event) => this.selectFromEvent(other, event));
			row.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this.openContextMenu(other, event);
			});
		}
	}

	private renderSingleSelection(el: HTMLElement): void {
		const tag = this.selection[0];
		const header = el.createDiv({ cls: "tr-inspector-header" });
		header.createDiv({ cls: "tr-inspector-title", text: tagLabel(tag) });
		const count = this.graph.countOf(tag);
		const degree = this.graph.neighbors(tag).length;
		header.createDiv({
			cls: "tr-inspector-sub",
			text: `${count} note${count === 1 ? "" : "s"} · ${degree} relation${
				degree === 1 ? "" : "s"
			}`,
		});
		this.renderSelectionActions(el);
	}

	private renderMultiSelection(el: HTMLElement): void {
		const header = el.createDiv({ cls: "tr-inspector-header" });
		header.createDiv({
			cls: "tr-inspector-title",
			text: `${this.selection.length} tags selected`,
		});

		const matches = this.graph.matchNotes(
			this.selection,
			this.settings.noteMatchMode
		);
		header.createDiv({
			cls: "tr-inspector-sub",
			text: `${matches.length} note${matches.length === 1 ? "" : "s"} match ${
				this.settings.noteMatchMode === "all" ? "all" : "any"
			} of them`,
		});

		const chips = el.createDiv({ cls: "tr-chips" });
		for (const tag of this.selection) {
			const chip = chips.createDiv({ cls: "tr-chip" });
			chip.createSpan({ cls: "tr-chip-name", text: tagLabel(tag) });
			const remove = chip.createSpan({ cls: "tr-chip-remove" });
			setIcon(remove, "x");
			setTooltip(remove, `Remove ${tagLabel(tag)} from selection`, {
				placement: "top",
			});
			remove.addEventListener("click", (event) => {
				event.stopPropagation();
				this.select(tag, "toggle");
			});
			chip.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this.openContextMenu(tag, event);
			});
		}

		this.renderSelectionActions(el);
	}

	private renderSelectionActions(el: HTMLElement): void {
		const actions = el.createDiv({ cls: "tr-inspector-actions" });
		this.actionButton(actions, "files", "Show notes", () => this.showNotes());
		this.actionButton(actions, "search", "Search", () =>
			this.openSelectionSearch()
		);
		if (this.selection.length === 1) {
			this.actionButton(actions, "link", "Connect to…", () =>
				this.promptConnect(this.selection[0])
			);
		}
		this.actionButton(actions, "x-circle", "Clear", () => this.clearSelection());
	}

	private renderVaultSummary(el: HTMLElement): void {
		const graph = this.graph;
		if (graph.isEmpty) return;
		el.createDiv({ cls: "tr-inspector-section", text: "Vault" });
		const stats = el.createDiv({ cls: "tr-stats" });
		this.statRow(stats, "Tags", String(graph.nodes.size));
		this.statRow(stats, "Relations", String(graph.edges.size));
		const manual = Array.from(graph.edges.values()).filter((e) => e.manual);
		this.statRow(stats, "Manual connections", String(manual.length));

		el.createDiv({ cls: "tr-inspector-section", text: "Most connected" });
		const list = el.createDiv({ cls: "tr-related-list" });
		const top = graph.tagList
			.slice()
			.sort(
				(a, b) =>
					graph.neighbors(b).length - graph.neighbors(a).length ||
					graph.countOf(b) - graph.countOf(a)
			)
			.slice(0, 12);
		for (const tag of top) {
			const row = list.createDiv({ cls: "tr-related-row" });
			row.createSpan({ cls: "tr-related-name", text: tagLabel(tag) });
			row.createSpan({
				cls: "tr-related-meta",
				text: `${graph.neighbors(tag).length}`,
			});
			row.addEventListener("click", (event) => this.selectFromEvent(tag, event));
		}
	}

	private statRow(parent: HTMLElement, label: string, value: string): void {
		const row = parent.createDiv({ cls: "tr-stat-row" });
		row.createSpan({ cls: "tr-stat-label", text: label });
		row.createSpan({ cls: "tr-stat-value", text: value });
	}

	private actionButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		action: () => void
	): void {
		const button = parent.createDiv({ cls: "tr-action-button" });
		setIcon(button.createSpan({ cls: "tr-action-icon" }), icon);
		button.createSpan({ text: label });
		button.addEventListener("click", action);
	}

	private promptConnect(tag: string): void {
		const candidates = this.plugin
			.allKnownTags()
			.filter((other) => other !== tag);
		if (candidates.length === 0) {
			new Notice("There is no other tag to connect to yet.");
			return;
		}
		const subtitles = new Map<string, string>();
		for (const other of candidates) {
			const edge = this.graph.edgeBetween(tag, other);
			if (edge?.manual) subtitles.set(other, "already connected");
			else if (edge) {
				subtitles.set(other, `${edge.cooccur} shared note${edge.cooccur === 1 ? "" : "s"}`);
			}
		}
		new TagSuggestModal(
			this.app,
			candidates,
			`Connect ${tagLabel(tag)} to…`,
			(other) => void this.plugin.addManualLink(tag, other),
			subtitles
		).open();
	}
}

function basename(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function dirname(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

interface InternalPluginHost {
	internalPlugins?: {
		getPluginById?: (id: string) => {
			instance?: { openGlobalSearch?: (query: string) => void };
		} | null;
	};
}
