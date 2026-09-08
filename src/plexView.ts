import { Menu, TFile, setIcon, setTooltip } from "obsidian";
import {
	ModeRenderer,
	ViewHost,
	applyLevelStyle,
	attachRenameInput,
	hasToggleModifier,
	noteFolder,
	noteName,
	openNote,
	pillFontSize,
} from "./host";
import { tagLabel } from "./graph";
import { MAX_EXCERPT_LINES, excerptLines } from "./excerpt";
import { levelCss, visibleLevels } from "./levels";
import { PanZoom } from "./panzoom";
import {
	PLEX_DEPTH_LABELS,
	PlexDepth,
	PlexLayout,
	PlexRow,
	PlexSideBand,
	buildPlex,
	previewNotes,
	startingTag,
} from "./plex";

/**
 * The plex renderer.
 *
 * DOM rather than canvas, deliberately. The tags here are the same pills as
 * everywhere else — they rename in place, open the same context menu, carry
 * the same pin and bookmark marks — and reimplementing all of that against a
 * canvas would be a second copy of behaviour that has already been got right
 * once. The mind-map is canvas because it simulates hundreds of nodes; a plex
 * shows one neighbourhood, so the browser can lay it out.
 *
 * The connectors are one SVG layer behind the rows, drawn from measured
 * positions after layout, so the lines always meet the pills they belong to
 * however the text wrapped.
 */
export class PlexRenderer implements ModeRenderer {
	private host: ViewHost;
	private root: HTMLElement;
	private panzoom: PanZoom;
	private renaming: string | null = null;
	/** Which tag was centred last, so a walk can be told from a redraw. */
	private lastActive: string | null = null;
	/**
	 * Note openings already read, keyed by path and stamped with the file's
	 * modification time — a note edited outside this view must not keep
	 * showing the text it had when it was first previewed.
	 */
	private excerpts = new Map<string, { mtime: number; lines: string[] }>();
	/** Bumped every render, so a late read knows it is stale. */
	private excerptToken = 0;

	constructor(container: HTMLElement, host: ViewHost) {
		this.host = host;
		this.root = container.createDiv({ cls: "tr-plex" });
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
		const { host } = this;
		const body = this.panzoom.content;

		const active = startingTag({
			selection: host.selection,
			pinned: host.settings.pinnedTags,
			visible: host.visibleTags(),
			degreeOf: (tag) => host.graph.neighbors(tag).length,
		});

		if (!active) {
			body.empty();
			body.createDiv({
				cls: "tr-empty",
				text: host.filter
					? "No tags match this filter."
					: "No tags found in this vault yet.",
			});
			this.lastActive = null;
			return;
		}

		const before = this.measure();
		const layout = buildPlex({
			active,
			source: this.source(),
			depth: host.settings.plexDepth,
			cap: host.settings.plexRowCap,
		});

		body.empty();
		const stage = body.createDiv({ cls: "tr-plex-stage" });
		const lines = stage.createSvg("svg", { cls: "tr-plex-lines" });

		for (const row of layout.above) this.renderRow(stage, row);
		this.renderMiddle(stage, layout);
		for (const row of layout.below) this.renderRow(stage, row);

		if (host.settings.plexPreviewNotes) this.renderPreview(stage, active);

		if (layout.isolated) {
			stage.createDiv({
				cls: "tr-plex-hint",
				text: `Nothing relates to ${tagLabel(
					active
				)} yet. Right-click it to add a main-tag, a sub-tag or a horizontal link.`,
			});
		}

		// Measured after layout, so the connectors meet the pills wherever the
		// rows happened to wrap.
		window.requestAnimationFrame(() => this.drawConnectors(lines, stage, layout));
		this.animateFrom(before, active);
	}

