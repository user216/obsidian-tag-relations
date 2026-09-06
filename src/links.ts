import { ManualLink } from "./types";

/**
 * Rewrite manual connections after a tag rename.
 *
 * A rename can do more than substitute a name: it can collapse a link onto
 * itself (when both ends become the same tag) or duplicate an existing link
 * (when the renamed tag already had a connection to the same partner). Both
 * are dropped here, so the stored links stay a clean set.
 */
export function remapManualLinks(
	links: ManualLink[],
	from: string,
	to: string,
	includeNested: boolean,
	caseSensitive: boolean
): ManualLink[] {
	const fold = (tag: string) => (caseSensitive ? tag : tag.toLowerCase());
	const target = fold(from);

	const remap = (tag: string): string => {
		const folded = fold(tag);
		if (folded === target) return to;
		if (includeNested && folded.startsWith(target + "/")) {
			return to + tag.slice(from.length);
		}
		return tag;
	};

	const seen = new Set<string>();
	const next: ManualLink[] = [];
	for (const link of links) {
		const a = remap(link.a);
		const b = remap(link.b);
		if (fold(a) === fold(b)) continue;
		const key = [fold(a), fold(b)].sort().join(" ");
		if (seen.has(key)) continue;
		seen.add(key);
		next.push({ ...link, a, b });
	}
	return next;
}
