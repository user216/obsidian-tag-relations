/**
 * Turning a note's raw text into the first few lines a person would actually
 * call its opening.
 *
 * "The first three lines of the file" is almost never what someone means. A
 * note usually begins with frontmatter, then a blank line, then a title, and
 * often a line of nothing but tags — so a literal reading of the first three
 * lines shows metadata and whitespace and none of the note. What is wanted is
 * the first three lines of *content*, which is what this produces: the
 * frontmatter block dropped, blank lines skipped, lines that are only tags
 * skipped as the metadata they are, horizontal rules skipped as the formatting
 * they are, and heading and quote markers trimmed off so a preview does not
 * open with "###".
 *
 * Nothing else is stripped. Markdown left in place still reads as text, and
 * unwrapping links or emphasis would mean either a parser or a pile of regexes
 * that get it subtly wrong — a preview is not a renderer.
 */

/** The most lines ever extracted, and so the most worth caching. */
export const MAX_EXCERPT_LINES = 20;

/** A line that is nothing but tags: metadata, not the start of the note. */
function isTagOnly(line: string): boolean {
	return /^(?:#[^\s#][^\s]*\s*)+$/.test(line);
}

/** A horizontal rule: formatting, and it would read as a stray "---". */
function isRule(line: string): boolean {
	return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line);
}

/**
 * Where the body starts, skipping a YAML frontmatter block.
 *
 * Only counts as frontmatter when `---` is the very first line and a closing
 * fence exists; an unterminated one is treated as ordinary text, since a note
 * beginning with a horizontal rule should not vanish entirely.
 */
function bodyStart(lines: string[]): number {
	if (lines.length === 0 || lines[0].trim() !== "---") return 0;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === "---" || line === "...") return i + 1;
	}
	return 0;
}

function clean(line: string): string {
	return line
		// Quote and callout markers, however deeply nested.
		.replace(/^\s*(?:>\s*)+/, "")
		// Heading hashes, but only when followed by a space — "#tag" is a tag.
		.replace(/^\s*#{1,6}\s+/, "")
		.trim();
}

/**
 * The first `count` lines of content, at most `MAX_EXCERPT_LINES`.
 *
 * Callers cache the full `MAX_EXCERPT_LINES` and slice, so changing how many
 * lines to show never means reading the vault again.
 */
export function excerptLines(content: string, count: number): string[] {
	if (count <= 0) return [];
	const wanted = Math.min(count, MAX_EXCERPT_LINES);
	const lines = content.split(/\r?\n/);
	const out: string[] = [];
	for (let i = bodyStart(lines); i < lines.length; i++) {
		const line = clean(lines[i]);
		if (line.length === 0) continue;
		if (isTagOnly(line) || isRule(line)) continue;
		out.push(line);
		if (out.length >= wanted) break;
	}
	return out;
}

/**
 * The line counts offered as buttons, plus 0 for "just the name".
 *
 * Fixed stops rather than a stepper: these are the counts anyone actually
 * wants, and one press should get you to any of them. The exact number is
 * still settable, and a setting that lands between two stops leaves none of
 * them lit rather than pretending it matched.
 */
export const EXCERPT_STOPS = [0, 3, 5, 10];

export function excerptStopLabel(lines: number): string {
	return lines <= 0 ? "Name only" : `First ${lines} line${lines === 1 ? "" : "s"}`;
}
