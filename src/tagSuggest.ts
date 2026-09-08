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
	/** Fragments that are not usable tag names, kept so they can be named. */
	invalid: string[];
	/** Fragments naming something already chosen. */
	duplicates: string[];
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
	const invalid: string[] = [];
	const duplicates: string[] = [];
	const seen = new Set<string>();

	for (const token of tokens) {
		const validation = validateTagName(token);
		if (!validation.ok || !validation.tag) {
			invalid.push(token);
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
