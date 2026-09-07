import { App, PluginSettingTab, Setting, Notice, setIcon } from "obsidian";
import {
	ACTION_GROUP_LABELS,
	ACTION_GROUP_ORDER,
	ActionHost,
	actionsInGroup,
	iconFor,
} from "./actions";
import type TagRelationsPlugin from "./main";
import { AddLocation } from "./edit";
import {
	DEFAULT_TITLE_FORMAT,
	TITLE_FORMAT_PRESETS,
	availableTimeZones,
	isValidTimeZone,
	systemTimeZone,
} from "./datetime";
import { titleFor } from "./newNote";
import { MAX_PINNED, resolveLevelStyles } from "./levels";
import {
	CONNECTION_LABELS,
	LEVEL_LABELS,
	LEVEL_ORDER,
	LEVEL_STYLE_LABELS,
	LEVEL_FILTER_LABELS,
	CloudLayout,
	ConnectionKind,
	DEFAULT_CONNECTION_COLORS,
	GroupLink,
	LEVEL_STYLE_PRESETS,
	LevelFilter,
	LevelStylePreset,
	LevelStyles,
	TagLevel,
	ManualLink,
	NoteMatchMode,
	SortMode,
	ViewMode,
	WeightMetric,
} from "./types";
import { tagLabel } from "./graph";
import { TagSuggestModal } from "./modals";

export interface TagRelationsSettings {
	// Relation model
	metric: WeightMetric;
	minCooccurrence: number;
	minWeight: number;
	caseSensitive: boolean;
	linkNestedTags: boolean;
	excludedTags: string;
	excludedFolders: string;
	manualLinks: ManualLink[];

	// View state (persisted so the view reopens where you left it)
	mode: ViewMode;
	sort: SortMode;
	showInspector: boolean;

	// Tag groups ("tags for tags")
	groupLinks: GroupLink[];
	collapsedGroups: string[];
	/** Draw sub-groups as top-level sections too, not only nested. */
	showSubGroupsStandalone: boolean;
	groupsLayout: "clouds" | "tree";
	levelFilter: LevelFilter;
	levelStylePreset: LevelStylePreset;
	levelStyles: LevelStyles;
	showGroupConnections: boolean;
	connectionColors: Record<ConnectionKind, string>;

	// Action bar
	showActionBar: boolean;
	/** Per-action Lucide icon overrides, keyed by action id. */
	actionIcons: Record<string, string>;

	// Cloud presentation
	cloudLayout: CloudLayout;
	cloudZoom: number;
	pinnedTags: string[];

	// Map
	mapWholeVault: boolean;

	// New note
	newNoteEnabled: boolean;
	newNoteTitleFormat: string;
	newNoteTimeZone: string;
	newNoteFolder: string;
	newNoteApplySelectedTags: boolean;
	newNoteOpenAfterCreate: boolean;

	// Editing
	addTagLocation: AddLocation;
	confirmBulkEdits: boolean;
	editMode: boolean;

	// Selection and the notes panel
	stickyMultiSelect: boolean;
	noteMatchMode: NoteMatchMode;
	notesPanelHeight: number;
	notesMaxResults: number;

	// Cloud
	cloudMinFontSize: number;
	cloudMaxFontSize: number;
	regroupOnSelect: boolean;
	dimUnrelated: boolean;
	animateRegroup: boolean;

	// Map
	mapDepth: number;
	mapMaxNodes: number;
	mapLinkDistance: number;
	mapCharge: number;
	mapShowAllLabels: boolean;

	// Tree
	treeMaxChildren: number;
	treeAutoExpandDepth: number;
}