	/**
	 * The notes carrying the active tag, under the plex.
	 *
	 * Deliberately live rather than a snapshot: the Show notes panel freezes a
	 * result you asked for and flags itself stale when the world moves on,
	 * because bulk edits act on exactly that frozen list. This is the opposite
	 * job — it follows the centre as you walk, so it is never something you
	 * could act on by mistake, and it never claims to be a saved result.
	 */
	private renderPreview(stage: HTMLElement, active: string): void {
		const { host } = this;
		const matches = host.graph.matchNotes([active], "any");
		const preview = previewNotes(
			active,
			matches.map((match) => match.path),
			host.settings.plexPreviewCount
		);

		const panel = stage.createDiv({ cls: "tr-plex-preview" });
		panel.createDiv({ cls: "tr-plex-preview-head", text: preview.heading });
		if (preview.paths.length === 0) return;

		const lines = host.settings.plexPreviewLines;
		const token = ++this.excerptToken;
		const pending: Array<{ path: string; el: HTMLElement }> = [];

		const list = panel.createDiv({ cls: "tr-plex-preview-list" });
		for (const path of preview.paths) {
			const entry = list.createDiv({ cls: "tr-plex-preview-entry" });
			const row = entry.createDiv({ cls: "tr-note-row" });
			row.createSpan({ cls: "tr-note-name", text: noteName(path) });
			const folder = noteFolder(path);
			if (folder) row.createSpan({ cls: "tr-note-folder", text: folder });
			setTooltip(row, `${path}\nClick to open, Ctrl/Cmd-click for a new tab`, {
				placement: "top",
			});
			row.addEventListener("click", (event) => {
				event.stopPropagation();
				openNote(host.app, path, event);
			});

			if (lines <= 0) continue;
			const body = entry.createDiv({ cls: "tr-note-excerpt" });
			body.addEventListener("click", (event) => {
				event.stopPropagation();
				openNote(host.app, path, event);
			});
			const file = host.app.vault.getAbstractFileByPath(path);
			const mtime = file instanceof TFile ? file.stat.mtime : 0;
			const cached = this.excerpts.get(path);
			if (cached && cached.mtime === mtime) {
				this.fillExcerpt(body, cached.lines, lines);
			} else {
				pending.push({ path, el: body });
			}
		}
		if (pending.length > 0) void this.loadExcerpts(pending, lines, token);
		if (preview.hidden > 0) {
			list.createDiv({
				cls: "tr-note-more",
				text: `+ ${preview.hidden} more (raise the count in settings)`,
			});
		}
	}

	private fillExcerpt(el: HTMLElement, lines: string[], count: number): void {
		el.empty();
		const shown = lines.slice(0, count);
		if (shown.length === 0) {
			el.createDiv({ cls: "tr-note-excerpt-empty", text: "(empty note)" });
			return;
		}
		for (const line of shown) el.createDiv({ text: line });
	}

	/**
	 * Read the opening of each previewed note and fill it in.
	 *
	 * Reading is asynchronous while rendering is not, so the rows go up
	 * immediately and the text arrives after. `token` guards against a slow
	 * read landing in a plex that has since walked somewhere else — the reply
	 * to a question nobody is asking any more is dropped rather than painted
	 * over whatever is on screen now.
	 *
	 * Cached by path, and always the full `MAX_EXCERPT_LINES`, so switching
	 * between 3, 5 and 10 lines never touches the vault again.
	 */
	private async loadExcerpts(
		pending: Array<{ path: string; el: HTMLElement }>,
		count: number,
		token: number
	): Promise<void> {
		const { app } = this.host;
		for (const { path, el } of pending) {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			let lines: string[];
			try {
				lines = excerptLines(await app.vault.cachedRead(file), MAX_EXCERPT_LINES);
			} catch {
				// An unreadable note should cost its own row, not the panel.
				continue;
			}
			this.excerpts.set(path, { mtime: file.stat.mtime, lines });
			if (token !== this.excerptToken || !el.isConnected) continue;
			this.fillExcerpt(el, lines, count);
		}
	}

	/** The graph and the group DAG, behind the plex's plain queries. */
	private source() {
		const { host } = this;
		const levels = visibleLevels(host.settings.levelFilter);
		const present = new Set(host.visibleTags());
		return {
			parentsOf: (tag: string) => host.groups.parentsOf(tag),
			childrenOf: (tag: string) => host.groups.childrenOf(tag),
			linkedTo: (tag: string) =>
				host.graph
					.neighbors(tag)
					.filter((edge) => edge.manual)
					.map((edge) => (edge.a === tag ? edge.b : edge.a)),
			sharedWith: (tag: string) =>
				host.graph
					.neighbors(tag)
					// Already strongest-first from the adjacency index. Group
					// edges are excluded: containment is the vertical axis, and
					// repeating it sideways would say the same thing twice.
					.filter((edge) => !edge.manual && edge.cooccur > 0)
					.map((edge) => (edge.a === tag ? edge.b : edge.a)),
			isVisible: (tag: string) =>
				present.has(tag) && levels.has(host.levelOf(tag)),
		};
	}

	private renderRow(stage: HTMLElement, row: PlexRow): void {
		const wrap = stage.createDiv({ cls: `tr-plex-row tr-plex-row-${row.id}` });
		wrap.toggleClass("is-dim", row.dim);
		wrap.createDiv({ cls: "tr-plex-row-label", text: row.label });
		const field = wrap.createDiv({ cls: "tr-plex-field" });
		for (const tag of row.tags) field.appendChild(this.pillFor(tag));
		this.renderOverflow(field, row.hidden);
	}

	private renderMiddle(stage: HTMLElement, layout: PlexLayout): void {
		const middle = stage.createDiv({ cls: "tr-plex-middle" });
		this.renderSide(middle, layout.left);

		const centre = middle.createDiv({ cls: "tr-plex-centre" });
		const pill = this.pillFor(layout.active, true);
		pill.addClass("is-active");
		centre.appendChild(pill);

		this.renderSide(middle, layout.right);
	}

