import { setIcon, setTooltip } from "obsidian";
import {
	ModeRenderer,
	ViewHost,
	applyLevelStyle,
	attachRenameInput,
	scaleByCount,
} from "./host";
import { tagLabel } from "./graph";
import { PanZoom } from "./panzoom";
import { orderedLevels, separatesLevels, visibleLevels } from "./levels";
import { LEVEL_LABELS, TagLevel } from "./types";
import { TagGroups } from "./groups";

/**
 * The groups view: tags organised by the containment structure rather than by
 * relation strength.
 *
 * Two layouts share one pass over the same data:
 *
 *   clouds — every group is a collapsible section holding its members, so the
 *            whole structure is browsable on one page and any part of it can
 *            be folded away.
 *   tree   — the same structure as an indented outline, closer to how an
 *            outliner shows nesting.
 *
 * Because membership is a DAG (a tag may sit in several groups), a tag can
 * legitimately appear more than once here. That is the feature, not a bug —
 * it is exactly what nested tags could not express.
 */
export class GroupsRenderer implements ModeRenderer {
	private host: ViewHost;
	private panzoom: PanZoom;
	private root: HTMLElement;
	/** Tag currently being renamed in place — a section header or a member pill. */
	private renaming: string | null = null;

	constructor(container: HTMLElement, host: ViewHost) {
		this.host = host;
		this.root = container.createDiv({ cls: "tr-groups" });
		this.panzoom = new PanZoom(this.root, {
			onChange: (state) => host.onZoomChanged(state.scale),
		});
		this.panzoom.restoreScale(host.settings.cloudZoom);
	}

	destroy(): void {
		this.panzoom.destroy();
		this.root.remove();
	}

	render(): void {
		const body = this.panzoom.content;
		body.empty();
		body.toggleClass("tr-groups-tree", this.host.settings.groupsLayout === "tree");

		const { host } = this;
		const groups = host.groups;
		const levels = visibleLevels(host.settings.levelFilter);

		const roots = this.rootGroups();
		const loose = this.looseTags();

		if (roots.length === 0 && loose.length === 0) {
			this.renderEmpty(body);
			return;
		}

		for (const group of roots) {
			this.renderGroup(body, group, 0, new Set([group]));
		}

		// Everything no group contains, so nothing is unreachable from here.
		if (loose.length > 0 && levels.has("simple")) {
			this.renderSection(
				body,
				null,
				`Ungrouped (${loose.length})`,
				0,
				(container) => {
					const field = container.createDiv({ cls: "tr-group-members" });
					for (const tag of loose) this.renderTag(field, tag, 0);  // ungrouped: no parent to detach from
				}
			);
		}

		if (groups.isEmpty) this.renderHint(body);
	}

	/**
	 * Which groups start a section. Sub-groups normally appear only inside
	 * their parent; the "show sub-groups standalone" toggle also lifts them to
	 * the top level, which is useful when a sub-group is what you actually
	 * work in day to day.
	 */
	private rootGroups(): string[] {
		const { host } = this;
		const levels = visibleLevels(host.settings.levelFilter);
		const roots: string[] = [];
		if (levels.has("main")) roots.push(...host.groups.mainGroups());
		if (levels.has("sub") && host.settings.showSubGroupsStandalone) {
			roots.push(...host.groups.subGroups());
		}
		return roots.filter((tag) => this.passesFilter(tag));
	}

	private looseTags(): string[] {
		const { host } = this;
		return host.groups
			.ungrouped(host.visibleTags())
			.filter((tag) => !host.groups.isGroup(tag));
	}

	private passesFilter(tag: string): boolean {
		const filter = this.host.filter;
		if (!filter) return true;
		if (tag.toLowerCase().includes(filter)) return true;
		// A group stays visible when any of its members match, so filtering
		// never hides the container you were about to open.
		return this.host.groups
			.childrenOf(tag)
			.some((child) => child.toLowerCase().includes(filter));
	}