export const DEFAULT_SETTINGS: TagRelationsSettings = {
	metric: "jaccard",
	minCooccurrence: 1,
	minWeight: 0,
	caseSensitive: false,
	linkNestedTags: true,
	excludedTags: "",
	excludedFolders: "",
	manualLinks: [],

	mode: "cloud",
	sort: "name-asc",
	showInspector: true,

	groupLinks: [],
	collapsedGroups: [],
	showSubGroupsStandalone: false,
	groupsLayout: "clouds",
	levelFilter: "merged",
	levelStylePreset: "balanced",
	levelStyles: LEVEL_STYLE_PRESETS.balanced,
	showGroupConnections: true,
	connectionColors: { ...DEFAULT_CONNECTION_COLORS },

	showActionBar: false,
	actionIcons: {},

	cloudLayout: "icons",
	cloudZoom: 1,
	pinnedTags: [],

	mapWholeVault: false,

	newNoteEnabled: true,
	newNoteTitleFormat: DEFAULT_TITLE_FORMAT,
	newNoteTimeZone: "",
	newNoteFolder: "",
	newNoteApplySelectedTags: true,
	newNoteOpenAfterCreate: true,

	addTagLocation: "frontmatter",
	confirmBulkEdits: true,
	editMode: false,

	stickyMultiSelect: false,
	noteMatchMode: "all",
	notesPanelHeight: 240,
	notesMaxResults: 500,

	cloudMinFontSize: 11,
	cloudMaxFontSize: 30,
	regroupOnSelect: true,
	dimUnrelated: true,
	animateRegroup: true,

	mapDepth: 2,
	mapMaxNodes: 160,
	mapLinkDistance: 110,
	mapCharge: 3000,
	mapShowAllLabels: false,

	treeMaxChildren: 12,
	treeAutoExpandDepth: 1,
};

export function splitList(value: string): string[] {
	return value
		.split(/[,\n]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

type SettingsTabId =
	| "relations"
	| "groups"
	| "views"
	| "editing"
	| "newNote"
	| "actions";

interface SettingsTab {
	id: SettingsTabId;
	label: string;
	render(tab: TagRelationsSettingTab, el: HTMLElement): void;
}

/**
 * Six tabs, arranged as two threes (ADR 0009): what a relation *is*, then how
 * it is shown; then what editing does, then the two things that act rather
 * than describe.
 */
const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "relations",
		label: "Relations",
		render: (tab, el) => {
			tab.displayRelationsCore(el);
			tab.displayManualLinks(el);
		},
	},
	{ id: "groups", label: "Groups", render: (tab, el) => tab.displayGroups(el) },
	{
		id: "views",
		label: "Views",
		render: (tab, el) => {
			tab.displaySelectionNotes(el);
			tab.displayCloud(el);
			tab.displayMap(el);
			tab.displayTree(el);
		},
	},
	{ id: "editing", label: "Editing", render: (tab, el) => tab.displayEditing(el) },
	{ id: "newNote", label: "New note", render: (tab, el) => tab.displayNewNote(el) },
	{
		id: "actions",
		label: "Action bar",
		render: (tab, el) => tab.displayActionBar(el),
	},
];

export class TagRelationsSettingTab extends PluginSettingTab {
	plugin: TagRelationsPlugin;
	/** Which tab is open; kept across re-renders within a settings session. */
	private activeTab: SettingsTabId = "relations";

	constructor(app: App, plugin: TagRelationsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Tabs rather than one long scroll: the settings had grown past the
		// point where anything could be found by reading top to bottom.
		const nav = containerEl.createDiv({ cls: "tr-settings-tabs" });
		const panel = containerEl.createDiv({ cls: "tr-settings-panel" });

		for (const tab of SETTINGS_TABS) {
			const button = nav.createDiv({ cls: "tr-settings-tab", text: tab.label });
			button.toggleClass("is-active", this.activeTab === tab.id);
			button.addEventListener("click", () => {
				this.activeTab = tab.id;
				this.display();
			});
		}

		const active =
			SETTINGS_TABS.find((tab) => tab.id === this.activeTab) ?? SETTINGS_TABS[0];
		active.render(this, panel);
	}

