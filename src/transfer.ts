import { TagGroups } from "./groups";
import { GroupLink, ManualLink } from "./types";

/**
 * Exporting and importing the relation data — the part of this plugin that is
 * *not* in your notes.
 *
 * Tags and shared-note relations live in the vault and travel with it for
 * free. Horizontal links, group membership and pins live only in the plugin's
 * `data.json`, which is what makes them cheap to reorganise (ADR 0001) and
 * also what makes them easy to leave behind when moving vaults. This module
 * is the answer to that: one portable file.
 */

export const EXPORT_FORMAT = "tag-relations-export";
export const EXPORT_VERSION = 1;

export interface RelationPayload {
	horizontalLinks: ManualLink[];
	groupLinks: GroupLink[];
	pinnedTags: string[];
}

export interface RelationExport extends RelationPayload {
	format: string;
	version: number;
	exportedAt: string;
	pluginVersion: string;
}

export function buildExport(
	payload: RelationPayload,
	pluginVersion: string,
	now = new Date()
): RelationExport {
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: now.toISOString(),
		pluginVersion,
		horizontalLinks: payload.horizontalLinks,
		groupLinks: payload.groupLinks,
		pinnedTags: payload.pinnedTags,
	};
}

export function serializeExport(exported: RelationExport): string {
	// Pretty-printed on purpose: this is a file a person may open, diff, or
	// hand-edit before importing it somewhere else.
	return JSON.stringify(exported, null, "\t") + "\n";
}

export interface ImportParse {
	ok: boolean;
	error?: string;
	payload?: RelationPayload;
	/** Recoverable problems — malformed entries that were dropped. */
	warnings: string[];
}

/**
 * Read an export file. Anything can be handed to this — a truncated file, a
 * different plugin's JSON, a hand-edit that broke — so every field is checked
 * and bad entries are dropped with a warning rather than trusted.
 */
export function parseImport(text: string): ImportParse {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			warnings: [],
			error: `Not valid JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, warnings: [], error: "The file is not an object." };
	}

	const record = raw as Record<string, unknown>;
	if (record.format !== undefined && record.format !== EXPORT_FORMAT) {
		return {
			ok: false,
			warnings: [],
			error: `This is not a Tag Relations export (format: ${String(record.format)}).`,
		};
	}
	if (
		typeof record.version === "number" &&
		record.version > EXPORT_VERSION
	) {
		return {
			ok: false,
			warnings: [],
			error: `That file was written by a newer version of the plugin (format version ${record.version}).`,
		};
	}

	const warnings: string[] = [];
	// "manualLinks" is accepted as an alias so a raw data.json can be imported
	// directly — the internal name differs from the user-facing one.
	const linksRaw = record.horizontalLinks ?? record.manualLinks;
	const horizontalLinks = readLinks(linksRaw, warnings);
	const groupLinks = readGroups(record.groupLinks, warnings);
	const pinnedTags = readTags(record.pinnedTags, warnings);

	if (
		horizontalLinks.length === 0 &&
		groupLinks.length === 0 &&
		pinnedTags.length === 0
	) {
		return {
			ok: false,
			warnings,
			error: "Nothing to import — no horizontal links, groups or pins found.",
		};
	}

	return {
		ok: true,
		warnings,
		payload: { horizontalLinks, groupLinks, pinnedTags },
	};
}

function isTag(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function readLinks(value: unknown, warnings: string[]): ManualLink[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		warnings.push("Horizontal links were not a list and were ignored.");
		return [];
	}
	const links: ManualLink[] = [];
	let dropped = 0;
	for (const entry of value) {
		const link = entry as Record<string, unknown> | null;
		if (!link || !isTag(link.a) || !isTag(link.b) || link.a === link.b) {
			dropped++;
			continue;
		}
		// Only set `label` when there is one, so a file without labels
		// round-trips to exactly itself rather than gaining empty keys.
		const parsed: ManualLink = { a: link.a, b: link.b };
		if (typeof link.label === "string") parsed.label = link.label;
		links.push(parsed);
	}
	if (dropped > 0) {
		warnings.push(`${dropped} horizontal link(s) were malformed and skipped.`);
	}
	return links;
}

function readGroups(value: unknown, warnings: string[]): GroupLink[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		warnings.push("Group links were not a list and were ignored.");
		return [];
	}
	const links: GroupLink[] = [];
	let dropped = 0;
	for (const entry of value) {
		const link = entry as Record<string, unknown> | null;
		if (
			!link ||
			!isTag(link.parent) ||
			!isTag(link.child) ||
			link.parent === link.child
		) {
			dropped++;
			continue;
		}
		links.push({ parent: link.parent, child: link.child });
	}
	if (dropped > 0) {
		warnings.push(`${dropped} group link(s) were malformed and skipped.`);
	}
	return links;
}

function readTags(value: unknown, warnings: string[]): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		warnings.push("Pinned tags were not a list and were ignored.");
		return [];
	}
	return value.filter(isTag);
}

export type MergeMode = "merge" | "replace";

export interface ImportPlan {
	mode: MergeMode;
	addedLinks: number;
	addedGroups: number;
	addedPins: number;
	/** Group links refused because they would break the three-level rule. */
	rejectedGroups: Array<{ link: GroupLink; reason: string }>;
	/** Pins dropped because the cap was reached. */
	droppedPins: number;
	result: RelationPayload;
}

function sameLink(a: ManualLink, b: ManualLink): boolean {
	return (
		(a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a)
	);
}

/**
 * Work out what importing would actually do, without doing it.
 *
 * Group links are added through `TagGroups`, never written straight in, so an
 * imported file cannot introduce a fourth level or a cycle no matter how it
 * was produced — the depth invariant (ADR 0008) holds for imported data
 * exactly as it does for data made in the UI.
 */
export function planImport(
	current: RelationPayload,
	imported: RelationPayload,
	mode: MergeMode,
	maxPinned: number
): ImportPlan {
	const startLinks = mode === "replace" ? [] : current.horizontalLinks.slice();
	const startGroups = mode === "replace" ? [] : current.groupLinks.slice();
	const startPins = mode === "replace" ? [] : current.pinnedTags.slice();

	const links = startLinks.slice();
	let addedLinks = 0;
	for (const link of imported.horizontalLinks) {
		if (links.some((existing) => sameLink(existing, link))) continue;
		links.push(link);
		addedLinks++;
	}

	const groups = new TagGroups(startGroups);
	const rejectedGroups: Array<{ link: GroupLink; reason: string }> = [];
	let addedGroups = 0;
	for (const link of imported.groupLinks) {
		const result = groups.add(link.parent, link.child);
		if (result.ok) addedGroups++;
		else if (!/already in that group/i.test(result.reason ?? "")) {
			// An entry already present is not worth reporting; a genuine
			// refusal is.
			rejectedGroups.push({ link, reason: result.reason ?? "Not allowed." });
		}
	}

	const pins = startPins.slice();
	let addedPins = 0;
	let droppedPins = 0;
	for (const tag of imported.pinnedTags) {
		if (pins.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
			continue;
		}
		if (pins.length >= maxPinned) {
			droppedPins++;
			continue;
		}
		pins.push(tag);
		addedPins++;
	}

	return {
		mode,
		addedLinks,
		addedGroups,
		addedPins,
		rejectedGroups,
		droppedPins,
		result: {
			horizontalLinks: links,
			groupLinks: groups.all,
			pinnedTags: pins,
		},
	};
}
