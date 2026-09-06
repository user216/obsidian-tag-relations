import { setIcon, setTooltip } from "obsidian";
import { ModeRenderer, ViewHost, scaleByCount } from "./host";
import { TagEdge, tagLabel } from "./graph";

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
		const selected = host.selected;

		let ordered: Array<{ tag: string; hop: number }>;
		if (selected && host.graph.node(selected)) {
			const reach = host.graph.neighborhood([selected], settings.mapDepth);
			ordered = [];
			for (const [tag, hop] of reach) {
				if (hop === 0 || pool.has(tag)) ordered.push({ tag, hop });
			}
			ordered.sort(
				(a, b) =>
					a.hop - b.hop ||
					host.graph.countOf(b.tag) - host.graph.countOf(a.tag) ||
					a.tag.localeCompare(b.tag)
			);
		} else {
			ordered = Array.from(pool)
				.sort(
					(a, b) =>
						host.graph.countOf(b) - host.graph.countOf(a) || a.localeCompare(b)
				)
				.map((tag) => ({ tag, hop: 1 }));
		}

		if (ordered.length > settings.mapMaxNodes) {
			ordered = ordered.slice(0, settings.mapMaxNodes);
		}

		const live = new Set(ordered.map((entry) => entry.tag));
		for (const tag of Array.from(this.particles.keys())) {
			if (!live.has(tag)) this.particles.delete(tag);
		}

		this.neighborsOfSelected = new Set(
			selected ? host.graph.relatedTags(selected) : []
		);

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
			particle.pinned = hop === 0;
			if (particle.pinned) {
				particle.x = 0;
				particle.y = 0;
				particle.vx = 0;
				particle.vy = 0;
			}
			this.active.push(particle);
		}

		this.edges = [];
		for (const edge of this.host.graph.edges.values()) {
			if (live.has(edge.a) && live.has(edge.b)) this.edges.push(edge);
		}

		if (selected) this.cam.x = this.cam.y = 0;
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
		const selected = this.host.selected;

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

		const highlightTag = this.hovered?.tag ?? selected;

		for (const edge of this.edges) {
			const a = this.particles.get(edge.a);
			const b = this.particles.get(edge.b);
			if (!a || !b) continue;
			const touchesFocus =
				highlightTag !== null &&
				(edge.a === highlightTag || edge.b === highlightTag);

			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.lineWidth = (0.6 + edge.weight * 2.2) / scale + (touchesFocus ? 1 / scale : 0);
			ctx.globalAlpha = highlightTag
				? touchesFocus
					? 0.35 + edge.weight * 0.65
					: 0.08
				: 0.18 + edge.weight * 0.5;
			if (edge.manual) {
				ctx.setLineDash([6 / scale, 4 / scale]);
				ctx.strokeStyle = palette.accent;
			} else {
				ctx.setLineDash([]);
				ctx.strokeStyle = touchesFocus ? palette.lineStrong : palette.line;
			}
			ctx.stroke();
		}
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;

		for (const p of this.active) {
			const isSelected = p.tag === selected;
			const isNeighbor = this.neighborsOfSelected.has(p.tag);
			const isHovered = this.hovered === p;
			const dimmed = selected !== null && !isSelected && !isNeighbor;

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
			}
			ctx.globalAlpha = 1;
		}

		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (const p of this.active) {
			const isSelected = p.tag === selected;
			const isNeighbor = this.neighborsOfSelected.has(p.tag);
			const isHovered = this.hovered === p;
			const showLabel =
				this.host.settings.mapShowAllLabels ||
				isSelected ||
				isHovered ||
				isNeighbor ||
				p.r > 9 ||
				this.active.length <= 40;
			if (!showLabel) continue;

			const size = (isSelected ? 14 : 12) / scale;
			ctx.font = `${isSelected ? "600 " : ""}${size}px ${FONT_STACK}`;
			ctx.globalAlpha = selected !== null && !isSelected && !isNeighbor ? 0.35 : 1;
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
		const selected = this.host.selected;
		if (selected && selected !== p.tag) {
			const edge = this.host.graph.edgeBetween(selected, p.tag);
			if (edge) {
				lines.push(
					edge.manual
						? `Manually connected to ${selected}`
						: `${Math.round(edge.weight * 100)}% related to ${selected}`
				);
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
		if (wasDragging) this.host.select(wasDragging.tag);
		else if (this.host.selected) this.host.select(null);
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