	displayRelationsCore(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Relations").setHeading();

		new Setting(containerEl)
			.setName("Relation strength metric")
			.setDesc(
				"How strongly two tags are considered related when they share notes. Jaccard and cosine favour tags that genuinely belong together; raw co-occurrence favours your most-used tags."
			)
			.addDropdown((dd) =>
				dd
					.addOption("jaccard", "Jaccard (shared / combined)")
					.addOption("cosine", "Cosine (balanced)")
					.addOption("cooccurrence", "Raw co-occurrence count")
					.setValue(this.plugin.settings.metric)
					.onChange(async (value) => {
						this.plugin.settings.metric = value as WeightMetric;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
					})
			);

		new Setting(containerEl)
			.setName("Minimum shared notes")
			.setDesc(
				"Hide a relation unless the two tags appear together on at least this many notes. Horizontal links are always kept."
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.minCooccurrence)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.minCooccurrence = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
					})
			);

		new Setting(containerEl)
			.setName("Minimum relation strength")
			.setDesc(
				"Hide relations weaker than this (0 keeps everything). Useful in big vaults where every tag touches every other tag."
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 0.9, 0.05)
					.setValue(this.plugin.settings.minWeight)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.minWeight = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
					})
			);

		new Setting(containerEl)
			.setName("Case-sensitive tags")
			.setDesc(
				"Off (recommended): #Project and #project are the same tag."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.caseSensitive)
					.onChange(async (value) => {
						this.plugin.settings.caseSensitive = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
					})
			);

		new Setting(containerEl)
			.setName("Relate nested tags to their parent")
			.setDesc(
				"If your vault still contains nested tags, draw a relation from #a/b to #a so old hierarchies remain visible."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.linkNestedTags)
					.onChange(async (value) => {
						this.plugin.settings.linkNestedTags = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
					})
			);

		new Setting(containerEl)
			.setName("Excluded tags")
			.setDesc(
				"Comma or newline separated. Nested children of an excluded tag are excluded too."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("#inbox, #todo")
					.setValue(this.plugin.settings.excludedTags)
					.onChange(async (value) => {
						this.plugin.settings.excludedTags = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraphDebounced();
					})
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma or newline separated vault-relative folder paths.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Templates, Archive/2019")
					.setValue(this.plugin.settings.excludedFolders)
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraphDebounced();
					})
			);
	}

	displayEditing(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Editing").setHeading();

		containerEl.createEl("p", {
			cls: "tr-settings-empty",
			text: "Renaming and assigning tags rewrites your notes. Obsidian's undo does not cover bulk edits, so keep a backup or version control before large changes.",
		});

		new Setting(containerEl)
			.setName("Write new tags to")
			.setDesc(
				"Where a tag goes when you assign it to a note that does not have it yet."
			)
			.addDropdown((dd) =>
				dd
					.addOption("frontmatter", "Frontmatter (tags: …)")
					.addOption("inline", "End of the note body")
					.setValue(this.plugin.settings.addTagLocation)
					.onChange(async (value) => {
						this.plugin.settings.addTagLocation = value as AddLocation;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Confirm bulk edits")
			.setDesc(
				"Show the list of affected notes before writing to more than one note. Removals always ask, regardless of this setting."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.confirmBulkEdits)
					.onChange(async (value) => {
						this.plugin.settings.confirmBulkEdits = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Edit mode")
			.setDesc(
				"Show inline rename controls on tags in the cloud, tree and groups views. Also toggleable from the view's toolbar."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.editMode)
					.onChange(async (value) => {
						this.plugin.settings.editMode = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);
	}

	displaySelectionNotes(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Selection and notes").setHeading();

		new Setting(containerEl)
			.setName("Sticky multi-select")
			.setDesc(
				"On: every click adds or removes a tag from the selection. Off: a plain click selects one tag, and Ctrl/Cmd or Shift click adds to the selection."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.stickyMultiSelect)
					.onChange(async (value) => {
						this.plugin.settings.stickyMultiSelect = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Match notes against")
			.setDesc(
				"Which notes “Show notes” collects when several tags are selected: notes carrying every selected tag, or notes carrying at least one."
			)
			.addDropdown((dd) =>
				dd
					.addOption("all", "All tags (intersection)")
					.addOption("any", "Any tag (union)")
					.setValue(this.plugin.settings.noteMatchMode)
					.onChange(async (value) => {
						this.plugin.settings.noteMatchMode = value as NoteMatchMode;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Notes panel height")
			.setDesc("How tall the results panel is, in pixels.")
			.addSlider((slider) =>
				slider
					.setLimits(120, 600, 10)
					.setValue(this.plugin.settings.notesPanelHeight)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.notesPanelHeight = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Maximum notes listed")
			.setDesc(
				"Cap on how many results the panel renders at once. The header always reports the true total."
			)
			.addSlider((slider) =>
				slider
					.setLimits(50, 2000, 50)
					.setValue(this.plugin.settings.notesMaxResults)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.notesMaxResults = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);
	}

	displayCloud(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Tag cloud").setHeading();

		new Setting(containerEl)
			.setName("Font size range")
			.setDesc("Smallest and largest tag size, scaled by note count.")
			.addSlider((slider) =>
				slider
					.setLimits(8, 24, 1)
					.setValue(this.plugin.settings.cloudMinFontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cloudMinFontSize = value;
						if (value > this.plugin.settings.cloudMaxFontSize) {
							this.plugin.settings.cloudMaxFontSize = value;
						}
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			)
			.addSlider((slider) =>
				slider
					.setLimits(12, 64, 1)
					.setValue(this.plugin.settings.cloudMaxFontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cloudMaxFontSize = Math.max(
							value,
							this.plugin.settings.cloudMinFontSize
						);
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Re-group on selection")
			.setDesc(
				"When a tag is selected, pull its related tags to the front of the cloud."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.regroupOnSelect)
					.onChange(async (value) => {
						this.plugin.settings.regroupOnSelect = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Animate re-grouping")
			.setDesc("Slide tags to their new position instead of jumping.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.animateRegroup)
					.onChange(async (value) => {
						this.plugin.settings.animateRegroup = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dim unrelated tags")
			.setDesc("Fade out tags that have no relation to the selected tag.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.dimUnrelated)
					.onChange(async (value) => {
						this.plugin.settings.dimUnrelated = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);
	}

	displayMap(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Mind-map").setHeading();

		new Setting(containerEl)
			.setName("Depth around selection")
			.setDesc(
				"How many relation hops out from the selected tag to draw. Higher values show more context but crowd the canvas."
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 5, 1)
					.setValue(this.plugin.settings.mapDepth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.mapDepth = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Maximum nodes")
			.setDesc("Cap on how many tags the map draws at once.")
			.addSlider((slider) =>
				slider
					.setLimits(20, 600, 10)
					.setValue(this.plugin.settings.mapMaxNodes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.mapMaxNodes = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Link distance")
			.addSlider((slider) =>
				slider
					.setLimits(40, 300, 5)
					.setValue(this.plugin.settings.mapLinkDistance)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.mapLinkDistance = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Repel force")
			.setDesc("How strongly tags push each other apart.")
			.addSlider((slider) =>
				slider
					.setLimits(500, 12000, 100)
					.setValue(this.plugin.settings.mapCharge)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.mapCharge = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Always show every label")
			.setDesc(
				"Off: labels appear for the selection, its neighbours, larger tags and whatever you hover."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.mapShowAllLabels)
					.onChange(async (value) => {
						this.plugin.settings.mapShowAllLabels = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);
	}

	displayTree(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Tree").setHeading();

		new Setting(containerEl)
			.setName("Maximum children per tag")
			.setDesc("Only the strongest relations become branches.")
			.addSlider((slider) =>
				slider
					.setLimits(3, 40, 1)
					.setValue(this.plugin.settings.treeMaxChildren)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.treeMaxChildren = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Auto-expand depth")
			.setDesc("How many levels open automatically under the root tag.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 3, 1)
					.setValue(this.plugin.settings.treeAutoExpandDepth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.treeAutoExpandDepth = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);
	}


	displayActionBar(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Action bar").setHeading();

		containerEl.createEl("p", {
			cls: "tr-settings-empty",
			text: "A row of buttons for every tag action, so nothing is reachable only by right-clicking. Buttons act on the last tag you selected, and grey out rather than disappear when they do not apply — the bar keeps a stable shape so its layout stays learnable.",
		});

		new Setting(containerEl)
			.setName("Show the action bar")
			.setDesc("Also toggleable on the fly from the view's toolbar.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showActionBar).onChange(async (value) => {
					settings.showActionBar = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				})
			);

		new Setting(containerEl).setName("Button icons").setHeading();
		containerEl.createEl("p", {
			cls: "tr-settings-empty",
			text: "Any Lucide icon name works — the same set Obsidian itself uses; see lucide.dev for the list. The preview updates as you type, and an unknown name simply leaves the button blank rather than breaking it. Leave a field empty for the default.",
		});

		for (const group of ACTION_GROUP_ORDER) {
			const actions = actionsInGroup(group);
			if (actions.length === 0) continue;
			new Setting(containerEl)
				.setName(ACTION_GROUP_LABELS[group])
				.setHeading();

			for (const action of actions) {
				const setting = new Setting(containerEl).setName(
					action.label({ tag: "#tag", host: previewHost(this.plugin) })
				);
				const preview = setting.controlEl.createDiv({ cls: "tr-icon-preview" });
				const paint = (name: string) => {
					preview.empty();
					try {
						setIcon(preview, name);
					} catch {
						/* an unknown icon name just leaves it blank */
					}
				};
				paint(iconFor(action, settings.actionIcons));

				setting.addText((text) =>
					text
						.setPlaceholder(action.defaultIcon)
						.setValue(settings.actionIcons[action.id] ?? "")
						.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) delete settings.actionIcons[action.id];
							else settings.actionIcons[action.id] = trimmed;
							paint(iconFor(action, settings.actionIcons));
							await this.plugin.saveSettings();
							this.plugin.refreshViews();
						})
				);
				setting.addExtraButton((button) =>
					button
						.setIcon("rotate-ccw")
						.setTooltip(`Back to ${action.defaultIcon}`)
						.onClick(async () => {
							delete settings.actionIcons[action.id];
							await this.plugin.saveSettings();
							this.plugin.refreshViews();
							this.display();
						})
				);
			}
		}
	}

	displayGroups(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Tag groups").setHeading();

		containerEl.createEl("p", {
			cls: "tr-settings-empty",
			text: "A group is a tag that holds other tags. A tag can belong to as many groups as you like, and the structure goes three levels deep: group → sub-group → tag. Nothing is written to your notes — grouping lives in this plugin's data only.",
		});

		new Setting(containerEl)
			.setName("Draw group membership as connections")
			.setDesc(
				"Show containment in the cloud and mind-map as coloured links. Off, groups still organise the Groups view but leave the relation graph untouched."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showGroupConnections)
					.onChange(async (value) => {
						settings.showGroupConnections = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
					})
			);

		new Setting(containerEl)
			.setName("Levels shown by default")
			.setDesc(
				"Also switchable per view from the toolbar's view options. “Separated” gives each level its own band; “together” mixes them in one field."
			)
			.addDropdown((dd) => {
				for (const key of Object.keys(LEVEL_FILTER_LABELS) as LevelFilter[]) {
					dd.addOption(key, LEVEL_FILTER_LABELS[key]);
				}
				dd.setValue(settings.levelFilter).onChange(async (value) => {
					settings.levelFilter = value as LevelFilter;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				});
			});

		new Setting(containerEl)
			.setName("How strongly levels differ")
			.setDesc(
				"Subtle, balanced and bold set the size, shadow and colour of each level together. Custom exposes the three individually."
			)
			.addDropdown((dd) => {
				for (const key of Object.keys(LEVEL_STYLE_LABELS) as LevelStylePreset[]) {
					dd.addOption(key, LEVEL_STYLE_LABELS[key]);
				}
				dd.setValue(settings.levelStylePreset).onChange(async (value) => {
					const preset = value as LevelStylePreset;
					settings.levelStylePreset = preset;
					// Seed the custom values from whatever was on screen, so
					// switching to Custom starts from what you were just looking at.
					if (preset === "custom") {
						settings.levelStyles = cloneStyles(
							resolveLevelStyles(settings.levelStylePreset, settings.levelStyles)
						);
					}
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					this.display();
				});
			});

		if (settings.levelStylePreset === "custom") {
			for (const level of LEVEL_ORDER) {
				const style = settings.levelStyles[level];
				new Setting(containerEl)
					.setName(LEVEL_LABELS[level])
					.setDesc("Size multiplier, shadow strength and colour.")
					.addSlider((slider) =>
						slider
							.setLimits(0.6, 3, 0.05)
							.setValue(style.scale)
							.setDynamicTooltip()
							.onChange(async (value) => {
								style.scale = value;
								await this.plugin.saveSettings();
								this.plugin.refreshViews();
							})
					)
					.addSlider((slider) =>
						slider
							.setLimits(0, 1, 0.05)
							.setValue(style.shadow)
							.setDynamicTooltip()
							.onChange(async (value) => {
								style.shadow = value;
								await this.plugin.saveSettings();
								this.plugin.refreshViews();
							})
					)
					.addColorPicker((picker) =>
						picker
							.setValue(style.color || "#888888")
							.onChange(async (value) => {
								style.color = value;
								await this.plugin.saveSettings();
								this.plugin.refreshViews();
							})
					);
			}
		}

		new Setting(containerEl).setName("Connection colours").setHeading();
		containerEl.createEl("p", {
			cls: "tr-settings-empty",
			text: "What each kind of link looks like on the mind-map. Leave the relation colours unset to follow your theme.",
		});
		for (const kind of Object.keys(CONNECTION_LABELS) as ConnectionKind[]) {
			new Setting(containerEl)
				.setName(CONNECTION_LABELS[kind])
				.addColorPicker((picker) =>
					picker
						.setValue(
							settings.connectionColors[kind] ||
								DEFAULT_CONNECTION_COLORS[kind] ||
								"#888888"
						)
						.onChange(async (value) => {
							settings.connectionColors[kind] = value;
							await this.plugin.saveSettings();
							this.plugin.refreshViews();
						})
				)
				.addExtraButton((button) =>
					button
						.setIcon("rotate-ccw")
						.setTooltip("Back to the default")
						.onClick(async () => {
							settings.connectionColors[kind] = DEFAULT_CONNECTION_COLORS[kind];
							await this.plugin.saveSettings();
							this.plugin.refreshViews();
							this.display();
						})
				);
		}

		const pinned = settings.pinnedTags;
		new Setting(containerEl)
			.setName("Pinned tags")
			.setDesc(
				`Held at the top of the cloud. ${pinned.length} of ${MAX_PINNED} used. Pin from a tag's right-click menu.`
			)
			.addButton((button) =>
				button
					.setButtonText("Unpin all")
					.setDisabled(pinned.length === 0)
					.onClick(async () => {
						settings.pinnedTags = [];
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
						this.display();
					})
			);
		if (pinned.length > 0) {
			containerEl.createEl("p", {
				cls: "tr-settings-empty",
				text: pinned.map(tagLabel).join(", "),
			});
		}
	}

	displayNewNote(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;

		new Setting(containerEl).setName("New note").setHeading();

		new Setting(containerEl)
			.setName("Show the new note button")
			.setDesc(
				"Adds a button to the Tag Relations toolbar that creates a note named after the current date and time. The command stays available either way."
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.newNoteEnabled).onChange(async (value) => {
					settings.newNoteEnabled = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					this.display();
				})
			);

		if (!settings.newNoteEnabled) return;

		// A live sample of what the current format and timezone produce, so the
		// token vocabulary never has to be guessed at.
		let previewEl: HTMLElement | null = null;
		const renderPreview = () => {
			if (!previewEl) return;
			previewEl.empty();
			const zoneOk = isValidTimeZone(settings.newNoteTimeZone);
			const name = titleFor(
				settings.newNoteTitleFormat,
				zoneOk ? settings.newNoteTimeZone : ""
			);
			previewEl.createSpan({ cls: "tr-preview-label", text: "Right now: " });
			previewEl.createSpan({ cls: "tr-preview-value", text: `${name}.md` });
			if (!zoneOk) {
				previewEl.createDiv({
					cls: "tr-preview-warning",
					text: `Unknown timezone "${settings.newNoteTimeZone}" — using the system zone instead.`,
				});
			}
		};

		new Setting(containerEl)
			.setName("Title format")
			.setDesc(
				"Moment-style tokens: YYYY YY MM DD HH mm ss, plus MMM MMMM ddd dddd and h/A for 12-hour time. Text in [square brackets] is kept literally. Characters a filename cannot hold become hyphens."
			)
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_TITLE_FORMAT)
					.setValue(settings.newNoteTitleFormat)
					.onChange(async (value) => {
						settings.newNoteTitleFormat = value || DEFAULT_TITLE_FORMAT;
						await this.plugin.saveSettings();
						renderPreview();
					});
				text.inputEl.addClass("tr-format-input");
			});

		new Setting(containerEl)
			.setName("Format presets")
			.setDesc("Pick one to fill the field above.")
			.addDropdown((dd) => {
				dd.addOption("", "Choose a preset…");
				for (const preset of TITLE_FORMAT_PRESETS) {
					dd.addOption(preset.format, preset.label);
				}
				dd.setValue("");
				dd.onChange(async (value) => {
					if (!value) return;
					settings.newNoteTitleFormat = value;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("Timezone")
			.setDesc(
				"Which zone the timestamp is read in. Useful when you want stable filenames while travelling, or a whole vault kept in UTC."
			)
			.addDropdown((dd) => {
				dd.addOption("", `System default (${systemTimeZone()})`);
				for (const zone of availableTimeZones()) dd.addOption(zone, zone);
				// A zone saved on another machine may not exist here; keep it
				// selectable rather than silently switching the user's setting.
				const current = settings.newNoteTimeZone;
				if (current && !availableTimeZones().includes(current)) {
					dd.addOption(current, `${current} (not available here)`);
				}
				dd.setValue(current);
				dd.onChange(async (value) => {
					settings.newNoteTimeZone = value;
					await this.plugin.saveSettings();
					renderPreview();
				});
			});

		const preview = new Setting(containerEl).setName("Preview");
		previewEl = preview.controlEl.createDiv({ cls: "tr-preview" });
		renderPreview();

		new Setting(containerEl)
			.setName("Folder for new notes")
			.setDesc(
				"Vault-relative path, created if missing. Leave empty to use Obsidian's own default location for new notes."
			)
			.addText((text) =>
				text
					.setPlaceholder("Default location from Obsidian settings")
					.setValue(settings.newNoteFolder)
					.onChange(async (value) => {
						settings.newNoteFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Apply the selected tags")
			.setDesc(
				"Write whichever tags are selected in the view into the new note's frontmatter, so it joins the graph immediately."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.newNoteApplySelectedTags)
					.onChange(async (value) => {
						settings.newNoteApplySelectedTags = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Open after creating")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.newNoteOpenAfterCreate)
					.onChange(async (value) => {
						settings.newNoteOpenAfterCreate = value;
						await this.plugin.saveSettings();
					})
			);
	}

	displayManualLinks(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Horizontal links")
			.setDesc(
				`Relations you declared by hand. These always show, even when the two tags never share a note. ${this.plugin.settings.manualLinks.length} defined.`
			)
			.setHeading()
			.addButton((button) =>
				button
					.setButtonText("Link two tags")
					.setCta()
					.onClick(() => this.promptForNewLink())
			);

		if (this.plugin.settings.manualLinks.length === 0) {
			containerEl.createEl("p", {
				cls: "tr-settings-empty",
				text: "No horizontal links yet. You can also link tags straight from the Tag Relations view: right-click a tag and choose “Horizontal link to another tag…”.",
			});
			return;
		}

		const list = containerEl.createDiv({ cls: "tr-manual-list" });
		this.plugin.settings.manualLinks.forEach((link, index) => {
			const row = new Setting(list)
				.setName(`${tagLabel(link.a)}  ↔  ${tagLabel(link.b)}`)
				.setDesc(link.label ?? "");
			row.addExtraButton((button) =>
				button
					.setIcon("pencil")
					.setTooltip("Edit label")
					.onClick(() => this.promptForLabel(index))
			);
			row.addExtraButton((button) =>
				button
					.setIcon("trash-2")
					.setTooltip("Remove connection")
					.onClick(async () => {
						this.plugin.settings.manualLinks.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.rebuildGraph();
						this.display();
					})
			);
		});
	}

	private promptForNewLink(): void {
		const tags = this.plugin.allKnownTags();
		if (tags.length < 2) {
			new Notice("Tag Relations: not enough tags in this vault yet.");
			return;
		}
		new TagSuggestModal(
			this.app,
			tags,
			"Horizontal link: pick the first tag",
			(first) => {
				new TagSuggestModal(
					this.app,
					tags.filter((t) => t !== first),
					`Horizontal link: ${tagLabel(first)} to…`,
					async (second) => {
						await this.plugin.addManualLink(first, second);
						this.display();
					}
				).open();
			}
		).open();
	}

	private promptForLabel(index: number): void {
		const link = this.plugin.settings.manualLinks[index];
		if (!link) return;
		const next = window.prompt(
			`Label for ${tagLabel(link.a)} ↔ ${tagLabel(link.b)}`,
			link.label ?? ""
		);
		if (next === null) return;
		link.label = next.trim() || undefined;
		void this.plugin.saveSettings().then(() => {
			this.plugin.rebuildGraph();
			this.display();
		});
	}
}

/** A detached copy, so editing custom styles never mutates a preset. */
function cloneStyles(styles: LevelStyles): LevelStyles {
	const out = {} as LevelStyles;
	for (const level of LEVEL_ORDER) out[level] = { ...styles[level] };
	return out;
}

/**
 * A stand-in host for rendering action labels in settings, where there is no
 * real selection. Labels that vary with state ("Pin" / "Unpin") show their
 * neutral form; nothing here is ever run.
 */
function previewHost(plugin: TagRelationsPlugin): ActionHost {
	const noop = () => undefined;
	return {
		graph: plugin.graph,
		groups: plugin.graph.groups,
		selection: [],
		isSelected: () => false,
		isPinned: () => false,
		removableRelationCount: () => 0,
		select: noop,
		clearSelection: noop,
		togglePin: noop,
		openTagSearch: noop,
		showNotes: noop,
		createNote: noop,
		promptAddToGroup: noop,
		promptPutInsideGroup: noop,
		promptTakeOutOfGroup: noop,
		promptHorizontalLink: noop,
		promptRemoveRelation: noop,
		promptRemoveAllRelations: noop,
		promptRename: noop,
		promptAssignTagToNotesOf: noop,
		promptRemoveTagFromNotes: noop,
		copyTag: noop,
	};
}