	private renderGroup(
		parent: HTMLElement,
		tag: string,
		depth: number,
		ancestors: Set<string>
	): void {
		const { host } = this;
		const children = host.groups.childrenOf(tag);
		const level = host.levelOf(tag);
		const label = `${tagLabel(tag)}`;

		this.renderSection(
			parent,
			tag,
			label,
			depth,
			(container) => {
				const levels = visibleLevels(host.settings.levelFilter);
				const { subGroups, plain } = visibleGroupChildren(
					host.groups,
					tag,
					levels
				);

				if (separatesLevels(host.settings.levelFilter)) {
					// Levels get their own lanes, so each band reads as a kind.
					if (subGroups.length > 0) {
						const lane = container.createDiv({ cls: "tr-level-lane" });
						lane.createDiv({
							cls: "tr-level-lane-label",
							text: LEVEL_LABELS.sub,
						});
						const field = lane.createDiv({ cls: "tr-group-members" });
						for (const child of subGroups) {
							this.renderNested(field, child, depth, ancestors);
						}
					}
					if (plain.length > 0) {
						const lane = container.createDiv({ cls: "tr-level-lane" });
						lane.createDiv({
							cls: "tr-level-lane-label",
							text: LEVEL_LABELS.simple,
						});
						const field = lane.createDiv({ cls: "tr-group-members" });
						for (const child of plain) this.renderTag(field, child, depth + 1, tag);
					}
				} else {
					for (const child of subGroups) {
						this.renderNested(field(container), child, depth, ancestors);
					}
					if (plain.length > 0) {
						const area = container.createDiv({ cls: "tr-group-members" });
						for (const child of plain) this.renderTag(area, child, depth + 1, tag);
					}
				}

				if (children.length === 0) {
					container.createDiv({
						cls: "tr-group-empty",
						text: "Empty — add tags from a tag's right-click menu.",
					});
				}
			},
			level
		);
	}

	/** A sub-group inside its parent, guarding against a hand-made cycle. */
	private renderNested(
		parent: HTMLElement,
		tag: string,
		depth: number,
		ancestors: Set<string>
	): void {
		if (ancestors.has(tag)) {
			parent.createDiv({
				cls: "tr-group-empty",
				text: `${tagLabel(tag)} (already shown above)`,
			});
			return;
		}
		this.renderGroup(
			parent,
			tag,
			depth + 1,
			new Set([...ancestors, tag])
		);
	}

	/**
	 * One collapsible block. `tag` is null for the synthetic Ungrouped
	 * section, which has a header but no tag behaviour.
	 */
	private renderSection(
		parent: HTMLElement,
		tag: string | null,
		label: string,
		depth: number,
		fill: (container: HTMLElement) => void,
		level?: TagLevel
	): void {
		const { host } = this;
		const section = parent.createDiv({ cls: "tr-group-section" });
		section.style.setProperty("--tr-depth", String(depth));

		const collapsed = tag !== null && host.isGroupCollapsed(tag);
		const header = section.createDiv({ cls: "tr-group-header" });

		const twisty = header.createSpan({ cls: "tr-twisty" });
		setIcon(twisty, "chevron-right");
		twisty.toggleClass("is-open", !collapsed);
		twisty.addEventListener("click", (event) => {
			event.stopPropagation();
			if (tag) host.toggleGroupCollapsed(tag);
		});

		if (tag && level && this.renaming === tag) {
			const nameField = header.createSpan({ cls: "tr-group-name-input-wrap" });
			this.renderRenameInput(nameField, tag);
			return;
		}
		const name = header.createSpan({ cls: "tr-group-name", text: label });
		if (tag && level) {
			applyLevelStyle(name, level, host.levelStyles);
			name.toggleClass("is-selected", host.isSelected(tag));
			setTooltip(
				name,
				`${LEVEL_LABELS[level]} · ${host.groups.childrenOf(tag).length} member${
					host.groups.childrenOf(tag).length === 1 ? "" : "s"
				} · ${host.graph.countOf(tag)} note${
					host.graph.countOf(tag) === 1 ? "" : "s"
				}`,
				{ placement: "top" }
			);
			name.addEventListener("click", (event) => {
				event.stopPropagation();
				host.selectFromEvent(tag, event);
			});
			name.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				host.openContextMenu(tag, event);
			});

			const add = header.createSpan({ cls: "tr-group-add" });
			setIcon(add, "plus");
			setTooltip(add, `Add a tag to ${tagLabel(tag)}`, { placement: "top" });
			add.addEventListener("click", (event) => {
				event.stopPropagation();
				host.promptAddToGroup(tag);
			});

