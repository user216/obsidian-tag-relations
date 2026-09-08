import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	EXPORT_FORMAT,
	buildExport,
	parseImport,
	planImport,
	serializeExport,
} from "../src/transfer";
import type { RelationPayload } from "../src/transfer";

function payload(over: Partial<RelationPayload> = {}): RelationPayload {
	return {
		horizontalLinks: [{ a: "#a", b: "#b" }],
		groupLinks: [{ parent: "#health", child: "#running" }],
		pinnedTags: ["#a"],
		...over,
	};
}

describe("export", () => {
	test("carries the data plus enough to identify the file later", () => {
		const exported = buildExport(payload(), "1.2.3", new Date("2026-01-01T00:00:00Z"));
		assert.equal(exported.format, EXPORT_FORMAT);
		assert.equal(exported.version, 1);
		assert.equal(exported.pluginVersion, "1.2.3");
		assert.equal(exported.exportedAt, "2026-01-01T00:00:00.000Z");
		assert.deepEqual(exported.groupLinks, payload().groupLinks);
	});

	test("round-trips through serialise and parse", () => {
		const text = serializeExport(buildExport(payload(), "1.0.0"));
		const parsed = parseImport(text);
		assert.equal(parsed.ok, true);
		assert.deepEqual(parsed.payload, payload());
	});

	test("is pretty-printed, since a person may open or edit it", () => {
		assert.ok(serializeExport(buildExport(payload(), "1.0.0")).includes("\n"));
	});
});

describe("import — rejecting what it should", () => {
	test("invalid JSON", () => {
		const parsed = parseImport("{not json");
		assert.equal(parsed.ok, false);
		assert.match(parsed.error ?? "", /not valid json/i);
	});

	test("JSON that is not an object", () => {
		assert.equal(parseImport("[1,2,3]").ok, false);
		assert.equal(parseImport('"text"').ok, false);
	});

	test("another plugin's file", () => {
		const parsed = parseImport(JSON.stringify({ format: "something-else" }));
		assert.equal(parsed.ok, false);
		assert.match(parsed.error ?? "", /not a tag relations export/i);
	});

	test("a file from a newer plugin format", () => {
		const parsed = parseImport(
			JSON.stringify({ format: EXPORT_FORMAT, version: 99, groupLinks: [] })
		);
		assert.equal(parsed.ok, false);
		assert.match(parsed.error ?? "", /newer version/i);
	});

	test("a well-formed file with nothing in it", () => {
		const parsed = parseImport(
			JSON.stringify({ format: EXPORT_FORMAT, version: 1, groupLinks: [] })
		);
		assert.equal(parsed.ok, false);
		assert.match(parsed.error ?? "", /nothing to import/i);
	});
});

describe("import — tolerating what it can", () => {
	test("accepts a raw data.json, where the key is manualLinks", () => {
		// The internal name differs from the user-facing one, so a plugin data
		// file should import directly rather than needing to be renamed.
		const parsed = parseImport(
			JSON.stringify({ manualLinks: [{ a: "#x", b: "#y" }] })
		);
		assert.equal(parsed.ok, true);
		assert.deepEqual(parsed.payload?.horizontalLinks, [{ a: "#x", b: "#y" }]);
	});

	test("drops malformed entries and says how many", () => {
		const parsed = parseImport(
			JSON.stringify({
				format: EXPORT_FORMAT,
				horizontalLinks: [{ a: "#x", b: "#y" }, { a: "#only" }, null, { a: "#z", b: "#z" }],
				groupLinks: [{ parent: "#p", child: "#c" }, { parent: "#p" }],
			})
		);
		assert.equal(parsed.ok, true);
		assert.deepEqual(parsed.payload?.horizontalLinks, [{ a: "#x", b: "#y" }]);
		assert.deepEqual(parsed.payload?.groupLinks, [{ parent: "#p", child: "#c" }]);
		assert.equal(parsed.warnings.length, 2);
	});

	test("a missing section is simply empty, not an error", () => {
		const parsed = parseImport(JSON.stringify({ pinnedTags: ["#a"] }));
		assert.equal(parsed.ok, true);
		assert.deepEqual(parsed.payload?.groupLinks, []);
	});

	test("a section of the wrong type is warned about, not fatal", () => {
		const parsed = parseImport(
			JSON.stringify({ pinnedTags: ["#a"], groupLinks: "nope" })
		);
		assert.equal(parsed.ok, true);
		assert.ok(parsed.warnings.some((w) => /group links/i.test(w)));
	});
});

