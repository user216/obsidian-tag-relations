import { setIcon, setTooltip } from "obsidian";
import { ModeRenderer, ViewHost, describeRelation, scaleByCount } from "./host";
import { clampFontScale } from "./fontZoom";
import { TagEdge, TagGraph, tagLabel } from "./graph";

interface Particle {
	tag: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Draw radius in world units. */
	r: number;
	/** Hops from the selected tag; 0 when it is the selection. */
	hop: number;
	mass: number;
	pinned: boolean;
}

interface Palette {
	background: string;
	line: string;
	lineStrong: string;
	accent: string;
	node: string;
	nodeMuted: string;
	text: string;
	textMuted: string;
}

const MIN_ALPHA = 0.008;
const MAX_SPEED = 30;

/**
 * The mind-map: a force-directed layout of the tag graph on a canvas.
 * Selecting a tag pins it at the centre and lays its relations out around it,
 * so the map re-forms around whatever you are looking at.
 */
export class MapRenderer implements ModeRenderer {
	private host: ViewHost;
	private root: HTMLElement;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null;
	private resizeObserver: ResizeObserver;

	private particles = new Map<string, Particle>();
	private active: Particle[] = [];
	private edges: TagEdge[] = [];
	private neighborsOfSelected = new Set<string>();

	private cam = { x: 0, y: 0, scale: 1 };
	private alpha = 1;
	private frame = 0;
	private width = 0;
	private height = 0;

	private hovered: Particle | null = null;
	private dragging: Particle | null = null;
	private panning = false;
	private pointerMoved = false;
	private lastPointer = { x: 0, y: 0 };
	private palette: Palette | null = null;
	/** Tags left out by the node cap in whole-vault mode, for the notice. */
	private truncated = 0;
	/** Reserved rows for pinned and bookmarked tags. */
	private bands: BandRow[] = [];

	constructor(container: HTMLElement, host: ViewHost) {
		this.host = host;
		this.root = container.createDiv({ cls: "tr-map" });
		this.canvas = this.root.createEl("canvas", { cls: "tr-map-canvas" });
		this.ctx = this.canvas.getContext("2d");
		this.buildControls();

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.root);

