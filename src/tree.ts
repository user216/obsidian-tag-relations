import { setIcon, setTooltip } from "obsidian";
import {
	ModeRenderer,
	ViewHost,
	attachRenameInput,
	renderBandHeader,
} from "./host";
import { TagGraph, tagLabel } from "./graph";
import { splitIntoBands } from "./bands";

/**
 * A relation tree, the way TheBrain unfolds a thought: the selected tag is the
 * root, its strongest relations become branches, and expanding a branch walks
 * one hop further out. A tag never repeats inside its own ancestor path, so
 * the walk always moves outward instead of bouncing between two tags.
 */
export class TreeRenderer implements ModeRenderer {
	private container: HTMLElement;
	private host: ViewHost;
	/** Expansion is keyed by full path, so the same tag can be open in one
	 *  branch and closed in another. */
	private expanded = new Set<string>();
	/** Which root set the current expansion state belongs to. */
	private lastRootsKey: string | null = null;
	/** Path key of the row being renamed in place, if any. */
	private renaming: string | null = null;

	constructor(container: HTMLElement, host: ViewHost) {
		this.host = host;
		this.container = container.createDiv({ cls: "tr-tree" });
	}

	destroy(): void {
		this.container.remove();
	}

	render(): void {
		const { host } = this;
		this.container.empty();

		const roots = this.roots();
		if (roots.length === 0) {
			this.container.createDiv({
				cls: "tr-empty",
				text: host.filter
					? "No tags match this filter."
					: "No tags found in this vault yet.",
			});
			return;
		}

		// Re-seed expansion whenever the root set changes, so a new selection
		// opens at the configured depth instead of inheriting stale branches.
		const rootsKey = roots.join(" | ");
		if (rootsKey !== this.lastRootsKey) {
			this.lastRootsKey = rootsKey;
			this.expanded.clear();
			if (host.selection.length > 0) {
				for (const root of roots) {
					this.autoExpand([root], host.settings.treeAutoExpandDepth);
				}
			}
		}

		const pinnedRoots = host.settings.pinnedTags.filter((tag) =>
			host.graph.nodes.has(tag)
		);
		if (host.selection.length === 0) {
			this.container.createDiv({
				cls: "tr-tree-hint",
				text:
					pinnedRoots.length > 0
						? "Pinned tags first, then every other tag. Pick one to grow the tree from it."
						: "Every tag. Pick one to grow the tree from it.",
			});
		}

		const list = this.container.createDiv({ cls: "tr-tree-list" });
		// With a selection the roots are the selection, so banding them would
		// be noise; the bands are for the full index.
		if (host.selection.length > 0) {
			for (const tag of roots) this.renderNode(list, [tag], 0);
			return;
		}
		const bands = splitIntoBands(roots, {
			pinned: host.settings.pinnedTags,
			bookmarked: host.bookmarkedTags(),
			showPinned: host.settings.showPinnedBand,
			showBookmarked: host.settings.showBookmarkedBand,
			bookmarkedPosition: host.settings.bookmarkedBandPosition,
		});
		for (const band of bands) {
			// The unlabelled single band is the whole list; there is nothing
			// to fold it away from, so it gets no heading and no twisty.
			const foldable = band.label !== "" && band.id !== "rest";
			const collapsed = foldable && host.isBandCollapsed(band.id);
			if (band.label) {
				if (foldable) {
					renderBandHeader(list, {
						cls: "tr-band-label",
						label: band.label,
						count: band.tags.length,
						collapsed,
						onToggle: () => host.toggleBandCollapsed(band.id),
					});
				} else {
					list.createDiv({
						cls: "tr-band-label",
						text: `${band.label} (${band.tags.length})`,
					});
				}
			}
			if (collapsed) continue;
			const body = list.createDiv({ cls: "tr-band-body" });
			for (const tag of band.tags) this.renderNode(body, [tag], 0);
		}
	}

	private roots(): string[] {
		const { host } = this;
		return treeRoots({
			selection: host.selection,
			pinned: host.settings.pinnedTags.filter((tag) =>
				host.graph.nodes.has(tag)
			),
			visible: host.visibleTags(),
		});
	}

	private autoExpand(path: string[], remaining: number): void {
		if (remaining <= 0) return;
		this.expanded.add(pathKey(path));
		for (const child of this.childrenOf(path)) {
			this.autoExpand(path.concat(child), remaining - 1);
		}
	}

