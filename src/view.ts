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
import {
	ModeRenderer,
	ViewHost,
	describeRelation,
	hasToggleModifier,
} from "./host";
import { CloudRenderer } from "./cloud";
import { MapRenderer } from "./map";
import { TreeRenderer } from "./tree";
import { GroupsRenderer } from "./groupsView";
import { TagGroups } from "./groups";
import {
	ACTION_GROUP_LABELS,
	ACTION_GROUP_ORDER,
	ActionHost,
	TAG_ACTIONS,
	TagAction,
	iconFor,
} from "./actions";
import { MAX_PINNED, resolveLevelStyles } from "./levels";
import { TagSuggestModal } from "./modals";
import {
	applySelection,
	filterTags,
	isSnapshotStale,
	sortTags,
} from "./selection";
import {
	LEVEL_LABELS,
	MATCH_LABELS,
	NoteMatchMode,
	SORT_LABELS,
	CLOUD_LAYOUT_LABELS,
	CloudLayout,
	LEVEL_FILTER_LABELS,
	LevelFilter,
	LevelStyles,
	SelectMode,
	SortMode,
	TagLevel,
	ViewMode,
} from "./types";

export const VIEW_TYPE_TAG_RELATIONS = "tag-relations-view";

const MODE_META: Array<{ mode: ViewMode; icon: string; label: string }> = [
	{ mode: "cloud", icon: "hash", label: "Cloud" },
	{ mode: "map", icon: "git-fork", label: "Mind-map" },
	{ mode: "tree", icon: "list-tree", label: "Tree" },
	{ mode: "groups", icon: "folder-tree", label: "Groups" },
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
	private editButton!: HTMLElement;
	private newNoteButton!: HTMLElement;
	private actionBarEl!: HTMLElement;
	private actionBarButton!: HTMLElement;
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

	get editMode(): boolean {
		return this.plugin.settings.editMode;
	}

	get groups(): TagGroups {
		return this.graph.groups;
	}

	levelOf(tag: string): TagLevel {
		return this.graph.groups.levelOf(tag);
	}

	get levelStyles(): LevelStyles {
		return resolveLevelStyles(
			this.settings.levelStylePreset,
			this.settings.levelStyles
		);
	}

	isPinned(tag: string): boolean {
		return this.settings.pinnedTags.includes(tag);
	}

	togglePin(tag: string): void {
		void this.plugin.togglePinnedTag(tag);
	}

	isGroupCollapsed(tag: string): boolean {
		return this.settings.collapsedGroups.includes(tag);
	}

	toggleGroupCollapsed(tag: string): void {
		const collapsed = this.settings.collapsedGroups;
		const index = collapsed.indexOf(tag);
		if (index >= 0) collapsed.splice(index, 1);
		else collapsed.push(tag);
		void this.plugin.saveSettings();
		this.renderActiveMode();
	}

	promptAddToGroup(parent: string): void {
		this.plugin.promptAddToGroup(parent);
	}

	promptPutInsideGroup(child: string): void {
		this.plugin.promptPutInsideGroup(child);
	}

	// --- ActionHost -------------------------------------------------------

	removableRelationCount(tag: string): number {
		return this.plugin.removableRelationCount(tag);
	}

	promptTakeOutOfGroup(tag: string): void {
		this.plugin.promptTakeOutOfGroup(tag);
	}

	promptHorizontalLink(tag: string): void {
		this.promptConnect(tag);
	}

	promptRemoveRelation(tag: string): void {
		this.plugin.promptRemoveRelation(tag);
	}

	promptRemoveAllRelations(tag: string): void {
		this.plugin.promptRemoveAllRelations(tag);
	}

	promptAssignTagToNotesOf(tag: string): void {
		this.plugin.promptAssignTag(
			this.plugin.notesWithTag(tag),
			`notes tagged ${tagLabel(tag)}`
		);
	}

	promptRemoveTagFromNotes(tag: string): void {
		this.plugin.promptUnassignTag(
			tag,
			this.plugin.notesWithTag(tag),
			"the whole vault"
		);
	}

	createNote(): void {
		this.plugin.promptCreateNote(this.selection.slice());
	}

	exportRelations(): void {
		void this.plugin.exportRelationsToFile();
	}

	importRelations(): void {
		this.plugin.promptImportRelations();
	}

	copyTag(tag: string): void {
		void navigator.clipboard.writeText(tag);
		new Notice(`Copied ${tag}`);
	}

	/** The tag the button bar acts on: the most recently selected one. */
	private actionTarget(): string | null {
		return this.selection.length > 0
			? this.selection[this.selection.length - 1]
			: null;
	}

	removeFromGroup(parent: string, child: string): void {
		// Exactly this membership, not every parent the tag has.
		void this.plugin.removeMembership(child, parent);
	}

	onZoomChanged(scale: number): void {
		// Persisted so the view reopens at the zoom you left it at; not saved
		// on every wheel tick, only when the value actually settles differently.
		if (Math.abs(this.settings.cloudZoom - scale) < 0.001) return;
		this.settings.cloudZoom = scale;
		void this.plugin.saveSettings();
	}

	promptRename(tag: string): void {
		this.plugin.promptRenameTag(tag);
	}

	renameInline(tag: string, next: string): void {
		this.plugin.requestRename(tag, next);
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
		this.actionBarEl = this.contentEl.createDiv({ cls: "tr-action-bar" });
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
		this.selection = applySelection(this.selection, tag, mode);
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
		this.syncNewNoteButton();
		this.renderActionBar();
		this.renderActiveMode();
		this.renderInspector();
		// The snapshot stays put; only its stale badge reacts.
		this.renderNotesPanel();
	}

	// --- Other ViewHost members ------------------------------------------

	visibleTags(): string[] {
		const graph = this.graph;
		const filtered = filterTags(graph.tagList, this.filter, (tag) =>
			this.isSelected(tag)
		);
		return sortTags(filtered, this.sort, {
			countOf: (tag) => graph.countOf(tag),
			strengthTo: (tag) => this.selectionStrength(tag),
			isSelected: (tag) => this.isSelected(tag),
			hasSelection: this.selection.length > 0,
		});
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
		const ctx = { tag, host: this as ActionHost };

		// Built from the same registry the button bar uses, so the two can
		// never offer different capabilities (ADR 0010).
		let firstGroup = true;
		for (const group of ACTION_GROUP_ORDER) {
			const available = TAG_ACTIONS.filter(
				(action) => action.group === group && action.isEnabled(ctx)
			);
			if (available.length === 0) continue;
			if (!firstGroup) menu.addSeparator();
			firstGroup = false;
			for (const action of available) {
				menu.addItem((item) => {
					item
						.setTitle(action.label(ctx))
						.setIcon(iconFor(action, this.settings.actionIcons))
						.onClick(() => action.run(ctx));
					if (action.destructive) item.setWarning(true);
				});
			}
		}
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
		return isSnapshotStale(
			this.snapshot,
			this.selection,
			this.settings.noteMatchMode,
			this.snapshotDirty
		);
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

		// Bulk edits act on exactly the notes listed below, which is the whole
		// point of freezing the list first.
		if (total > 0) {
			const paths = snapshot.matches.map((match) => match.path);
			const scope = `these ${total} note${total === 1 ? "" : "s"}`;
			const addButton = actions.createDiv({ cls: "tr-icon-button" });
			setIcon(addButton, "tag");
			setTooltip(addButton, `Add a tag to ${scope}`, { placement: "top" });
			addButton.addEventListener("click", () =>
				this.plugin.promptAssignTag(paths, scope)
			);

			const removeButton = actions.createDiv({ cls: "tr-icon-button" });
			setIcon(removeButton, "eraser");
			setTooltip(removeButton, `Remove a tag from ${scope}`, {
				placement: "top",
			});
			removeButton.addEventListener("click", () => {
				const candidates = this.tagsAcross(paths);
				if (candidates.length === 0) {
					new Notice("These notes have no tags to remove.");
					return;
				}
				new TagSuggestModal(
					this.app,
					candidates,
					`Remove which tag from ${scope}?`,
					(tag) => this.plugin.promptUnassignTag(tag, paths, scope)
				).open();
			});
		}

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
		this.renderActionBar();
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

		this.newNoteButton = toolbar.createDiv({ cls: "tr-icon-button" });
		setIcon(this.newNoteButton, "file-plus");
		this.newNoteButton.addEventListener("click", () =>
			this.plugin.promptCreateNote(this.selection.slice())
		);

		this.editButton = toolbar.createDiv({ cls: "tr-icon-button" });
		setIcon(this.editButton, "pencil");
		setTooltip(
			this.editButton,
			"Edit mode — show inline rename controls on tags",
			{ placement: "bottom" }
		);
		this.editButton.addEventListener("click", () => {
			this.settings.editMode = !this.settings.editMode;
			void this.plugin.saveSettings();
			this.syncToolbar();
			this.renderActiveMode();
			this.renderInspector();
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

		this.actionBarButton = toolbar.createDiv({ cls: "tr-icon-button" });
		setIcon(this.actionBarButton, "wand-2");
		setTooltip(this.actionBarButton, "Show the action bar", {
			placement: "bottom",
		});
		this.actionBarButton.addEventListener("click", async () => {
			this.settings.showActionBar = !this.settings.showActionBar;
			await this.plugin.saveSettings();
			this.syncToolbar();
			this.renderActionBar();
		});

		const optionsButton = toolbar.createDiv({ cls: "tr-icon-button" });
		setIcon(optionsButton, "sliders-horizontal");
		setTooltip(optionsButton, "View options", { placement: "bottom" });
		optionsButton.addEventListener("click", (event) =>
			this.openViewOptions(event)
		);

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

	/**
	 * Per-mode display switches. They live in a menu rather than the toolbar
	 * because most only apply to one view, and a toolbar that changes shape as
	 * you switch modes is harder to learn than a stable one.
	 */
	private openViewOptions(event: MouseEvent): void {
		const menu = new Menu();
		const mode = this.settings.mode;

		if (mode === "cloud") {
			menu.addItem((item) => item.setTitle("Layout").setIsLabel(true));
			for (const layout of Object.keys(CLOUD_LAYOUT_LABELS) as CloudLayout[]) {
				menu.addItem((item) =>
					item
						.setTitle(CLOUD_LAYOUT_LABELS[layout])
						.setChecked(this.settings.cloudLayout === layout)
						.onClick(async () => {
							this.settings.cloudLayout = layout;
							await this.plugin.saveSettings();
							this.renderActiveMode();
						})
				);
			}
			menu.addSeparator();
		}

		if (mode === "groups") {
			menu.addItem((item) => item.setTitle("Groups layout").setIsLabel(true));
			for (const layout of ["clouds", "tree"] as const) {
				menu.addItem((item) =>
					item
						.setTitle(layout === "clouds" ? "Collapsible clouds" : "Tree")
						.setChecked(this.settings.groupsLayout === layout)
						.onClick(async () => {
							this.settings.groupsLayout = layout;
							await this.plugin.saveSettings();
							this.renderActiveMode();
						})
				);
			}
			menu.addItem((item) =>
				item
					.setTitle("Show sub-groups as top-level too")
					.setChecked(this.settings.showSubGroupsStandalone)
					.onClick(async () => {
						this.settings.showSubGroupsStandalone =
							!this.settings.showSubGroupsStandalone;
						await this.plugin.saveSettings();
						this.renderActiveMode();
					})
			);
			menu.addSeparator();
		}

		if (mode === "map") {
			menu.addItem((item) =>
				item
					.setTitle("Show the whole vault at once")
					.setChecked(this.settings.mapWholeVault)
					.onClick(async () => {
						this.settings.mapWholeVault = !this.settings.mapWholeVault;
						await this.plugin.saveSettings();
						this.renderActiveMode();
					})
			);
			menu.addSeparator();
		}

		menu.addItem((item) => item.setTitle("Levels shown").setIsLabel(true));
		for (const filter of Object.keys(LEVEL_FILTER_LABELS) as LevelFilter[]) {
			menu.addItem((item) =>
				item
					.setTitle(LEVEL_FILTER_LABELS[filter])
					.setChecked(this.settings.levelFilter === filter)
					.onClick(async () => {
						this.settings.levelFilter = filter;
						await this.plugin.saveSettings();
						this.renderActiveMode();
					})
			);
		}

		menu.showAtMouseEvent(event);
	}

	/**
	 * Every action as a button, so nothing is reachable only by right-click.
	 * Buttons stay in place and grey out when they do not apply, rather than
	 * appearing and vanishing — a bar that changes shape as the selection
	 * changes is much harder to build muscle memory for.
	 */
	private renderActionBar(): void {
		const bar = this.actionBarEl;
		if (!bar) return;
		bar.empty();
		bar.toggleClass("is-hidden", !this.settings.showActionBar);
		if (!this.settings.showActionBar) return;

		const tag = this.actionTarget();
		const ctx = { tag, host: this as ActionHost };

		const target = bar.createDiv({ cls: "tr-action-bar-target" });
		target.setText(
			tag
				? this.selection.length > 1
					? `${tagLabel(tag)} (+${this.selection.length - 1})`
					: tagLabel(tag)
				: "No tag selected"
		);
		setTooltip(
			target,
			tag
				? "Buttons act on this tag — the last one you selected"
				: "Select a tag to enable the tag actions",
			{ placement: "bottom" }
		);

		for (const group of ACTION_GROUP_ORDER) {
			const actions = TAG_ACTIONS.filter((action) => action.group === group);
			if (actions.length === 0) continue;
			const cluster = bar.createDiv({ cls: "tr-action-cluster" });
			setTooltip(cluster, ACTION_GROUP_LABELS[group], { placement: "bottom" });
			for (const action of actions) this.renderActionButton(cluster, action, ctx);
		}
	}

	private renderActionButton(
		parent: HTMLElement,
		action: TagAction,
		ctx: { tag: string | null; host: ActionHost }
	): void {
		const enabled = action.isEnabled(ctx);
		const button = parent.createDiv({ cls: "tr-action-btn" });
		setIcon(button, iconFor(action, this.settings.actionIcons));
		button.toggleClass("is-disabled", !enabled);
		button.toggleClass("is-destructive", action.destructive === true);
		setTooltip(button, action.label(ctx), { placement: "bottom" });
		if (!enabled) return;
		button.addEventListener("click", () => action.run(ctx));
	}

	private syncToolbar(): void {
		for (const [mode, button] of this.modeButtons) {
			button.toggleClass("is-active", mode === this.settings.mode);
		}
		this.stickyButton?.toggleClass(
			"is-active",
			this.settings.stickyMultiSelect
		);
		this.editButton?.toggleClass("is-active", this.settings.editMode);
		this.actionBarButton?.toggleClass("is-active", this.settings.showActionBar);
		this.syncNewNoteButton();
		if (this.matchSelect) this.matchSelect.value = this.settings.noteMatchMode;
	}

	/**
	 * The button is hidden when disabled, and its tooltip names both the
	 * filename it will produce and the tags it will carry, so the result is
	 * predictable before clicking.
	 */
	private syncNewNoteButton(): void {
		const button = this.newNoteButton;
		if (!button) return;
		const enabled = this.settings.newNoteEnabled;
		button.toggleClass("is-hidden", !enabled);
		if (!enabled) return;

		const name = this.plugin.noteCreator.previewTitle();
		const tags =
			this.settings.newNoteApplySelectedTags && this.selection.length > 0
				? ` tagged ${this.selection.map(tagLabel).join(", ")}`
				: "";
		setTooltip(button, `Create ${name}.md${tags}`, { placement: "bottom" });
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
					: mode === "groups"
					? new GroupsRenderer(this.mainEl, this)
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
				text: "No relations yet. Use “Horizontal link to…” to link these tags to another one, or add them to the same note.",
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
			// Described from `other`'s own point of view — this row is about
			// `other`, so "contains"/"inside" reads correctly regardless of
			// which of the two tags the graph happened to store as `.parent`.
			const description = closest
				? describeRelation(edge, other, closest, strength)
				: null;
			const isGroup =
				description?.kind === "group-contains" ||
				description?.kind === "group-inside";
			const row = list.createDiv({ cls: "tr-related-row" });
			row.createSpan({ cls: "tr-related-name", text: tagLabel(other) });
			const bar = row.createSpan({ cls: "tr-strength-bar" });
			bar.style.setProperty("--tr-strength", strength.toFixed(3));
			bar.toggleClass("is-group", isGroup);
			bar.toggleClass("is-manual", description?.kind === "manual");
			row.createSpan({
				cls: "tr-related-meta",
				text: description?.short ?? "",
			});
			setTooltip(row, description?.long ?? "", { placement: "left" });
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
			this.actionButton(actions, "link", "Horizontal link to…", () =>
				this.promptConnect(this.selection[0])
			);
		}
		this.actionButton(actions, "x-circle", "Clear", () => this.clearSelection());

		// Editing is grouped separately and labelled, because unlike everything
		// else in this panel these actions rewrite notes.
		el.createDiv({ cls: "tr-inspector-section", text: "Edit tags" });
		const edits = el.createDiv({ cls: "tr-inspector-actions" });
		if (this.selection.length === 1) {
			const tag = this.selection[0];
			this.actionButton(edits, "pencil", "Rename…", () =>
				this.plugin.promptRenameTag(tag)
			);
		}
		this.actionButton(edits, "tag", "Add tag…", () =>
			this.plugin.promptAssignTag(
				this.notesForCurrentSelection(),
				this.selectionScopeLabel()
			)
		);
		if (this.selection.length === 1) {
			const tag = this.selection[0];
			this.actionButton(edits, "trash-2", "Remove tag…", () =>
				this.plugin.promptUnassignTag(
					tag,
					this.plugin.notesWithTag(tag),
					"the whole vault"
				)
			);
		}
	}

	/** Every tag appearing on any of `paths`, for the "remove which tag?" picker. */
	private tagsAcross(paths: string[]): string[] {
		const found = new Set<string>();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				for (const tag of this.plugin.tagsOnFile(file)) found.add(tag);
			}
		}
		return Array.from(found).sort((a, b) => a.localeCompare(b));
	}

	/** The notes the current selection resolves to, under the active match mode. */
	private notesForCurrentSelection(): string[] {
		return this.graph
			.matchNotes(this.selection, this.settings.noteMatchMode)
			.map((match) => match.path);
	}

	private selectionScopeLabel(): string {
		const names = this.selection.map(tagLabel).join(" + ");
		return this.selection.length === 1
			? `notes tagged ${names}`
			: `notes matching ${this.settings.noteMatchMode === "all" ? "all" : "any"} of ${names}`;
	}

	private renderVaultSummary(el: HTMLElement): void {
		const graph = this.graph;
		if (graph.isEmpty) return;
		el.createDiv({ cls: "tr-inspector-section", text: "Vault" });
		const stats = el.createDiv({ cls: "tr-stats" });
		this.statRow(stats, "Tags", String(graph.nodes.size));
		this.statRow(stats, "Relations", String(graph.edges.size));
		const manual = Array.from(graph.edges.values()).filter((e) => e.manual);
		this.statRow(stats, "Horizontal links", String(manual.length));

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
			new Notice("There is no other tag to link to yet.");
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
			`Horizontal link: ${tagLabel(tag)} to…`,
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
