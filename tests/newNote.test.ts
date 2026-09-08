import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NoteCreator } from "../src/newNote";
import { MockVault } from "./helpers/vault";

interface Options {
	titleFormat?: string;
	timeZone?: string;
	folder?: string;
	applySelectedTags?: boolean;
	openAfterCreate?: boolean;
}

function creatorFor(files: Record<string, string> = {}, overrides: Options = {}) {
	const vault = new MockVault(files);
	const app: any = vault.app;
	app.workspace = {
		getActiveFile: () => null,
		getLeaf: () => ({ openFile: async () => undefined }),
	};
	app.fileManager.getNewFileParent = () => ({ path: "" });

	const creator = new NoteCreator(app, () => ({
		titleFormat: "YYYYMMDDHHmm",
		timeZone: "UTC",
		folder: "",
		applySelectedTags: true,
		openAfterCreate: false,
		...overrides,
	}));
	return { creator, vault };
}

describe("creating a note with tags", () => {
	test("writes the given tags into frontmatter", async () => {
		const { creator, vault } = creatorFor();
		const result = await creator.create(["#alpha", "#beta"]);
		assert.ok(result);
		assert.equal(
			vault.read(result!.file.path),
			"---\ntags:\n  - alpha\n  - beta\n---\n\n"
		);
	});

	test("a brand-new tag reaches the note exactly like an existing one", async () => {
		// The reported bug: a tag created in the dialog must end up in the
		// note. Nothing downstream distinguishes new tags from known ones.
		const { creator, vault } = creatorFor();
		const result = await creator.create(["#neverseenbefore"]);
		assert.match(vault.read(result!.file.path), /- neverseenbefore/);
		assert.deepEqual(result!.tags, ["#neverseenbefore"]);
	});

	test("tags are written without their leading hash", async () => {
		const { creator, vault } = creatorFor();
		const result = await creator.create(["#alpha"]);
		assert.doesNotMatch(vault.read(result!.file.path), /#/);
	});

	test("no tags means an empty note, not empty frontmatter", async () => {
		const { creator, vault } = creatorFor();
		const result = await creator.create([]);
		assert.equal(vault.read(result!.file.path), "");
	});

	test("duplicate tags collapse", async () => {
		const { creator, vault } = creatorFor();
		const result = await creator.create(["#a", "#a"]);
		assert.equal(vault.read(result!.file.path), "---\ntags:\n  - a\n---\n\n");
	});
});

describe("explicit tags versus the selection setting", () => {
	test("with the setting off, an inherited selection is dropped", async () => {
		const { creator, vault } = creatorFor({}, { applySelectedTags: false });
		const result = await creator.create(["#fromselection"]);
		assert.equal(vault.read(result!.file.path), "");
		assert.deepEqual(result!.tags, []);
	});

	test("but an explicit list is written even then", async () => {
		// The dialog's list is a deliberate choice; the "apply the selected
		// tags" setting governs pre-filling, and must not veto it.
		const { creator, vault } = creatorFor({}, { applySelectedTags: false });
		const result = await creator.create(["#chosen"], true);
		assert.match(vault.read(result!.file.path), /- chosen/);
		assert.deepEqual(result!.tags, ["#chosen"]);
	});

	test("an explicit empty list stays empty", async () => {
		const { creator, vault } = creatorFor({}, { applySelectedTags: true });
		const result = await creator.create([], true);
		assert.equal(vault.read(result!.file.path), "");
	});
});

describe("naming and placement", () => {
	test("the filename comes from the format and timezone", async () => {
		const { creator } = creatorFor({}, { titleFormat: "[note]", timeZone: "UTC" });
		const result = await creator.create([]);
		assert.equal(result!.file.path, "note.md");
	});

	test("a second note in the same minute gets a suffix rather than colliding", async () => {
		const { creator, vault } = creatorFor({}, { titleFormat: "[fixed]" });
		const first = await creator.create([]);
		const second = await creator.create([]);
		assert.equal(first!.file.path, "fixed.md");
		assert.equal(second!.file.path, "fixed-1.md");
		assert.equal(vault.files.size, 2);
	});

	test("a configured folder is used and created", async () => {
		const { creator, vault } = creatorFor({}, { folder: "Inbox", titleFormat: "[n]" });
		const result = await creator.create([]);
		assert.equal(result!.file.path, "Inbox/n.md");
		assert.ok(vault.folders.has("Inbox"));
	});

	test("previewTitle matches the name actually used", async () => {
		const { creator } = creatorFor({}, { titleFormat: "[stable]" });
		const preview = creator.previewTitle();
		const result = await creator.create([]);
		assert.equal(`${preview}.md`, result!.file.path);
	});
});
