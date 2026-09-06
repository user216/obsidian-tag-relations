import { Notice, Plugin, WorkspaceLeaf, debounce } from "obsidian";
import {
	DEFAULT_SETTINGS,
	TagRelationsSettingTab,
	TagRelationsSettings,
	splitList,
} from "./settings";
import { TagGraph, normalizeTag, tagLabel } from "./graph";
import { TagRelationsView, VIEW_TYPE_TAG_RELATIONS } from "./view";
import { TagSuggestModal } from "./modals";

export default class TagRelationsPlugin extends Plugin {
	settings: TagRelationsSettings = { ...DEFAULT_SETTINGS };
	graph = new TagGraph();

	/** Vault edits arrive in bursts; rebuild once the dust settles. */
	rebuildGraphDebounced = debounce(() => this.rebuildGraph(), 900, true);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_TAG_RELATIONS,
			(leaf: WorkspaceLeaf) => new TagRelationsView(leaf, this)
		);

		this.addSettingTab(new TagRelationsSettingTab(this.app, this));

		this.addRibbonIcon("tags", "Tag relations", () => void this.activateView());

		this.addCommand({
			id: "open-tag-relations",
			name: "Open tag relations",
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "open-tag-relations-sidebar",
			name: "Open tag relations in sidebar",
			callback: () => void this.activateView(true),
		});
		this.addCommand({
			id: "focus-tag",
			name: "Focus a tag",
			callback: () => this.promptFocusTag(),
		});
		this.addCommand({
			id: "connect-tags",
			name: "Connect two tags",
			callback: () => this.promptConnectTags(),
		});
		this.addCommand({
			id: "rebuild-tag-graph",
			name: "Rescan vault for tags",
			callback: () => {
				this.rebuildGraph();
				new Notice(
					`Tag Relations: ${this.graph.nodes.size} tags, ${this.graph.edges.size} relations.`
				);
			},
		});

		this.app.workspace.onLayoutReady(() => this.rebuildGraph());

		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.rebuildGraphDebounced())
		);
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => this.rebuildGraphDebounced())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.rebuildGraphDebounced())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.rebuildGraphDebounced())
		);
	}

	onunload(): void {
		this.rebuildGraphDebounced.cancel();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<TagRelationsSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
		// Guard against a hand-edited or partially written data.json.
		if (!Array.isArray(this.settings.manualLinks)) this.settings.manualLinks = [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	rebuildGraph(): void {
		this.graph.build(this.app, {
			metric: this.settings.metric,
			minCooccurrence: this.settings.minCooccurrence,
			minWeight: this.settings.minWeight,
			caseSensitive: this.settings.caseSensitive,
			linkNestedTags: this.settings.linkNestedTags,
			excludedTags: splitList(this.settings.excludedTags),
			excludedFolders: splitList(this.settings.excludedFolders),
			manualLinks: this.settings.manualLinks,
		});
		for (const view of this.views()) view.onGraphChanged();
	}

	refreshViews(): void {
		for (const view of this.views()) view.requestRender();
	}

	private views(): TagRelationsView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_TAG_RELATIONS)
			.map((leaf) => leaf.view)
			.filter((view): view is TagRelationsView => view instanceof TagRelationsView);
	}

	/** Every tag in the vault plus any tag named only by a manual connection. */
	allKnownTags(): string[] {
		const tags = new Set(this.graph.tagList);
		for (const link of this.settings.manualLinks) {
			tags.add(normalizeTag(link.a, this.settings.caseSensitive));
			tags.add(normalizeTag(link.b, this.settings.caseSensitive));
		}
		return Array.from(tags).sort((a, b) => a.localeCompare(b));
	}

	async addManualLink(a: string, b: string, label?: string): Promise<void> {
		const tagA = normalizeTag(a, this.settings.caseSensitive);
		const tagB = normalizeTag(b, this.settings.caseSensitive);
		if (tagA === tagB) {
			new Notice("A tag cannot be connected to itself.");
			return;
		}
		const exists = this.settings.manualLinks.some(
			(link) =>
				(link.a === tagA && link.b === tagB) ||
				(link.a === tagB && link.b === tagA)
		);
		if (exists) {
			new Notice(`${tagLabel(tagA)} and ${tagLabel(tagB)} are already connected.`);
			return;
		}
		this.settings.manualLinks.push({ a: tagA, b: tagB, label });
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(`Connected ${tagLabel(tagA)} ↔ ${tagLabel(tagB)}`);
	}

	async removeManualLink(a: string, b: string): Promise<void> {
		const before = this.settings.manualLinks.length;
		this.settings.manualLinks = this.settings.manualLinks.filter(
			(link) => !((link.a === a && link.b === b) || (link.a === b && link.b === a))
		);
		if (this.settings.manualLinks.length === before) return;
		await this.saveSettings();
		this.rebuildGraph();
		new Notice(`Disconnected ${tagLabel(a)} ↔ ${tagLabel(b)}`);
	}

	async activateView(sidebar = false): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TAG_RELATIONS);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = sidebar
			? workspace.getRightLeaf(false)
			: workspace.getLeaf("tab");
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_TAG_RELATIONS, active: true });
		await workspace.revealLeaf(leaf);
	}

	private promptFocusTag(): void {
		const tags = this.allKnownTags();
		if (tags.length === 0) {
			new Notice("No tags found in this vault yet.");
			return;
		}
		const subtitles = new Map<string, string>();
		for (const tag of tags) {
			const count = this.graph.countOf(tag);
			const degree = this.graph.neighbors(tag).length;
			subtitles.set(
				tag,
				`${count} note${count === 1 ? "" : "s"} · ${degree} relation${
					degree === 1 ? "" : "s"
				}`
			);
		}
		new TagSuggestModal(
			this.app,
			tags,
			"Focus a tag",
			(tag) => {
				void this.activateView().then(() => {
					for (const view of this.views()) view.select(tag);
				});
			},
			subtitles
		).open();
	}

	private promptConnectTags(): void {
		const tags = this.allKnownTags();
		if (tags.length < 2) {
			new Notice("Not enough tags in this vault to connect.");
			return;
		}
		new TagSuggestModal(this.app, tags, "Connect: pick the first tag", (first) => {
			new TagSuggestModal(
				this.app,
				tags.filter((tag) => tag !== first),
				`Connect ${tagLabel(first)} to…`,
				(second) => void this.addManualLink(first, second)
			).open();
		}).open();
	}
}
