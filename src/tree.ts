import { setIcon, setTooltip } from "obsidian";
import { ModeRenderer, ViewHost } from "./host";
import { TagGraph, tagLabel } from "./graph";

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

		if (host.selection.length === 0) {
			this.container.createDiv({
				cls: "tr-tree-hint",
				text: "Pick a tag to grow the tree from it. Showing the most connected tags:",
			});
		}

		const list = this.container.createDiv({ cls: "tr-tree-list" });
		for (const tag of roots) {
			this.renderNode(list, [tag], 0);
		}
	}

	private roots(): string[] {
		const { host } = this;
		// Every selected tag becomes its own root, so a multi-tag selection
		// grows one tree per tag rather than merging into an arbitrary root.
		if (host.selection.length > 0) return host.selection.slice();
		const visible = host.visibleTags();
		// No selection yet: offer the best entry points — the most connected tags.
		return visible
			.slice()
			.sort(
				(a, b) =>
					host.graph.neighbors(b).length - host.graph.neighbors(a).length ||
					host.graph.countOf(b) - host.graph.countOf(a) ||
					a.localeCompare(b)
			)
			.slice(0, 20);
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
					? `Manual connection${edge.label ? ` — ${edge.label}` : ""}`
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

/** Shared inline-rename field, mirroring the cloud's behaviour. */
function attachRenameInput(
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