	private renderSide(middle: HTMLElement, band: PlexSideBand): void {
		const wrap = middle.createDiv({
			cls: `tr-plex-side tr-plex-side-${band.id}`,
		});
		if (band.tags.length === 0 && band.hidden === 0) return;
		wrap.createDiv({ cls: "tr-plex-row-label", text: band.label });
		const field = wrap.createDiv({ cls: "tr-plex-field" });
		for (const tag of band.tags) field.appendChild(this.pillFor(tag));
		this.renderOverflow(field, band.hidden);
	}

	/**
	 * The count of what the cap left out. Never silent: a plex that quietly
	 * dropped half a tag's relations would be lying about the shape of the
	 * neighbourhood, which is the only thing it is for.
	 */
	private renderOverflow(field: HTMLElement, hidden: number): void {
		if (hidden <= 0) return;
		const more = field.createSpan({
			cls: "tr-plex-more",
			text: `+${hidden} more`,
		});
		setTooltip(more, "Raise the row limit in Settings → Views → Plex", {
			placement: "top",
		});
	}

	private pillFor(tag: string, isCentre = false): HTMLElement {
		const { host } = this;
		const level = host.levelOf(tag);
		const count = host.graph.countOf(tag);
		const pill = createSpan({ cls: "tr-pill tr-plex-pill" });
		pill.dataset.tag = tag;
		applyLevelStyle(pill, level, host.levelStyles);
		pill.style.fontSize =
			pillFontSize({
				count,
				maxCount: host.graph.maxCount,
				minSize: host.settings.cloudMinFontSize,
				maxSize: host.settings.cloudMaxFontSize,
				levelScale: levelCss(host.levelStyles[level]).fontScale,
				fontScale: host.settings.fontScale,
			}).toFixed(1) + "px";

		if (this.renaming === tag) {
			attachRenameInput(
				pill,
				tag,
				(next) => {
					this.renaming = null;
					host.renameInline(tag, next);
				},
				() => {
					this.renaming = null;
					this.render();
				}
			);
			return pill;
		}

		if (host.isPinned(tag)) {
			const pin = pill.createSpan({ cls: "tr-pill-pin" });
			setIcon(pin, "pin");
		}
		if (host.isBookmarked(tag)) {
			const mark = pill.createSpan({ cls: "tr-pill-pin" });
			setIcon(mark, "bookmark");
		}
		pill.createSpan({ cls: "tr-pill-name", text: tagLabel(tag) });
		pill.createSpan({ cls: "tr-pill-count", text: String(count) });
		pill.toggleClass("is-selected", host.isSelected(tag));

		if (host.editMode) {
			const edit = pill.createSpan({ cls: "tr-tree-edit" });
			setIcon(edit, "pencil");
			setTooltip(edit, `Rename ${tagLabel(tag)}`, { placement: "top" });
			edit.addEventListener("click", (event) => {
				event.stopPropagation();
				this.renaming = tag;
				this.render();
			});
		}

		// A plain click walks: the tag clicked becomes the centre. That is the
		// whole interaction, so it takes the plainest gesture. Modifier-clicks
		// still add to the selection the way they do in every other view, so
		// building a multi-tag selection here works as it does elsewhere.
		pill.addEventListener("click", (event) => {
			event.stopPropagation();
			// Clicking the centre is a no-op, as it is in TheBrain: you are
			// already there. Without this the shared "clicking the only
			// selected tag clears it" rule would empty the selection and send
			// the plex off to some other tag entirely.
			if (isCentre && !hasToggleModifier(event)) return;
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
		return pill;
	}

	// --- Connectors -------------------------------------------------------

	/**
	 * Lines from the centre to every surrounding pill, drawn from measured
	 * geometry rather than assumed positions — rows wrap, and a connector that
	 * pointed at where a pill "should" be would drift as soon as one did.
	 */
	private drawConnectors(
		svg: SVGSVGElement,
		stage: HTMLElement,
		layout: PlexLayout
	): void {
		const centre = stage.querySelector(".tr-plex-centre .tr-pill");
		if (!(centre instanceof HTMLElement)) return;
		const frame = stage.getBoundingClientRect();
		if (frame.width === 0 || frame.height === 0) return;

		svg.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
		svg.setAttribute("width", String(frame.width));
		svg.setAttribute("height", String(frame.height));
		while (svg.firstChild) svg.removeChild(svg.firstChild);

		const anchor = (el: HTMLElement, edge: "top" | "bottom" | "left" | "right") => {
			const rect = el.getBoundingClientRect();
			const x =
				edge === "left"
					? rect.left
					: edge === "right"
					? rect.right
					: rect.left + rect.width / 2;
			const y =
				edge === "top"
					? rect.top
					: edge === "bottom"
					? rect.bottom
					: rect.top + rect.height / 2;
			return { x: x - frame.left, y: y - frame.top };
		};

		const connect = (
			tag: string,
			from: { x: number; y: number },
			to: { x: number; y: number },
			cls: string
		) => {
			const pill = stage.querySelector(
				`.tr-plex-field .tr-pill[data-tag="${cssEscape(tag)}"]`
			);
			if (!(pill instanceof HTMLElement)) return;
			const path = svg.createSvg("path", { cls: `tr-plex-line ${cls}` });
			// A gentle curve rather than a straight line: with a dozen
			// connectors leaving one point, curves stay tellable apart where
			// a fan of straight lines becomes a blur.
			const midY = (from.y + to.y) / 2;
			const midX = (from.x + to.x) / 2;
			const d =
				cls === "is-vertical"
					? `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`
					: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
			path.setAttribute("d", d);
		};

		for (const row of layout.above) {
			for (const tag of row.tags) {
				const pill = this.pillEl(stage, tag);
				if (pill) {
					connect(tag, anchor(centre, "top"), anchor(pill, "bottom"), "is-vertical");
				}
			}
		}
		for (const row of layout.below) {
			for (const tag of row.tags) {
				const pill = this.pillEl(stage, tag);
				if (pill) {
					connect(tag, anchor(centre, "bottom"), anchor(pill, "top"), "is-vertical");
				}
			}
		}
		for (const tag of layout.left.tags) {
			const pill = this.pillEl(stage, tag);
			if (pill) {
				connect(tag, anchor(centre, "left"), anchor(pill, "right"), "is-shared");
			}
		}
		for (const tag of layout.right.tags) {
			const pill = this.pillEl(stage, tag);
			if (pill) {
				connect(tag, anchor(centre, "right"), anchor(pill, "left"), "is-linked");
			}
		}
	}

	private pillEl(stage: HTMLElement, tag: string): HTMLElement | null {
		const pill = stage.querySelector(
			`.tr-plex-field .tr-pill[data-tag="${cssEscape(tag)}"]`
		);
		return pill instanceof HTMLElement ? pill : null;
	}

	// --- Walking animation ------------------------------------------------

	private measure(): Map<string, DOMRect> {
		const rects = new Map<string, DOMRect>();
		for (const el of Array.from(
			this.panzoom.content.querySelectorAll(".tr-pill[data-tag]")
		)) {
			if (!(el instanceof HTMLElement) || !el.dataset.tag) continue;
			rects.set(el.dataset.tag, el.getBoundingClientRect());
		}
		return rects;
	}

	/**
	 * FLIP the pills that survived the walk, so a tag clicked in the children
	 * row visibly travels to the centre rather than the whole plex blinking.
	 * That continuity is what makes stepping through a graph feel like moving
	 * rather than like loading pages.
	 */
	private animateFrom(before: Map<string, DOMRect>, active: string): void {
		const changed = this.lastActive !== active;
		this.lastActive = active;
		if (!changed || before.size === 0) return;
		if (!this.host.settings.animateRegroup) return;

		for (const el of Array.from(
			this.panzoom.content.querySelectorAll(".tr-pill[data-tag]")
		)) {
			if (!(el instanceof HTMLElement) || !el.dataset.tag) continue;
			const from = before.get(el.dataset.tag);
			if (!from) continue;
			const to = el.getBoundingClientRect();
			// Measured in screen pixels while the pill sits inside the scaled
			// pan-zoom layer, so the delta is divided back out.
			const scale = this.panzoom.scale || 1;
			const dx = (from.left - to.left) / scale;
			const dy = (from.top - to.top) / scale;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
			el.style.transition = "none";
			el.style.transform = `translate(${dx}px, ${dy}px)`;
			window.requestAnimationFrame(() => {
				el.style.transition = "transform 240ms ease";
				el.style.transform = "";
			});
		}
	}
}

/**
 * A depth menu for the toolbar. Kept here so the plex owns its own control
 * rather than the view shell knowing what a plex depth is.
 */
export function plexDepthMenu(
	event: MouseEvent,
	current: PlexDepth,
	onPick: (depth: PlexDepth) => void
): void {
	const menu = new Menu();
	for (const depth of ["immediate", "siblings", "extended"] as PlexDepth[]) {
		menu.addItem((item) =>
			item
				.setTitle(PLEX_DEPTH_LABELS[depth])
				.setChecked(current === depth)
				.onClick(() => onPick(depth))
		);
	}
	menu.showAtMouseEvent(event);
}

/** CSS.escape is not in every environment Obsidian runs on. */
function cssEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}
