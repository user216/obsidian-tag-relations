import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_PLACEMENTS,
	actionsForSurface,
	isOn,
	moveInOrder,
	orderedActions,
	placementOf,
} from "../src/actionLayout";
import { TAG_ACTIONS } from "../src/actions";
import type { TagAction } from "../src/actions";

const fake = (id: string): TagAction => ({
	id,
	group: "edit",
	defaultIcon: "x",
	label: () => id,
	isEnabled: () => true,
	run: () => undefined,
});
const ACTIONS = ["a", "b", "c", "d"].map(fake);
const ids = (list: TagAction[]) => list.map((action) => action.id);

describe("placement", () => {
	test("an unset action falls back to its default", () => {
		assert.equal(placementOf("new-note", {}), "toolbar");
		assert.equal(placementOf("clear-selection", {}), "toolbar");
	});

	test("anything without a named default lands on the action bar", () => {
		assert.equal(placementOf("rename", {}), "bar");
		assert.equal(placementOf("made-up", {}), "bar");
	});

	test("an explicit setting overrides the default", () => {
		assert.equal(placementOf("new-note", { "new-note": "hidden" }), "hidden");
	});

	test("isOn resolves each placement against a surface", () => {
		assert.equal(isOn("bar", "bar"), true);
		assert.equal(isOn("bar", "toolbar"), false);
		assert.equal(isOn("toolbar", "toolbar"), true);
		assert.equal(isOn("both", "bar"), true);
		assert.equal(isOn("both", "toolbar"), true);
		assert.equal(isOn("hidden", "bar"), false);
		assert.equal(isOn("hidden", "toolbar"), false);
	});

	test("the defaults reproduce the layout that predated this setting", () => {
		// new-note and clear-selection were hard-coded toolbar buttons.
		assert.deepEqual(Object.keys(DEFAULT_PLACEMENTS).sort(), [
			"clear-selection",
			"new-note",
		]);
	});
});

describe("ordering", () => {
	test("an empty order keeps registry order", () => {
		assert.deepEqual(ids(orderedActions(ACTIONS, [])), ["a", "b", "c", "d"]);
	});

	test("a full order is honoured exactly", () => {
		assert.deepEqual(ids(orderedActions(ACTIONS, ["d", "c", "b", "a"])), [
			"d",
			"c",
			"b",
			"a",
		]);
	});

	test("actions missing from a saved order append, rather than vanishing", () => {
		// This is what stops a new action added by a later version being
		// invisible to anyone with a saved layout.
		assert.deepEqual(ids(orderedActions(ACTIONS, ["c", "a"])), [
			"c",
			"a",
			"b",
			"d",
		]);
	});

	test("an order naming actions that no longer exist is harmless", () => {
		assert.deepEqual(ids(orderedActions(ACTIONS, ["gone", "b", "a"])), [
			"b",
			"a",
			"c",
			"d",
		]);
	});

	test("every real action survives ordering, whatever the saved order", () => {
		const out = orderedActions(TAG_ACTIONS, ["rename", "pin"]);
		assert.equal(out.length, TAG_ACTIONS.length);
		assert.equal(new Set(ids(out)).size, TAG_ACTIONS.length);
	});
});

describe("filtering to a surface", () => {
	const placements = {
		a: "toolbar",
		b: "bar",
		c: "both",
		d: "hidden",
	} as const;

	test("the toolbar takes its own and the shared ones", () => {
		assert.deepEqual(
			ids(actionsForSurface("toolbar", ACTIONS, [], { ...placements })),
			["a", "c"]
		);
	});

	test("the action bar likewise", () => {
		assert.deepEqual(
			ids(actionsForSurface("bar", ACTIONS, [], { ...placements })),
			["b", "c"]
		);
	});

	test("hidden appears on neither", () => {
		for (const surface of ["bar", "toolbar"] as const) {
			assert.equal(
				ids(actionsForSurface(surface, ACTIONS, [], { ...placements })).includes("d"),
				false
			);
		}
	});

	test("the arranged order is preserved after filtering", () => {
		const order = ["c", "b", "a", "d"];
		assert.deepEqual(
			ids(actionsForSurface("bar", ACTIONS, order, { ...placements })),
			["c", "b"]
		);
	});

	test("both surfaces can be empty without error", () => {
		const allHidden = Object.fromEntries(
			ACTIONS.map((a) => [a.id, "hidden" as const])
		);
		assert.deepEqual(actionsForSurface("bar", ACTIONS, [], allHidden), []);
	});
});

describe("moving a button", () => {
	const order = ["a", "b", "c", "d"];

	test("up and down by one", () => {
		assert.deepEqual(moveInOrder(order, "c", -1), ["a", "c", "b", "d"]);
		assert.deepEqual(moveInOrder(order, "b", 1), ["a", "c", "b", "d"]);
	});

	test("moving past either end is a no-op, not a wrap", () => {
		assert.deepEqual(moveInOrder(order, "a", -1), order);
		assert.deepEqual(moveInOrder(order, "d", 1), order);
	});

	test("an unknown id changes nothing", () => {
		assert.deepEqual(moveInOrder(order, "ghost", 1), order);
	});

	test("never mutates the array it was given", () => {
		moveInOrder(order, "a", 1);
		assert.deepEqual(order, ["a", "b", "c", "d"]);
	});

	test("no action is lost or duplicated by a move", () => {
		const moved = moveInOrder(order, "b", 1);
		assert.deepEqual(moved.slice().sort(), order.slice().sort());
	});
});
