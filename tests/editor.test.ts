import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TagEditor } from "../src/edit";
import type { EditorOptions } from "../src/edit";
import { MockVault, parseCache } from "./helpers/vault";

function editorFor(
	files: Record<string, string>,
	overrides: Partial<EditorOptions> = {}
): { editor: TagEditor; vault: MockVault } {
	const vault = new MockVault(files);
	const editor = new TagEditor(vault.app, () => ({
		caseSensitive: false,
		addLocation: "frontmatter",
		...overrides,
	}));
	return { editor, vault };
}

describe("the mock vault's cache reflects Obsidian's tag rules", () => {
	// Guards the fixture itself: the editor relies on the parser to have
	// already excluded these, so the mock must exclude them too.
	test("skips fenced code blocks", () => {
		const cache = parseCache("Real #alpha\n\n```\n#notatag\n```\n");
		assert.deepEqual(cache.tags.map((t) => t.tag), ["#alpha"]);
	});

	test("skips markdown headings", () => {
		const cache = parseCache("# Heading\n\n#alpha\n");
		assert.deepEqual(cache.tags.map((t) => t.tag), ["#alpha"]);
	});

	test("skips URL fragments", () => {
		const cache = parseCache("See https://x.example/page#frag and #alpha\n");
		assert.deepEqual(cache.tags.map((t) => t.tag), ["#alpha"]);
	});

	test("reports offsets that actually locate the tag", () => {
		const content = "one #alpha two";
		const hit = parseCache(content).tags[0];
		assert.equal(
			content.slice(hit.position.start.offset, hit.position.end.offset),
			"#alpha"
		);
	});

	test("offsets are absolute, including any frontmatter", () => {
		const content = "---\ntitle: T\n---\nbody #alpha\n";
		const hit = parseCache(content).tags[0];
		assert.equal(
			content.slice(hit.position.start.offset, hit.position.end.offset),
			"#alpha"
		);
	});
});

describe("planning a rename", () => {
	const files = {
		"a.md": "About #alpha and #other\n",
		"b.md": "---\ntags:\n  - alpha\n---\nBody\n",
		"c.md": "Nothing relevant\n",
	};

	test("reports affected notes with a body/frontmatter split", () => {
		const { editor } = editorFor(files);
		const plan = editor.planRename("#alpha", "#beta", false);
		assert.deepEqual(plan.files, [
			{ path: "a.md", inline: 1, frontmatter: 0 },
			{ path: "b.md", inline: 0, frontmatter: 1 },
		]);
		assert.equal(plan.occurrences, 2);
	});

	test("an unused tag plans nothing", () => {
		assert.equal(editorFor(files).editor.planRename("#nope", "#x", false).occurrences, 0);
	});

	test("case-insensitive by default, exact when configured", () => {
		const cased = { "a.md": "#Alpha here\n" };
		assert.equal(
			editorFor(cased).editor.planRename("#alpha", "#beta", false).occurrences,
			1
		);
		assert.equal(
			editorFor(cased, { caseSensitive: true }).editor.planRename(
				"#alpha",
				"#beta",
				false
			).occurrences,
			0
		);
	});

	test("filesWithTag lists carriers from body and frontmatter alike", () => {
		assert.deepEqual(editorFor(files).editor.filesWithTag("#alpha", false), [
			"a.md",
			"b.md",
		]);
	});
});

