import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	TOOLBAR_CONTROLS,
	isControlVisible,
	visibleControls,
} from "../src/toolbarControls";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("toolbar control visibility", () => {
	test("controls are shown unless explicitly turned off", () => {
		assert.equal(isControlVisible("modes", {}), true);
		assert.equal(isControlVisible("search", { search: false }), true);
		assert.equal(isControlVisible("search", { search: true }), false);
	});

	test("out of the box every control is visible", () => {
		assert.deepEqual(
			visibleControls(DEFAULT_SETTINGS.hiddenToolbarControls).length,
			TOOLBAR_CONTROLS.length
		);
	});

	test("hiding one leaves the others alone", () => {
		const visible = visibleControls({ sort: true }).map((c) => c.id);
		assert.equal(visible.includes("sort"), false);
		assert.equal(visible.includes("modes"), true);
		assert.equal(visible.length, TOOLBAR_CONTROLS.length - 1);
	});

	test("everything can be hidden at once", () => {
		const all = Object.fromEntries(TOOLBAR_CONTROLS.map((c) => [c.id, true]));
		assert.deepEqual(visibleControls(all), []);
	});

	test("an unknown key in the stored settings is ignored", () => {
		assert.equal(
			visibleControls({ somethingRemoved: true }).length,
			TOOLBAR_CONTROLS.length
		);
	});
});

describe("the control registry itself", () => {
	test("ids are unique", () => {
		const ids = TOOLBAR_CONTROLS.map((c) => c.id);
		assert.equal(new Set(ids).size, ids.length);
	});

	test("every control has a label and says what hiding it costs", () => {
		for (const control of TOOLBAR_CONTROLS) {
			assert.ok(control.label.length > 0, control.id);
			// The description exists to stop hiding something feeling like a
			// trap, so an empty one would defeat the point.
			assert.ok(control.description.length > 20, control.id);
		}
	});
});