		this.canvas.addEventListener("pointerdown", this.onPointerDown);
		this.canvas.addEventListener("pointermove", this.onPointerMove);
		this.canvas.addEventListener("pointerup", this.onPointerUp);
		this.canvas.addEventListener("pointerleave", this.onPointerLeave);
		this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
		this.canvas.addEventListener("dblclick", this.onDoubleClick);
		this.canvas.addEventListener("contextmenu", this.onContextMenu);
	}

	destroy(): void {
		window.cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		this.root.remove();
	}

	render(): void {
		this.palette = null;
		this.resize();
		this.collectNodes();
		this.kick();
	}

	private buildControls(): void {
		const controls = this.root.createDiv({ cls: "tr-map-controls" });
		const button = (icon: string, tip: string, action: () => void) => {
			const el = controls.createDiv({ cls: "tr-map-button" });
			setIcon(el, icon);
			setTooltip(el, tip, { placement: "left" });
			el.addEventListener("click", action);
		};
		button("zoom-in", "Zoom in", () => this.zoomBy(1.2));
		button("zoom-out", "Zoom out", () => this.zoomBy(1 / 1.2));
		button("maximize", "Fit to view", () => this.fit());
		button("refresh-cw", "Re-run layout", () => {
			for (const p of this.active) {
				if (p.pinned) continue;
				p.x += (Math.random() - 0.5) * 60;
				p.y += (Math.random() - 0.5) * 60;
			}
			this.kick(1);
		});
	}

	/** Decide which tags are on the canvas and seed positions for new ones. */
	private collectNodes(): void {
		const { host } = this;
		const settings = host.settings;
		const pool = new Set(host.visibleTags());
		const selection = host.selection.filter((tag) => host.graph.nodes.has(tag));
		// Whole-vault mode ignores the selection when choosing what to draw, so
		// the map shows every tag and every connection at once. The selection is
		// still anchored and highlighted — it just no longer limits the view.
		const whole = settings.mapWholeVault;
		const ordered = collectMapNodes(
			host.graph,
			pool,
			whole ? [] : selection,
			settings.mapDepth,
			whole ? Math.max(settings.mapMaxNodes, Math.min(pool.size, 600)) : settings.mapMaxNodes
		);
		this.truncated = whole ? Math.max(0, pool.size - ordered.length) : 0;

		// A pinned tag is always on the map, whatever the depth limit or the
		// node cap would otherwise have done with it — that is what pinning
		// is for, and dropping it here made pinning look cloud-only.
		withPinned(ordered, host.settings.pinnedTags, host.graph);
		// Bookmarks get the same guarantee: a tag you deliberately kept to
		// hand should not disappear because it fell outside the depth limit.
		if (host.settings.showBookmarkedBand) {
			withPinned(ordered, host.bookmarkedTags(), host.graph);
		}

		const live = new Set(ordered.map((entry) => entry.tag));
		for (const tag of Array.from(this.particles.keys())) {
			if (!live.has(tag)) this.particles.delete(tag);
		}

		this.neighborsOfSelected = new Set(host.graph.relatedToSelection(selection));

		// Pinned and bookmarked tags get their own reserved rows, the map's
		// equivalent of the labelled bands the list views show.
		this.bands = bandRows({
			pinned: settings.pinnedTags.filter((tag) => host.graph.nodes.has(tag)),
			bookmarked: host
				.bookmarkedTags()
				.filter((tag) => host.graph.nodes.has(tag)),
			linkDistance: settings.mapLinkDistance,
			bookmarkedPosition: settings.bookmarkedBandPosition,
			showPinned: settings.showPinnedBand,
			showBookmarked: settings.showBookmarkedBand,
		});

		// Selected tags are held still so the map re-forms around them, and
		// win over a band row: the selection is the active focus.
		const anchors = bandRowAnchors(this.bands, settings.mapLinkDistance);
		for (const [tag, position] of anchorPositions(
			selection,
			settings.mapLinkDistance
		)) {
			anchors.set(tag, position);
		}

		this.active = [];
		for (const { tag, hop } of ordered) {
			const count = host.graph.countOf(tag);
			const degree = host.graph.neighbors(tag).length;
			const r = 4 + scaleByCount(count, host.graph.maxCount) * 15;
			let particle = this.particles.get(tag);
			if (!particle) {
				// Seed new nodes on a ring whose radius grows with hop distance, so
				// the first frame already resembles the final layout.
				const angle = Math.random() * Math.PI * 2;
				const radius =
					hop === 0 ? 0 : settings.mapLinkDistance * hop * (0.8 + Math.random() * 0.5);
				particle = {
					tag,
					x: Math.cos(angle) * radius,
					y: Math.sin(angle) * radius,
					vx: 0,
					vy: 0,
					r,
					hop,
					mass: 1,
					pinned: false,
				};
				this.particles.set(tag, particle);
			}
			particle.r = r;
			particle.hop = hop;
			// Hubs resist being flung around by their many neighbours.
			particle.mass = 1 + degree * 0.12;
			const anchor = anchors.get(tag);
			particle.pinned = anchor !== undefined;
			if (anchor) {
				particle.x = anchor.x;
				particle.y = anchor.y;
				particle.vx = 0;
				particle.vy = 0;
			}
			this.active.push(particle);
		}

		this.edges = [];
		for (const edge of this.host.graph.edges.values()) {
			if (live.has(edge.a) && live.has(edge.b)) this.edges.push(edge);
		}

		if (selection.length > 0) this.cam.x = this.cam.y = 0;
	}

	private resize(): void {
		const rect = this.root.getBoundingClientRect();
		const width = Math.max(1, Math.floor(rect.width));
		const height = Math.max(1, Math.floor(rect.height));
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.floor(width * dpr);
		this.canvas.height = Math.floor(height * dpr);
		this.canvas.style.width = width + "px";
		this.canvas.style.height = height + "px";
		this.kick(Math.max(this.alpha, 0.2));
	}

	private kick(alpha = 1): void {
		this.alpha = alpha;
		if (!this.frame) this.frame = window.requestAnimationFrame(this.tick);
	}

	private tick = (): void => {
		this.frame = 0;
		if (this.alpha > MIN_ALPHA) {
			this.step();
			this.alpha *= 0.985;
		}
		this.draw();
		if (this.alpha > MIN_ALPHA || this.dragging) {
			this.frame = window.requestAnimationFrame(this.tick);
		}
	};

	private step(): void {
		const settings = this.host.settings;
		const nodes = this.active;
		const alpha = this.alpha;
		const charge = settings.mapCharge;

		// Repulsion between every pair. The node cap keeps this affordable.
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 0.01) {
					dx = (Math.random() - 0.5) * 2;
					dy = (Math.random() - 0.5) * 2;
					d2 = dx * dx + dy * dy + 0.01;
				}
				const d = Math.sqrt(d2);
				const force = (charge * alpha) / d2;
				const fx = (dx / d) * force;
				const fy = (dy / d) * force;
				a.vx -= fx / a.mass;
				a.vy -= fy / a.mass;
				b.vx += fx / b.mass;
				b.vy += fy / b.mass;
			}
		}

		// Springs: a stronger relation pulls the two tags closer together.
		for (const edge of this.edges) {
			const a = this.particles.get(edge.a);
			const b = this.particles.get(edge.b);
			if (!a || !b) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
			const target = settings.mapLinkDistance * (1.4 - edge.weight * 0.8);
			const k = 0.25 * (0.35 + edge.weight * 0.65) * alpha;
			const shift = ((d - target) / d) * k;
			a.vx += (dx * shift) / a.mass;
			a.vy += (dy * shift) / a.mass;
			b.vx -= (dx * shift) / b.mass;
			b.vy -= (dy * shift) / b.mass;
		}

		for (const p of nodes) {
			if (p.pinned || p === this.dragging) {
				p.vx = 0;
				p.vy = 0;
				continue;
			}
			// Gentle pull toward the origin keeps detached clusters on screen.
			p.vx += -p.x * 0.015 * alpha;
			p.vy += -p.y * 0.015 * alpha;
			const speed = Math.hypot(p.vx, p.vy);
			if (speed > MAX_SPEED) {
				p.vx = (p.vx / speed) * MAX_SPEED;
				p.vy = (p.vy / speed) * MAX_SPEED;
			}
			p.x += p.vx;
			p.y += p.vy;
			p.vx *= 0.82;
			p.vy *= 0.82;
		}
	}

	private readPalette(): Palette {
		if (this.palette) return this.palette;
		const style = window.getComputedStyle(this.root);
		const read = (name: string, fallback: string) =>
			style.getPropertyValue(name).trim() || fallback;
		this.palette = {
			background: read("--background-primary", "#1e1e1e"),
			line: read("--background-modifier-border", "#444"),
			lineStrong: read("--text-muted", "#888"),
			accent: read("--interactive-accent", "#7c6cf5"),
			node: read("--text-normal", "#dcddde"),
			nodeMuted: read("--text-faint", "#666"),
			text: read("--text-normal", "#dcddde"),
			textMuted: read("--text-muted", "#999"),
		};
		return this.palette;
	}

	private draw(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const palette = this.readPalette();
		const hasSelection = this.host.selection.length > 0;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, this.width, this.height);

		if (this.active.length === 0) {
			ctx.fillStyle = palette.textMuted;
			ctx.font = "13px " + FONT_STACK;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(
				this.host.filter
					? "No tags match this filter."
					: "No tags found in this vault yet.",
				this.width / 2,
				this.height / 2
			);
			return;
		}

		const { scale } = this.cam;
		const originX = this.width / 2 - this.cam.x * scale;
		const originY = this.height / 2 - this.cam.y * scale;
		ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * originX, dpr * originY);

		// Hovering focuses that one tag; otherwise the whole selection is the focus.
		const focusTags = this.hovered
			? new Set([this.hovered.tag])
			: new Set(this.host.selection);
		const hasFocus = focusTags.size > 0;

		for (const edge of this.edges) {
			const a = this.particles.get(edge.a);
			const b = this.particles.get(edge.b);
			if (!a || !b) continue;
			const touchesFocus = focusTags.has(edge.a) || focusTags.has(edge.b);

			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.lineWidth = (0.6 + edge.weight * 2.2) / scale + (touchesFocus ? 1 / scale : 0);
			ctx.globalAlpha = hasFocus
				? touchesFocus
					? 0.35 + edge.weight * 0.65
					: 0.08
				: 0.18 + edge.weight * 0.5;
			// Containment edges carry their own colour per level pairing, so the
			// group structure is legible inside the relation graph.
			const custom = this.host.settings.connectionColors[edge.kind];
			if (edge.parent) {
				ctx.setLineDash([]);
				ctx.strokeStyle = custom || palette.accent;
				ctx.lineWidth += 0.8 / scale;
			} else if (edge.manual) {
				ctx.setLineDash([6 / scale, 4 / scale]);
				ctx.strokeStyle = custom || palette.accent;
			} else {
				ctx.setLineDash([]);
				ctx.strokeStyle = custom || (touchesFocus ? palette.lineStrong : palette.line);
			}
			ctx.stroke();
		}
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;

		for (const p of this.active) {
			const isSelected = this.host.isSelected(p.tag);
			const isNeighbor = this.neighborsOfSelected.has(p.tag);
			const isHovered = this.hovered === p;
			const isPinned = this.host.isPinned(p.tag);
			const isBookmarked = this.host.isBookmarked(p.tag);
			// Neither a pin nor a bookmark ever dims — both mean "keep this
			// findable", which dimming would directly undo.
			const kept = isPinned || isBookmarked;
			const dimmed = hasSelection && !isSelected && !isNeighbor && !kept;

			ctx.globalAlpha = dimmed ? 0.3 : 1;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fillStyle = isSelected
				? palette.accent
				: isNeighbor
				? palette.node
				: palette.nodeMuted;
			ctx.fill();

			if (isSelected || isHovered) {
				ctx.lineWidth = 2 / scale;
				ctx.strokeStyle = palette.accent;
				ctx.stroke();
			} else if (isPinned || isBookmarked) {
				// A ring rather than a fill, so the marker reads as something
				// attached to the node instead of changing what it means.
				// Solid for a pin, dashed for a bookmark, so the two are
				// distinguishable when a tag carries only one of them.
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r + 3 / scale, 0, Math.PI * 2);
				ctx.lineWidth = 1.5 / scale;
				ctx.strokeStyle = palette.accent;
				ctx.setLineDash(isPinned ? [] : [3 / scale, 3 / scale]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
			ctx.globalAlpha = 1;
		}

		// Band headings, drawn in world space so they travel with their rows.
		if (this.bands.length > 0) {
			ctx.textAlign = "left";
			ctx.textBaseline = "bottom";
			for (const row of this.bands) {
				const spacing = this.host.settings.mapLinkDistance * 0.95;
				const halfWidth = ((row.tags.length - 1) * spacing) / 2;
				const left = -halfWidth - spacing * 0.5;
				const right = halfWidth + spacing * 0.5;

				ctx.globalAlpha = 0.5;
				ctx.strokeStyle = palette.line;
				ctx.setLineDash([4 / scale, 4 / scale]);
				ctx.lineWidth = 1 / scale;
				ctx.beginPath();
				ctx.moveTo(left, row.y + spacing * 0.42);
				ctx.lineTo(right, row.y + spacing * 0.42);
				ctx.stroke();
				ctx.setLineDash([]);

				ctx.globalAlpha = 0.75;
				ctx.fillStyle = palette.textMuted;
				ctx.font = `600 ${11 / scale}px ${FONT_STACK}`;
				ctx.fillText(
					`${row.label} (${row.tags.length})`,
					left,
					row.y - spacing * 0.42
				);
				ctx.globalAlpha = 1;
			}
		}

		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (const p of this.active) {
			const isSelected = this.host.isSelected(p.tag);
			const isNeighbor = this.neighborsOfSelected.has(p.tag);
			const isHovered = this.hovered === p;
			const showLabel =
				this.host.settings.mapShowAllLabels ||
				this.host.isPinned(p.tag) ||
				this.host.isBookmarked(p.tag) ||
				isSelected ||
				isHovered ||
				isNeighbor ||
				p.r > 9 ||
				this.active.length <= 40;
			if (!showLabel) continue;

			// Font zoom applies to canvas labels too, so the map does not stay
			// small while every other view has been scaled up.
			const size =
				((isSelected ? 14 : 12) *
					clampFontScale(this.host.settings.fontScale)) /
				scale;
			ctx.font = `${isSelected ? "600 " : ""}${size}px ${FONT_STACK}`;
			ctx.globalAlpha = hasSelection && !isSelected && !isNeighbor ? 0.35 : 1;
			// A contrasting halo keeps labels readable over edges.
			ctx.lineWidth = 3 / scale;
			ctx.strokeStyle = palette.background;
			ctx.lineJoin = "round";
			const label = tagLabel(p.tag);
			ctx.strokeText(label, p.x, p.y + p.r + 3 / scale);
			ctx.fillStyle = isSelected ? palette.accent : palette.text;
			ctx.fillText(label, p.x, p.y + p.r + 3 / scale);
			ctx.globalAlpha = 1;
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		if (this.truncated > 0) {
			ctx.fillStyle = palette.textMuted;
			ctx.font = "12px " + FONT_STACK;
			ctx.textAlign = "left";
			ctx.textBaseline = "bottom";
			ctx.fillText(
				`Showing ${this.active.length} of ${this.active.length + this.truncated} tags — raise the node cap in settings to see more.`,
				10,
				this.height - 8
			);
		}
	}

	private screenToWorld(sx: number, sy: number): { x: number; y: number } {
		return {
			x: (sx - this.width / 2) / this.cam.scale + this.cam.x,
			y: (sy - this.height / 2) / this.cam.scale + this.cam.y,
		};
	}

	private pointerPos(event: PointerEvent | MouseEvent | WheelEvent): {
		x: number;
		y: number;
	} {
		const rect = this.canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	private hitTest(sx: number, sy: number): Particle | null {
		const world = this.screenToWorld(sx, sy);
		let best: Particle | null = null;
		let bestDist = Infinity;
		for (const p of this.active) {
			const dx = world.x - p.x;
			const dy = world.y - p.y;
			const dist = Math.hypot(dx, dy);
			// A little slack makes small nodes clickable at low zoom.
			const reach = p.r + 6 / this.cam.scale;
			if (dist <= reach && dist < bestDist) {
				best = p;
				bestDist = dist;
			}
		}
		return best;
	}

	private onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		const pos = this.pointerPos(event);
		this.lastPointer = pos;
		this.pointerMoved = false;
		const hit = this.hitTest(pos.x, pos.y);
		if (hit) {
			this.dragging = hit;
			this.kick(Math.max(this.alpha, 0.35));
		} else {
			this.panning = true;
		}
		this.canvas.setPointerCapture(event.pointerId);
	};

	private onPointerMove = (event: PointerEvent): void => {
		const pos = this.pointerPos(event);
		const dx = pos.x - this.lastPointer.x;
		const dy = pos.y - this.lastPointer.y;
		if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.pointerMoved = true;

		if (this.dragging) {
			const world = this.screenToWorld(pos.x, pos.y);
			this.dragging.x = world.x;
			this.dragging.y = world.y;
			this.dragging.vx = 0;
			this.dragging.vy = 0;
			this.lastPointer = pos;
			this.kick(Math.max(this.alpha, 0.35));
			return;
		}
		if (this.panning) {
			this.cam.x -= dx / this.cam.scale;
			this.cam.y -= dy / this.cam.scale;
			this.lastPointer = pos;
			this.kick(this.alpha);
			return;
		}

		this.lastPointer = pos;
		const hit = this.hitTest(pos.x, pos.y);
		if (hit !== this.hovered) {
			this.hovered = hit;
			this.canvas.toggleClass("is-over-node", hit !== null);
			setTooltip(this.canvas, hit ? this.tooltipFor(hit) : "", {
				placement: "top",
			});
			this.kick(this.alpha);
		}
	};

	private tooltipFor(p: Particle): string {
		const count = this.host.graph.countOf(p.tag);
		const degree = this.host.graph.neighbors(p.tag).length;
		const lines = [
			`${p.tag} — ${count} note${count === 1 ? "" : "s"}, ${degree} relation${
				degree === 1 ? "" : "s"
			}`,
		];
		if (this.host.isSelected(p.tag)) {
			lines.push("Selected");
		} else if (this.host.isRelatedToSelection(p.tag)) {
			const strength = this.host.selectionStrength(p.tag);
			const closest = this.host.selection.find(
				(other) => this.host.graph.strength(other, p.tag) === strength
			);
			if (closest) {
				const edge = this.host.graph.edgeBetween(closest, p.tag);
				lines.push(describeRelation(edge, p.tag, closest, strength).long);
			}
		}
		return lines.join("\n");
	}

	private onPointerUp = (event: PointerEvent): void => {
		const wasDragging = this.dragging;
		const moved = this.pointerMoved;
		this.dragging = null;
		this.panning = false;
		if (this.canvas.hasPointerCapture(event.pointerId)) {
			this.canvas.releasePointerCapture(event.pointerId);
		}
		if (moved) return;
		// A press without movement is a click: select the node, or clear.
		if (wasDragging) this.host.selectFromEvent(wasDragging.tag, event);
		else if (this.host.selection.length > 0) this.host.clearSelection();
	};

	private onPointerLeave = (): void => {
		if (this.hovered) {
			this.hovered = null;
			this.canvas.removeClass("is-over-node");
			this.kick(this.alpha);
		}
	};

	private onWheel = (event: WheelEvent): void => {
		event.preventDefault();
		const pos = this.pointerPos(event);
		const before = this.screenToWorld(pos.x, pos.y);
		const factor = Math.exp(-event.deltaY * 0.0015);
		this.zoomTo(this.cam.scale * factor);
		const after = this.screenToWorld(pos.x, pos.y);
		// Keep the world point under the cursor fixed while zooming.
		this.cam.x += before.x - after.x;
		this.cam.y += before.y - after.y;
		this.kick(this.alpha);
	};

	private onDoubleClick = (event: MouseEvent): void => {
		const pos = this.pointerPos(event);
		const hit = this.hitTest(pos.x, pos.y);
		if (hit) {
			event.preventDefault();
			this.host.openTagSearch(hit.tag);
		}
	};

	private onContextMenu = (event: MouseEvent): void => {
		const pos = this.pointerPos(event);
		const hit = this.hitTest(pos.x, pos.y);
		if (!hit) return;
		event.preventDefault();
		this.host.openContextMenu(hit.tag, event);
	};

	private zoomTo(scale: number): void {
		this.cam.scale = Math.min(4, Math.max(0.15, scale));
	}

	private zoomBy(factor: number): void {
		this.zoomTo(this.cam.scale * factor);
		this.kick(this.alpha);
	}

	private fit(): void {
		if (this.active.length === 0) return;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const p of this.active) {
			minX = Math.min(minX, p.x - p.r);
			minY = Math.min(minY, p.y - p.r);
			maxX = Math.max(maxX, p.x + p.r);
			maxY = Math.max(maxY, p.y + p.r);
		}
		const padding = 60;
		const spanX = Math.max(1, maxX - minX);
		const spanY = Math.max(1, maxY - minY);
		this.cam.x = (minX + maxX) / 2;
		this.cam.y = (minY + maxY) / 2;
		this.zoomTo(
			Math.min(
				(this.width - padding) / spanX,
				(this.height - padding) / spanY
			)
		);
		this.kick(this.alpha);
	}
}

const FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';


export interface MapNodeRef {
	tag: string;
	/** Hops from the selection; 0 for a selected tag, 1 when nothing is selected. */
	hop: number;
}

/**
 * Which tags the map draws, and how far each sits from the selection.
 *
 * With a selection, this is the neighbourhood within `depth` hops, filtered to
 * the visible pool (selected tags always survive), nearest first. With no
 * selection it is the most-used tags. Either way the result is capped, so a
 * big vault degrades to its most relevant slice rather than a hairball.
 */
export function collectMapNodes(
	graph: TagGraph,
	pool: Set<string>,
	selection: string[],
	depth: number,
	maxNodes: number
): MapNodeRef[] {
	let ordered: MapNodeRef[];
	if (selection.length > 0) {
		const reach = graph.neighborhood(selection, depth);
		ordered = [];
		for (const [tag, hop] of reach) {
			if (hop === 0 || pool.has(tag)) ordered.push({ tag, hop });
		}
		ordered.sort(
			(a, b) =>
				a.hop - b.hop ||
				graph.countOf(b.tag) - graph.countOf(a.tag) ||
				a.tag.localeCompare(b.tag)
		);
	} else {
		ordered = Array.from(pool)
			.sort(
				(a, b) => graph.countOf(b) - graph.countOf(a) || a.localeCompare(b)
			)
			.map((tag) => ({ tag, hop: 1 }));
	}
	return ordered.length > maxNodes ? ordered.slice(0, maxNodes) : ordered;
}

