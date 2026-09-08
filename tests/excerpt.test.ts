import test from "node:test";
import assert from "node:assert/strict";
import {
	EXCERPT_STOPS,
	MAX_EXCERPT_LINES,
	excerptLines,
	excerptStopLabel,
} from "../src/excerpt";

test("takes the first lines of content", () => {
	const note = "First line\nSecond line\nThird line\nFourth line";
	assert.deepEqual(excerptLines(note, 3), [
		"First line",
		"Second line",
		"Third line",
	]);
});

test("frontmatter is skipped, not counted", () => {
	// A literal first-three-lines would show nothing but metadata here.
	const note = "---\ntags: [a, b]\ntitle: Thing\n---\nThe actual opening\nMore";
	assert.deepEqual(excerptLines(note, 2), ["The actual opening", "More"]);
});

test("frontmatter closed with ... is still frontmatter", () => {
	const note = "---\ntitle: Thing\n...\nBody";
	assert.deepEqual(excerptLines(note, 1), ["Body"]);
});

test("an unterminated fence is treated as ordinary text", () => {
	// Otherwise a note opening with a horizontal rule would vanish entirely.
	const note = "---\nJust a rule above me";
	assert.deepEqual(excerptLines(note, 2), ["Just a rule above me"]);
});

test("a --- that is not on the first line is not frontmatter", () => {
	// It is a horizontal rule, which is formatting, so it is skipped as such
	// rather than eating one of the requested lines.
	const note = "Title\n---\nBody";
	assert.deepEqual(excerptLines(note, 3), ["Title", "Body"]);
});

test("horizontal rules of any flavour are skipped", () => {
	assert.deepEqual(excerptLines("***\nOne\n___\nTwo", 2), ["One", "Two"]);
});

test("blank lines do not use up the count", () => {
	const note = "\n\nOne\n\n\nTwo\n\nThree";
	assert.deepEqual(excerptLines(note, 3), ["One", "Two", "Three"]);
});

test("a line of nothing but tags is metadata and is skipped", () => {
	const note = "#work #urgent\nThe real first line";
	assert.deepEqual(excerptLines(note, 1), ["The real first line"]);
});

test("a line that merely contains a tag is kept", () => {
	const note = "Remember to file this under #work before Friday";
	assert.deepEqual(excerptLines(note, 1), [
		"Remember to file this under #work before Friday",
	]);
});

test("heading markers are trimmed but headings are kept", () => {
	const note = "## A heading\nBody";
	assert.deepEqual(excerptLines(note, 2), ["A heading", "Body"]);
});

test("a hash without a space is a tag, not a heading", () => {
	const note = "#work is where this belongs";
	assert.deepEqual(excerptLines(note, 1), ["#work is where this belongs"]);
});

test("quote and callout markers are trimmed, however nested", () => {
	const note = "> > Deeply quoted\n> Once quoted";
	assert.deepEqual(excerptLines(note, 2), ["Deeply quoted", "Once quoted"]);
});

test("list markers are kept, because they carry structure", () => {
	const note = "- one\n- two";
	assert.deepEqual(excerptLines(note, 2), ["- one", "- two"]);
});

test("asking for nothing returns nothing", () => {
	assert.deepEqual(excerptLines("Anything at all", 0), []);
	assert.deepEqual(excerptLines("Anything at all", -5), []);
});

test("asking for more than the cap gets the cap", () => {
	const note = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
	assert.equal(excerptLines(note, 1000).length, MAX_EXCERPT_LINES);
});

test("a note with no content yields no lines rather than throwing", () => {
	assert.deepEqual(excerptLines("", 5), []);
	assert.deepEqual(excerptLines("\n\n\n", 5), []);
	assert.deepEqual(excerptLines("---\ntitle: x\n---\n", 5), []);
});

test("windows line endings read the same as unix ones", () => {
	assert.deepEqual(excerptLines("One\r\nTwo\r\nThree", 3), [
		"One",
		"Two",
		"Three",
	]);
});

test("a short note gives what it has, without padding", () => {
	assert.deepEqual(excerptLines("Only this", 10), ["Only this"]);
});

test("the stops are the counts the buttons offer, name-only first", () => {
	assert.deepEqual(EXCERPT_STOPS, [0, 3, 5, 10]);
	assert.ok(EXCERPT_STOPS.every((stop) => stop <= MAX_EXCERPT_LINES));
});

test("every stop has a label, and zero reads as a name", () => {
	assert.equal(excerptStopLabel(0), "Name only");
	assert.equal(excerptStopLabel(1), "First 1 line");
	assert.equal(excerptStopLabel(3), "First 3 lines");
	for (const stop of EXCERPT_STOPS) {
		assert.ok(excerptStopLabel(stop).length > 0);
	}
});
