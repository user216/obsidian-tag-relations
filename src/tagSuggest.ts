import { validateTagName } from "./edit";
import { tagLabel } from "./graph";

/**
 * Filtering for the tag pickers: which existing tags match what has been
 * typed, and whether what has been typed is itself a usable new tag name.
 *
 * Shared by the single-pick picker and the multi-pick one on the new-note
 * dialog, so "type a name that does not exist to create it" behaves the same
 * in both rather than being implemented twice.
 */
export interface TagSuggestion {
	tag: string;
	/** True when this row would create a tag rather than reuse one. */
	isNew: boolean;
}

export interface TagSuggestOptions {
	/** Offer to create the typed name when it matches nothing. Default true. */
	allowNew?: boolean;
	/** Tags to leave out — already chosen, or otherwise ineligible. */
	exclude?: Iterable<string>;
	limit?: number;
}

export function tagSuggestions(
	query: string,
	tags: string[],
	options: TagSuggestOptions = {}
): TagSuggestion[] {
	const { allowNew = true, limit } = options;
	const needle = query.trim().toLowerCase().replace(/^#/, "");
	const excluded = new Set<string>();
	for (const tag of options.exclude ?? []) excluded.add(tag.toLowerCase());

	const matches: TagSuggestion[] = tags
		.filter((tag) => !excluded.has(tag.toLowerCase()))
		.filter((tag) => tagLabel(tag).toLowerCase().includes(needle))
		.map((tag) => ({ tag, isNew: false }));

	if (allowNew && needle.length > 0) {
		const validation = validateTagName(needle);
		if (validation.ok && validation.tag) {
			const lower = validation.tag.toLowerCase();
			const known =
				tags.some((tag) => tag.toLowerCase() === lower) || excluded.has(lower);
			// Creation goes first so a deliberately new name is one Enter away,
			// rather than buried under near-misses that merely contain it.
			if (!known) matches.unshift({ tag: validation.tag, isNew: true });
		}
	}

	return limit !== undefined ? matches.slice(0, limit) : matches;
}

/**
 * Several tag names typed at once, separated by commas, semicolons, newlines
 * or plain spaces.
 *
 * Spaces are safe to treat as separators because a tag name can never contain
 * one — so "alpha beta" is unambiguously two tags, never one badly-named tag.
 * A single token is not a list, so ordinary one-at-a-time typing is untouched.
 */
export interface ParsedTagList {
	/** True once more than one name has been typed. */
	isList: boolean;
	/** Names that can be added, in typed order, de-duplicated. */
	valid: TagSuggestion[];
	/** Fragments that are not usable tag names, with the reason for each. */
	invalid: RejectedName[];
	/** Fragments naming something already chosen. */
	duplicates: string[];
}

export interface RejectedName {
	name: string;
	reason: string;
}

const LIST_SEPARATORS = /[\s,;]+/;

export function parseTagList(
	query: string,
	tags: string[],
	options: { exclude?: Iterable<string> } = {}
): ParsedTagList {
	const excluded = new Set<string>();
	for (const tag of options.exclude ?? []) excluded.add(tag.toLowerCase());

	const tokens = query.split(LIST_SEPARATORS).filter((part) => part.length > 0);
	const valid: TagSuggestion[] = [];
	const invalid: RejectedName[] = [];
	const duplicates: string[] = [];
	const seen = new Set<string>();

	for (const token of tokens) {
		const validation = validateTagName(token);
		if (!validation.ok || !validation.tag) {
			invalid.push({
				name: token,
				reason: validation.error ?? "Not a usable tag name.",
			});
			continue;
		}
		const lower = validation.tag.toLowerCase();
		if (excluded.has(lower)) {
			duplicates.push(token);
			continue;
		}
		// The same name twice in one list is not an error, just redundant.
		if (seen.has(lower)) continue;
		seen.add(lower);
		valid.push({
			tag: validation.tag,
			isNew: !tags.some((tag) => tag.toLowerCase() === lower),
		});
	}

	return { isList: tokens.length > 1, valid, invalid, duplicates };
}

/**
 * Why a single typed name cannot be used, or null when it can.
 *
 * The rules come from Obsidian, not from this plugin — a tag needs at least
 * one non-numeric character, so `#1984` is not a tag while `#y1984` is. The
 * point of surfacing this is that refusing silently looks like a bug: the
 * user types a name, nothing appears, and nothing says why.
 */
export function rejectionFor(query: string): RejectedName | null {
	const trimmed = query.trim();
	if (trimmed.length === 0) return null;
	const validation = validateTagName(trimmed);
	if (validation.ok) return null;
	return {
		name: trimmed,
		reason: validation.error ?? "Not a usable tag name.",
	};
}

/** An actionable suggestion for a rejected name, where one exists. */
export function hintFor(rejection: RejectedName): string | null {
	if (/only digits/i.test(rejection.reason)) {
		// The fix is concrete, so name it rather than leaving them to guess.
		return `Obsidian needs at least one letter — try "n${rejection.name}" or "${rejection.name}x".`;
	}
	if (/spaces/i.test(rejection.reason)) {
		return "Use a hyphen or underscore instead of a space.";
	}
	return null;
}
