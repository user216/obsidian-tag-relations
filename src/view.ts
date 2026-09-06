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
import { TagGraph, tagLabel } from "./graph";
import { ModeRenderer, ViewHost } from "./host";
import { CloudRenderer } from "./cloud";
import { MapRenderer } from "./map";
import { TreeRenderer } from "./tree";
import { TagSuggestModal } from "./modals";
import { SORT_LABELS, SortMode, ViewMode } from "./types";

export const VIEW_TYPE_TAG_RELATIONS = "tag-relations-view";

const MODE_META: Array<{ mode: ViewMode; icon: string; label: string }> = [
	{ mode: "cloud", icon: "hash", label: "Cloud" },
	{ mode: "map", icon: "git-fork", label: "Mind-map" },
	{ mode: "tree", icon: "list-tree", label: "Tree" },
];

export class TagRelationsView extends ItemView implements ViewHost {
	plugin: TagRelationsPlugin;
	selected: string | null = null;
	filter = "";

	private mainEl!: HTMLElement;
	private inspectorEl!: HTMLElement;
	private renderer: ModeRenderer | null = null;
	private rendererMode: ViewMode | null = null;
	private modeButtons = new Map<ViewMode, HTMLElement>();
	private searchInput!: HTMLInputElement;

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
		this.mainEl = body.createDiv({ cls: "tr-main" });
		this.inspectorEl = body.createDiv({ cls: "tr-inspector" });
		this.renderAll();
	}

	async onClose(): Promise<void> {
		this.renderer?.destroy();
		this.renderer = null;
		this.rendererMode = null;
	}

	// --- ViewHost ---------------------------------------------------------

	visibleTags(): string[] {
		const graph = this.graph;
		const filter = this.filter;
		let tags = graph.tagList;
		if (filter) {
			tags = tags.filter(
				(tag) => tag.toLowerCase().includes(filter) || tag === this.selected
			);
		}
		const selected = this.selected;
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
				if (selected) {
					sorted.sort((a, b) => {
						if (a === selected) return -1;
						if (b === selected) return 1;
						return (
							graph.strength(selected, b) - graph.strength(selected, a) ||
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

	select(tag: string | null): void {
		if (tag !== null && !this.graph.nodes.has(tag)) return;
		this.selected = tag;
		this.renderActiveMode();
		this.renderInspector();
	}

	requestRender(): void {
		this.renderAll();
	}

	openTagSearch(tag: string): void {
		const internal = (this.app as unknown as InternalPluginHost).internalPlugins;
		const search = internal?.getPluginById?.("global-search");
		const query = `tag:${tag}`;
		if (search?.instance?.openGlobalSearch) {
			search.instance.openGlobalSearch(query);
		} else {
			new Notice("Enable the core Search plugin to search notes by tag.");
		}
	}

	openContextMenu(tag: string, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Focus this tag")
				.setIcon("crosshair")
				.onClick(() => this.select(tag))
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

	// --- Rendering --------------------------------------------------------

	renderAll(): void {
		this.syncToolbar();
		this.renderActiveMode();
		this.renderInspector();
	}

	/** Called by the plugin after the graph is rebuilt. */
	onGraphChanged(): void {
		if (this.selected && !this.graph.nodes.has(this.selected)) {
			this.selected = null;
		}
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

		const actions = toolbar.createDiv({ cls: "tr-actions" });
		const clearButton = actions.createDiv({ cls: "tr-icon-button" });
		setIcon(clearButton, "x-circle");
		setTooltip(clearButton, "Clear selection", { placement: "bottom" });
		clearButton.addEventListener("click", () => this.select(null));

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

		const selected = this.selected;
		if (!selected) {
			el.createDiv({ cls: "tr-inspector-empty" }).setText(
				"Select a tag to see what it connects to."
			);
			this.renderVaultSummary(el);
			return;
		}

		const header = el.createDiv({ cls: "tr-inspector-header" });
		header.createDiv({ cls: "tr-inspector-title", text: tagLabel(selected) });
		const count = this.graph.countOf(selected);
		const neighbors = this.graph.neighbors(selected);
		header.createDiv({
			cls: "tr-inspector-sub",
			text: `${count} note${count === 1 ? "" : "s"} · ${neighbors.length} relation${
				neighbors.length === 1 ? "" : "s"
			}`,
		});

		const actions = el.createDiv({ cls: "tr-inspector-actions" });
		this.actionButton(actions, "search", "Search notes", () =>
			this.openTagSearch(selected)
		);
		this.actionButton(actions, "link", "Connect to…", () =>
			this.promptConnect(selected)
		);

		el.createDiv({ cls: "tr-inspector-section", text: "Related tags" });
		if (neighbors.length === 0) {
			el.createDiv({
				cls: "tr-inspector-empty",
				text: "No relations yet. Use “Connect to…” to link this tag to another one, or add both tags to the same note.",
			});
		} else {
			const list = el.createDiv({ cls: "tr-related-list" });
			for (const edge of neighbors) {
				const other = edge.a === selected ? edge.b : edge.a;
				const row = list.createDiv({ cls: "tr-related-row" });
				row.createSpan({ cls: "tr-related-name", text: tagLabel(other) });
				const bar = row.createSpan({ cls: "tr-strength-bar" });
				bar.style.setProperty("--tr-strength", edge.weight.toFixed(3));
				bar.toggleClass("is-manual", edge.manual);
				row.createSpan({
					cls: "tr-related-meta",
					text: edge.manual
						? "manual"
						: `${Math.round(edge.weight * 100)}% · ${edge.cooccur}`,
				});
				setTooltip(
					row,
					edge.manual
						? `Manual connection${edge.label ? ` — ${edge.label}` : ""}`
						: `${edge.cooccur} shared note${edge.cooccur === 1 ? "" : "s"}`,
					{ placement: "left" }
				);
				row.addEventListener("click", () => this.select(other));
				row.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					this.openContextMenu(other, event);
				});
			}
		}

		const node = this.graph.node(selected);
		if (node && node.files.length > 0) {
			el.createDiv({
				cls: "tr-inspector-section",
				text: `Notes (${node.files.length})`,
			});
			const notes = el.createDiv({ cls: "tr-note-list" });
			for (const path of node.files.slice(0, 100)) {
				const row = notes.createDiv({ cls: "tr-note-row" });
				row.setText(basename(path));
				setTooltip(row, path, { placement: "left" });
				row.addEventListener("click", () => {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						void this.app.workspace.getLeaf(false).openFile(file);
					}
				});
			}
			if (node.files.length > 100) {
				notes.createDiv({
					cls: "tr-note-more",
					text: `+ ${node.files.length - 100} more`,
				});
			}
		}
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
			row.addEventListener("click", () => this.select(tag));
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

interface InternalPluginHost {
	internalPlugins?: {
		getPluginById?: (id: string) => {
			instance?: { openGlobalSearch?: (query: string) => void };
		} | null;
	};
}