			if (host.editMode) {
				const edit = header.createSpan({ cls: "tr-group-edit" });
				setIcon(edit, "pencil");
				setTooltip(edit, `Rename ${tagLabel(tag)}`, { placement: "top" });
				edit.addEventListener("click", (event) => {
					event.stopPropagation();
					this.renaming = tag;
					this.render();
				});
			}
		}

		header.addEventListener("click", () => {
			if (tag) host.toggleGroupCollapsed(tag);
		});

		if (collapsed) return;
		fill(section.createDiv({ cls: "tr-group-body" }));
	}

	/**
	 * `within`, when given, is the specific group this pill is rendered
	 * inside — so a hover-revealed remove button can detach exactly that
	 * membership without a submenu, even though the tag may belong to other
	 * groups too. Omitted for the Ungrouped section, which has no membership
	 * to remove.
	 */
	private renderTag(
		parent: HTMLElement,
		tag: string,
		depth: number,
		within?: string
	): HTMLElement {
		const { host } = this;
		const level = host.levelOf(tag);
		const count = host.graph.countOf(tag);

		const pill = parent.createSpan({ cls: "tr-pill tr-group-pill" });
		applyLevelStyle(pill, level, host.levelStyles);
		const size =
			host.settings.cloudMinFontSize +
			(host.settings.cloudMaxFontSize - host.settings.cloudMinFontSize) *
				scaleByCount(count, host.graph.maxCount);
		pill.style.fontSize = size.toFixed(1) + "px";

		if (this.renaming === tag) {
			this.renderRenameInput(pill, tag);
			return pill;
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

		pill.toggleClass("is-selected", host.isSelected(tag));
		pill.toggleClass(
			"is-related",
			!host.isSelected(tag) && host.isRelatedToSelection(tag)
		);
		pill.toggleClass("is-pinned", host.isPinned(tag));

		if (within) {
			const remove = pill.createSpan({ cls: "tr-group-pill-remove" });
			setIcon(remove, "x");
			setTooltip(remove, `Take out of ${tagLabel(within)}`, { placement: "top" });
			remove.addEventListener("click", (event) => {
				event.stopPropagation();
				host.removeFromGroup(within, tag);
			});
		}

		setTooltip(
			pill,
			`${tag} — ${count} note${count === 1 ? "" : "s"}${
				level === "simple" ? "" : ` · ${LEVEL_LABELS[level]}`
			}`,
			{ placement: "top" }
		);
		pill.addEventListener("click", (event) => {
			event.stopPropagation();
			host.selectFromEvent(tag, event);
		});
		pill.addEventListener("dblclick", (event) => {
			event.preventDefault();
			host.openTagSearch(tag);
		});
		pill.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			host.openContextMenu(tag, event);
		});
		return pill;
	}

	private renderRenameInput(container: HTMLElement, tag: string): void {
		attachRenameInput(
			container,
			tag,
			(next) => {
				this.renaming = null;
				this.render();
				this.host.renameInline(tag, next);
			},
			() => {
				this.renaming = null;
				this.render();
			}
		);
	}

	private renderEmpty(body: HTMLElement): void {
		body.createDiv({
			cls: "tr-empty",
			text: this.host.filter
				? "No groups or tags match this filter."
				: "No tags found in this vault yet.",
		});
	}

	private renderHint(body: HTMLElement): void {
		const hint = body.createDiv({ cls: "tr-groups-hint" });
		hint.createDiv({
			text: "No groups yet. A group is just a tag that holds other tags.",
		});
		hint.createDiv({
			cls: "tr-groups-hint-detail",
			text: "Right-click any tag and choose “Put a tag inside this one”. A tag can belong to as many groups as you like, and groups go three levels deep: group → sub-group → tag.",
		});
	}
}

/**
 * How one group's children split into sub-tags and plain tags, given which
 * levels are currently visible.
 *
 * When sub-tags are hidden, their members would otherwise vanish along with
 * them — by the three-level invariant (ADR 0008) a sub-tag holds only plain
 * tags, so flattening those members up into the parent's own plain list
 * loses no structure. Only the intermediate sub-tag node stops being drawn.
 */
export function visibleGroupChildren(
	groups: TagGroups,
	parent: string,
	levels: Set<TagLevel>
): { subGroups: string[]; plain: string[] } {
	const children = groups.childrenOf(parent);
	const allSubGroups = children.filter((child) => groups.isGroup(child));
	const subGroups = levels.has("sub") ? allSubGroups : [];
	const plain = children.filter(
		(child) => !groups.isGroup(child) && levels.has("simple")
	);
	if (!levels.has("sub") && levels.has("simple")) {
		for (const subGroup of allSubGroups) {
			for (const grandchild of groups.childrenOf(subGroup)) {
				if (!plain.includes(grandchild)) plain.push(grandchild);
			}
		}
	}
	return { subGroups, plain };
}

/** Container for nested sub-group sections in the un-separated layout. */
function field(container: HTMLElement): HTMLElement {
	let nested = container.querySelector<HTMLElement>(":scope > .tr-group-nested");
	if (!nested) nested = container.createDiv({ cls: "tr-group-nested" });
	return nested;
}

/** Levels in draw order, re-exported so the view shell can label lanes. */
export { orderedLevels };