describe("applying a rename", () => {
	test("rewrites the body and leaves other tags alone", async () => {
		const { editor, vault } = editorFor({ "a.md": "x #alpha y #other z\n" });
		const outcome = await editor.applyRename("#alpha", "#beta", false);
		assert.equal(vault.read("a.md"), "x #beta y #other z\n");
		assert.equal(outcome.filesChanged, 1);
		assert.equal(outcome.occurrences, 1);
		assert.deepEqual(outcome.errors, []);
	});

	test("rewrites frontmatter, preserving the list shape", async () => {
		const { editor, vault } = editorFor({
			"a.md": "---\ntags:\n  - alpha\n  - keep\n---\nBody\n",
		});
		await editor.applyRename("#alpha", "#beta", false);
		const after = vault.read("a.md");
		assert.match(after, /- beta/);
		assert.match(after, /- keep/);
		assert.match(after, /Body/);
	});

	test("handles a note carrying the tag in both places", async () => {
		const { editor, vault } = editorFor({
			"a.md": "---\ntags:\n  - alpha\n---\nBody #alpha here\n",
		});
		const outcome = await editor.applyRename("#alpha", "#beta", false);
		assert.equal(outcome.occurrences, 2);
		assert.match(vault.read("a.md"), /- beta/);
		assert.match(vault.read("a.md"), /Body #beta here/);
	});

	test("does not touch tags inside code blocks", async () => {
		const { editor, vault } = editorFor({
			"a.md": "Real #alpha\n\n```\n#alpha in code\n```\n",
		});
		await editor.applyRename("#alpha", "#beta", false);
		assert.equal(vault.read("a.md"), "Real #beta\n\n```\n#alpha in code\n```\n");
	});

	test("does not touch URL fragments or headings", async () => {
		const { editor, vault } = editorFor({
			"a.md": "# alpha heading\n\nhttps://x.example/p#alpha\n\n#alpha\n",
		});
		await editor.applyRename("#alpha", "#beta", false);
		const after = vault.read("a.md");
		assert.match(after, /# alpha heading/);
		assert.match(after, /p#alpha/);
		assert.match(after, /\n#beta\n/);
	});

	test("merging into an existing tag is just a rename", async () => {
		const { editor, vault } = editorFor({ "a.md": "#alpha and #beta\n" });
		await editor.applyRename("#alpha", "#beta", false);
		assert.equal(vault.read("a.md"), "#beta and #beta\n");
	});

	test("renaming across many notes reports the totals", async () => {
		const { editor } = editorFor({
			"a.md": "#alpha\n",
			"b.md": "#alpha #alpha\n",
			"c.md": "unrelated\n",
		});
		const outcome = await editor.applyRename("#alpha", "#beta", false);
		assert.equal(outcome.filesChanged, 2);
		assert.equal(outcome.occurrences, 3);
	});

	test("nested children follow only when asked (legacy, ADR 0007)", async () => {
		const files = { "a.md": "#area and #area/health\n" };
		const off = editorFor(files);
		await off.editor.applyRename("#area", "#zone", false);
		assert.equal(off.vault.read("a.md"), "#zone and #area/health\n");

		const on = editorFor(files);
		await on.editor.applyRename("#area", "#zone", true);
		assert.equal(on.vault.read("a.md"), "#zone and #zone/health\n");
	});
});

describe("assigning a tag", () => {
	test("plans only notes that lack the tag", () => {
		const { editor } = editorFor({
			"has.md": "#alpha\n",
			"lacks.md": "nothing\n",
		});
		const plan = editor.planAssign("#alpha", ["has.md", "lacks.md"]);
		assert.deepEqual(plan.files.map((f) => f.path), ["lacks.md"]);
	});

	test("frontmatter mode creates the tags key", async () => {
		const { editor, vault } = editorFor({ "a.md": "Body\n" });
		const outcome = await editor.applyAssign("#alpha", ["a.md"]);
		assert.match(vault.read("a.md"), /tags:/);
		assert.match(vault.read("a.md"), /- alpha/);
		assert.match(vault.read("a.md"), /Body/);
		assert.equal(outcome.filesChanged, 1);
	});

	test("frontmatter mode appends to an existing list", async () => {
		const { editor, vault } = editorFor({
			"a.md": "---\ntags:\n  - keep\n---\nBody\n",
		});
		await editor.applyAssign("#alpha", ["a.md"]);
		assert.match(vault.read("a.md"), /- keep/);
		assert.match(vault.read("a.md"), /- alpha/);
	});

	test("frontmatter mode leaves other keys intact", async () => {
		const { editor, vault } = editorFor({
			"a.md": "---\ntitle: Hello\n---\nBody\n",
		});
		await editor.applyAssign("#alpha", ["a.md"]);
		assert.match(vault.read("a.md"), /title: Hello/);
		assert.match(vault.read("a.md"), /- alpha/);
	});

	test("inline mode appends at the end of the note", async () => {
		const { editor, vault } = editorFor(
			{ "a.md": "Body text\n" },
			{ addLocation: "inline" }
		);
		await editor.applyAssign("#alpha", ["a.md"]);
		assert.equal(vault.read("a.md"), "Body text\n\n#alpha\n");
	});

	test("inline mode handles an empty note", async () => {
		const { editor, vault } = editorFor({ "a.md": "" }, { addLocation: "inline" });
		await editor.applyAssign("#alpha", ["a.md"]);
		assert.equal(vault.read("a.md"), "#alpha\n");
	});

	test("a note that already carries the tag is skipped", async () => {
		const { editor, vault } = editorFor({ "a.md": "#alpha\n" });
		const outcome = await editor.applyAssign("#alpha", ["a.md"]);
		assert.equal(outcome.filesChanged, 0);
		assert.equal(vault.read("a.md"), "#alpha\n");
	});

	test("assigning to several notes touches each once", async () => {
		const { editor } = editorFor(
			{ "a.md": "one\n", "b.md": "two\n" },
			{ addLocation: "inline" }
		);
		const outcome = await editor.applyAssign("#alpha", ["a.md", "b.md"]);
		assert.equal(outcome.filesChanged, 2);
	});

	test("an unknown path is ignored rather than throwing", async () => {
		const { editor } = editorFor({ "a.md": "x\n" });
		const outcome = await editor.applyAssign("#alpha", ["ghost.md"]);
		assert.equal(outcome.filesChanged, 0);
		assert.deepEqual(outcome.errors, []);
	});
});

describe("removing a tag", () => {
	test("removes from the body and cleans the blanked line", async () => {
		const { editor, vault } = editorFor({ "a.md": "Head\n\n#alpha\n\nTail\n" });
		const outcome = await editor.applyUnassign("#alpha", ["a.md"], false);
		assert.equal(vault.read("a.md"), "Head\n\n\nTail\n");
		assert.equal(outcome.occurrences, 1);
	});

	test("removes from frontmatter", async () => {
		const { editor, vault } = editorFor({
			"a.md": "---\ntags:\n  - alpha\n  - keep\n---\nBody\n",
		});
		await editor.applyUnassign("#alpha", ["a.md"], false);
		const after = vault.read("a.md");
		assert.doesNotMatch(after, /alpha/);
		assert.match(after, /- keep/);
	});

	test("is scoped to the given notes", async () => {
		const { editor, vault } = editorFor({
			"a.md": "#alpha\n",
			"b.md": "#alpha\n",
		});
		await editor.applyUnassign("#alpha", ["a.md"], false);
		assert.doesNotMatch(vault.read("a.md"), /#alpha/);
		assert.match(vault.read("b.md"), /#alpha/);
	});

	test("planUnassign respects the same scope", () => {
		const { editor } = editorFor({ "a.md": "#alpha\n", "b.md": "#alpha\n" });
		assert.equal(editor.planUnassign("#alpha", ["a.md"], false).occurrences, 1);
		assert.equal(
			editor.planUnassign("#alpha", ["a.md", "b.md"], false).occurrences,
			2
		);
	});

	test("other tags on the note survive", async () => {
		const { editor, vault } = editorFor({ "a.md": "#alpha #keep\n" });
		await editor.applyUnassign("#alpha", ["a.md"], false);
		assert.match(vault.read("a.md"), /#keep/);
		assert.doesNotMatch(vault.read("a.md"), /#alpha/);
	});
});