/**
 * Where selected tags are pinned. One sits at the origin; several share a ring
 * whose radius grows with the count, keeping the focus cluster centred while
 * leaving room for their neighbours outside it.
 */
export function anchorPositions(
	selection: string[],
	linkDistance: number
): Map<string, { x: number; y: number }> {
	const anchors = new Map<string, { x: number; y: number }>();
	if (selection.length === 1) {
		anchors.set(selection[0], { x: 0, y: 0 });
	} else if (selection.length > 1) {
		const radius = linkDistance * 0.45 * Math.sqrt(selection.length);
		selection.forEach((tag, index) => {
			const angle = (index / selection.length) * Math.PI * 2 - Math.PI / 2;
			anchors.set(tag, {
				x: Math.cos(angle) * radius,
				y: Math.sin(angle) * radius,
			});
		});
	}
	return anchors;
}

/**
 * Make sure every pinned tag is in the node list, appending any the depth or
 * cap left out. Mutates in place because the caller owns the array.
 */
export function withPinned(
	nodes: MapNodeRef[],
	pinned: string[],
	graph: TagGraph
): MapNodeRef[] {
	const present = new Set(nodes.map((node) => node.tag));
	for (const tag of pinned) {
		if (present.has(tag) || !graph.nodes.has(tag)) continue;
		present.add(tag);
		nodes.push({ tag, hop: 1 });
	}
	return nodes;
}