	private childrenOf(path: string[]): string[] {
		return branchChildren(
			this.host.graph,
			path,
			this.host.settings.treeMaxChildren
		);
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

	private renderNode(parent: HTMLElement, path: string[], depth: number): void {
		const { host } = this;
		const tag = path[path.length - 1];
		const key = pathKey(path);
		const children = this.childrenOf(path);
		const isOpen = this.expanded.has(key);

		const wrapper = parent.createDiv({ cls: "tr-tree-node" });
		const row = wrapper.createDiv({ cls: "tr-tree-row" });
		row.style.paddingLeft = depth * 18 + "px";

		const twisty = row.createSpan({ cls: "tr-twisty" });
		if (children.length > 0) {
			setIcon(twisty, "chevron-right");
			twisty.toggleClass("is-open", isOpen);
			twisty.addEventListener("click", (event) => {
				event.stopPropagation();
				if (isOpen) this.expanded.delete(key);
				else this.expanded.add(key);
				this.render();
			});
		} else {
			twisty.addClass("is-leaf");
		}

		const edge =
			path.length > 1
				? host.graph.edgeBetween(path[path.length - 2], tag)
				: undefined;

		const label = row.createSpan({ cls: "tr-tree-label" });
		if (this.renaming === key) {
			this.renderRenameInput(label, tag);
			return;
		}
		label.createSpan({ cls: "tr-tree-name", text: tagLabel(tag) });
		label.createSpan({
			cls: "tr-tree-count",
			text: String(host.graph.countOf(tag)),
		});
		if (host.editMode) {
			const edit = label.createSpan({ cls: "tr-tree-edit" });
			setIcon(edit, "pencil");
			setTooltip(edit, `Rename ${tagLabel(tag)}`, { placement: "top" });
			edit.addEventListener("click", (event) => {
				event.stopPropagation();
				this.renaming = key;
				this.render();
			});
		}
		if (edge) {
			const bar = label.createSpan({ cls: "tr-strength-bar" });
			bar.style.setProperty("--tr-strength", edge.weight.toFixed(3));
			bar.toggleClass("is-manual", edge.manual);
			setTooltip(
				bar,
				edge.manual
					? `Horizontal link${edge.label ? ` — ${edge.label}` : ""}`
					: `${Math.round(edge.weight * 100)}% related · ${edge.cooccur} shared note${
							edge.cooccur === 1 ? "" : "s"
					  }`,
				{ placement: "top" }
			);
		}

		row.toggleClass("is-root", depth === 0);
		row.toggleClass("is-selected", host.isSelected(tag));

		label.addEventListener("click", (event) => {
			event.stopPropagation();
			host.selectFromEvent(tag, event);
		});
		row.addEventListener("dblclick", (event) => {
			event.preventDefault();
			host.openTagSearch(tag);
		});
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			host.openContextMenu(tag, event);
		});

		if (isOpen && children.length > 0) {
			const childList = wrapper.createDiv({ cls: "tr-tree-children" });
			for (const child of children) {
				this.renderNode(childList, path.concat(child), depth + 1);
			}
		}
	}
}

export interface TreeRootOptions {
	selection: string[];
	pinned: string[];
	/** Every tag passing the filter, already in the chosen sort order. */
	visible: string[];
}

/**
 * Which tags the tree grows from.
 *
 * Pinned tags lead, always — a pin means "keep this to hand". Everything else
 * still follows, because the tree is an index of the vault and pinning should
 * promote a few tags rather than hide the rest.
 *
 * A selection is the one thing that does narrow the list: picking a tag means
 * "show me this one", so the tree focuses on it (with pins still above, so
 * they stay reachable).
 */
export function treeRoots(options: TreeRootOptions): string[] {
	const roots: string[] = [];
	const seen = new Set<string>();
	const push = (tag: string) => {
		if (seen.has(tag)) return;
		seen.add(tag);
		roots.push(tag);
	};

	for (const tag of options.pinned) push(tag);

	if (options.selection.length > 0) {
		for (const tag of options.selection) push(tag);
		return roots;
	}

	// `visible` already carries the sort chosen in the toolbar, so it is used
	// as-is rather than re-sorted — the tree's root list previously ignored
	// that control entirely.
	for (const tag of options.visible) push(tag);
	return roots;
}

/**
 * The next hop out from the end of `path`: that tag's strongest relations,
 * capped, excluding anything already in the path so a branch always moves
 * outward instead of bouncing between two tags.
 */
export function branchChildren(
	graph: TagGraph,
	path: string[],
	maxChildren: number
): string[] {
	const tag = path[path.length - 1];
	const ancestors = new Set(path);
	const children: string[] = [];
	for (const edge of graph.neighbors(tag)) {
		// Checked before pushing, so a cap of 0 yields nothing.
		if (children.length >= maxChildren) break;
		const other = edge.a === tag ? edge.b : edge.a;
		if (ancestors.has(other)) continue;
		children.push(other);
	}
	return children;
}

function pathKey(path: string[]): string {
	return path.join(" > ");
}