describe("import planning — merge", () => {
	const current = payload();

	test("adds only what is missing", () => {
		const plan = planImport(
			current,
			payload({ horizontalLinks: [{ a: "#a", b: "#b" }, { a: "#new", b: "#pair" }] }),
			"merge",
			10
		);
		assert.equal(plan.addedLinks, 1);
		assert.equal(plan.result.horizontalLinks.length, 2);
	});

	test("treats a reversed horizontal link as the same link", () => {
		const plan = planImport(
			current,
			payload({ horizontalLinks: [{ a: "#b", b: "#a" }] }),
			"merge",
			10
		);
		assert.equal(plan.addedLinks, 0);
	});

	test("keeps existing data", () => {
		const plan = planImport(current, payload({ horizontalLinks: [] }), "merge", 10);
		assert.deepEqual(plan.result.horizontalLinks, current.horizontalLinks);
	});

	test("respects the pin cap and reports what it dropped", () => {
		const full = Array.from({ length: 10 }, (_, i) => `#p${i}`);
		const plan = planImport(
			payload({ pinnedTags: full }),
			payload({ pinnedTags: ["#extra"] }),
			"merge",
			10
		);
		assert.equal(plan.addedPins, 0);
		assert.equal(plan.droppedPins, 1);
		assert.equal(plan.result.pinnedTags.length, 10);
	});
});

describe("import planning — replace", () => {
	test("discards what is there first", () => {
		const plan = planImport(
			payload({ horizontalLinks: [{ a: "#old", b: "#gone" }] }),
			payload({ horizontalLinks: [{ a: "#new", b: "#pair" }] }),
			"replace",
			10
		);
		assert.deepEqual(plan.result.horizontalLinks, [{ a: "#new", b: "#pair" }]);
	});

	test("importing nothing in replace mode empties everything", () => {
		const plan = planImport(
			payload(),
			{ horizontalLinks: [], groupLinks: [], pinnedTags: [] },
			"replace",
			10
		);
		assert.deepEqual(plan.result, {
			horizontalLinks: [],
			groupLinks: [],
			pinnedTags: [],
		});
	});
});

describe("import planning — the depth rule still holds", () => {
	test("an imported structure that would be four levels deep is refused", () => {
		// Imported group links go through TagGroups, never straight into
		// storage, so a hand-edited file cannot smuggle in a fourth level.
		const plan = planImport(
			{ horizontalLinks: [], groupLinks: [], pinnedTags: [] },
			{
				horizontalLinks: [],
				groupLinks: [
					{ parent: "#a", child: "#b" },
					{ parent: "#b", child: "#c" },
					{ parent: "#c", child: "#d" },
				],
				pinnedTags: [],
			},
			"replace",
			10
		);
		assert.equal(plan.addedGroups, 2);
		assert.equal(plan.rejectedGroups.length, 1);
		assert.deepEqual(plan.rejectedGroups[0].link, { parent: "#c", child: "#d" });
		assert.ok(plan.rejectedGroups[0].reason.length > 0);
	});

	test("a cycle in the file is refused", () => {
		const plan = planImport(
			{ horizontalLinks: [], groupLinks: [], pinnedTags: [] },
			{
				horizontalLinks: [],
				groupLinks: [
					{ parent: "#a", child: "#b" },
					{ parent: "#b", child: "#a" },
				],
				pinnedTags: [],
			},
			"replace",
			10
		);
		assert.equal(plan.addedGroups, 1);
		assert.equal(plan.rejectedGroups.length, 1);
	});

	test("an entry already present is not reported as a rejection", () => {
		// Re-importing the same file should read as "nothing to do", not as a
		// list of errors.
		const plan = planImport(payload(), payload(), "merge", 10);
		assert.equal(plan.addedGroups, 0);
		assert.deepEqual(plan.rejectedGroups, []);
	});

	test("re-importing the same file changes nothing at all", () => {
		const plan = planImport(payload(), payload(), "merge", 10);
		assert.deepEqual(plan.result, payload());
	});
});