export interface BandRow {
	id: "pinned" | "bookmarked";
	label: string;
	tags: string[];
	/** World-space y for the row. */
	y: number;
}

export interface BandRowOptions {
	pinned: string[];
	bookmarked: string[];
	linkDistance: number;
	bookmarkedPosition: "top" | "bottom";
	showPinned: boolean;
	showBookmarked: boolean;
}

/**
 * Where the pinned and bookmarked rows sit on the map.
 *
 * A list can put these in labelled bands; a force-directed graph has no list,
 * so the equivalent is a reserved strip of space. The rows are anchored in
 * world coordinates, which means they pan and zoom with everything else —
 * screen-anchored strips would slide over the graph as you moved it.
 */
export function bandRows(options: BandRowOptions): BandRow[] {
	const gap = options.linkDistance * 1.6;
	const rows: BandRow[] = [];

	// Precedence matches the list bands: a tag that is both belongs to pinned.
	const pinnedSet = new Set(options.showPinned ? options.pinned : []);
	const pinnedTags = Array.from(pinnedSet);
	const bookmarkedTags = (options.showBookmarked ? options.bookmarked : []).filter(
		(tag) => !pinnedSet.has(tag)
	);

	const above: BandRow[] = [];
	if (pinnedTags.length > 0) {
		above.push({ id: "pinned", label: "Pinned", tags: pinnedTags, y: 0 });
	}
	if (bookmarkedTags.length > 0 && options.bookmarkedPosition === "top") {
		above.push({
			id: "bookmarked",
			label: "Bookmarked",
			tags: bookmarkedTags,
			y: 0,
		});
	}
	// Stack upward so the row nearest the graph is the last one added.
	above.forEach((row, index) => {
		row.y = -gap * (above.length - index + 1.5);
		rows.push(row);
	});

	if (bookmarkedTags.length > 0 && options.bookmarkedPosition === "bottom") {
		rows.push({
			id: "bookmarked",
			label: "Bookmarked",
			tags: bookmarkedTags,
			y: gap * 2.5,
		});
	}
	return rows;
}

/** Evenly spaced positions along each row, centred on the origin. */
export function bandRowAnchors(
	rows: BandRow[],
	linkDistance: number
): Map<string, { x: number; y: number }> {
	const anchors = new Map<string, { x: number; y: number }>();
	const spacing = linkDistance * 0.95;
	for (const row of rows) {
		const width = (row.tags.length - 1) * spacing;
		row.tags.forEach((tag, index) => {
			anchors.set(tag, { x: index * spacing - width / 2, y: row.y });
		});
	}
	return anchors;
}
