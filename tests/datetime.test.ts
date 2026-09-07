import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_TITLE_FORMAT,
	TITLE_FORMAT_PRESETS,
	availableTimeZones,
	formatDateTime,
	isValidTimeZone,
	sanitizeFileName,
	systemTimeZone,
} from "../src/datetime";
import { noteBody, titleFor } from "../src/newNote";

// 2026-01-31T23:59:58Z — chosen so most zones land on a different date,
// month and year than UTC does.
const T = new Date("2026-01-31T23:59:58Z");

describe("formatDateTime — the default format", () => {
	test("YYYYMMDDHHmm is the documented yyyymmddhhmm shape", () => {
		assert.equal(DEFAULT_TITLE_FORMAT, "YYYYMMDDHHmm");
		assert.equal(formatDateTime(T, DEFAULT_TITLE_FORMAT, "UTC"), "202601312359");
	});

	test("is always 12 digits", () => {
		const out = formatDateTime(
			new Date("2026-02-03T04:05:06Z"),
			DEFAULT_TITLE_FORMAT,
			"UTC"
		);
		assert.equal(out, "202602030405");
		assert.match(out, /^\d{12}$/);
	});
});

describe("formatDateTime — tokens", () => {
	test("date tokens", () => {
		assert.equal(formatDateTime(T, "YYYY", "UTC"), "2026");
		assert.equal(formatDateTime(T, "YY", "UTC"), "26");
		assert.equal(formatDateTime(T, "MM", "UTC"), "01");
		assert.equal(formatDateTime(T, "M", "UTC"), "1");
		assert.equal(formatDateTime(T, "DD", "UTC"), "31");
		assert.equal(formatDateTime(T, "D", "UTC"), "31");
	});

	test("time tokens in 24-hour form", () => {
		assert.equal(formatDateTime(T, "HH:mm:ss", "UTC"), "23:59:58");
		assert.equal(formatDateTime(T, "H", "UTC"), "23");
	});

	test("12-hour tokens with meridiem", () => {
		assert.equal(formatDateTime(T, "hh:mm A", "UTC"), "11:59 PM");
		assert.equal(formatDateTime(T, "h a", "UTC"), "11 pm");
	});

	test("midnight is 00 in 24-hour and 12 AM in 12-hour", () => {
		const midnight = new Date("2026-01-31T00:00:00Z");
		assert.equal(formatDateTime(midnight, "HH", "UTC"), "00");
		assert.equal(formatDateTime(midnight, "hh A", "UTC"), "12 AM");
	});

	test("noon is 12 in both", () => {
		const noon = new Date("2026-01-31T12:00:00Z");
		assert.equal(formatDateTime(noon, "HH", "UTC"), "12");
		assert.equal(formatDateTime(noon, "hh A", "UTC"), "12 PM");
	});

	test("month and weekday names", () => {
		assert.equal(formatDateTime(T, "MMM", "UTC"), "Jan");
		assert.equal(formatDateTime(T, "MMMM", "UTC"), "January");
		assert.equal(formatDateTime(T, "ddd", "UTC"), "Sat");
		assert.equal(formatDateTime(T, "dddd", "UTC"), "Saturday");
	});

	test("longer tokens win over their prefixes", () => {
		// YYYY must not be read as YY+YY, and MMMM not as MMM+M.
		assert.equal(formatDateTime(T, "YYYY", "UTC"), "2026");
		assert.equal(formatDateTime(T, "MMMM", "UTC"), "January");
		assert.equal(formatDateTime(T, "dddd", "UTC"), "Saturday");
	});

	test("separators and unknown characters pass through", () => {
		assert.equal(formatDateTime(T, "YYYY-MM-DD", "UTC"), "2026-01-31");
		assert.equal(formatDateTime(T, "YYYY_MM", "UTC"), "2026_01");
		assert.equal(formatDateTime(T, "", "UTC"), "");
	});
});

describe("formatDateTime — literal escaping", () => {
	test("bracketed text is emitted verbatim", () => {
		assert.equal(formatDateTime(T, "[Note] YYYY", "UTC"), "Note 2026");
	});

	test("brackets protect characters that would otherwise be tokens", () => {
		assert.equal(formatDateTime(T, "[Day] D", "UTC"), "Day 31");
		assert.equal(formatDateTime(T, "[YYYY]", "UTC"), "YYYY");
	});

	test("an unterminated bracket emits the remainder literally", () => {
		assert.equal(formatDateTime(T, "YYYY [oops", "UTC"), "2026 oops");
	});

	test("an empty bracket pair contributes nothing", () => {
		assert.equal(formatDateTime(T, "YYYY[]MM", "UTC"), "202601");
	});
});

describe("formatDateTime — timezones", () => {
	test("the same instant renders differently per zone", () => {
		assert.equal(formatDateTime(T, "YYYYMMDDHHmm", "UTC"), "202601312359");
		// Tokyo is UTC+9, so this instant is already the next day there.
		assert.equal(formatDateTime(T, "YYYYMMDDHHmm", "Asia/Tokyo"), "202602010859");
	});

	test("a zone behind UTC can roll back a day", () => {
		assert.equal(
			formatDateTime(T, "YYYY-MM-DD HH:mm", "America/New_York"),
			"2026-01-31 18:59"
		);
	});

	test("crossing a year boundary is handled per zone", () => {
		const newYear = new Date("2026-12-31T23:30:00Z");
		assert.equal(formatDateTime(newYear, "YYYY", "UTC"), "2026");
		assert.equal(formatDateTime(newYear, "YYYY", "Asia/Tokyo"), "2027");
	});

	test("weekday follows the zone, not UTC", () => {
		assert.equal(formatDateTime(T, "dddd", "UTC"), "Saturday");
		assert.equal(formatDateTime(T, "dddd", "Asia/Tokyo"), "Sunday");
	});

	test("daylight saving is respected", () => {
		// London is UTC+1 in July, UTC+0 in January.
		const summer = new Date("2026-07-15T12:00:00Z");
		const winter = new Date("2026-01-15T12:00:00Z");
		assert.equal(formatDateTime(summer, "HH", "Europe/London"), "13");
		assert.equal(formatDateTime(winter, "HH", "Europe/London"), "12");
	});

	test("an empty zone means the system zone", () => {
		assert.equal(
			formatDateTime(T, "YYYYMMDDHHmm", ""),
			formatDateTime(T, "YYYYMMDDHHmm", systemTimeZone())
		);
	});

	test("an invalid zone falls back instead of throwing", () => {
		assert.doesNotThrow(() => formatDateTime(T, "YYYY", "Not/AZone"));
		assert.equal(
			formatDateTime(T, "YYYYMMDDHHmm", "Not/AZone"),
			formatDateTime(T, "YYYYMMDDHHmm", "")
		);
	});
});

describe("timezone discovery", () => {
	test("isValidTimeZone accepts real zones and the empty default", () => {
		assert.equal(isValidTimeZone(""), true);
		assert.equal(isValidTimeZone("UTC"), true);
		assert.equal(isValidTimeZone("Europe/Kyiv"), true);
		assert.equal(isValidTimeZone("Not/AZone"), false);
		assert.equal(isValidTimeZone("nonsense"), false);
	});

	test("availableTimeZones returns a usable list", () => {
		const zones = availableTimeZones();
		assert.ok(zones.length > 0);
		assert.ok(zones.includes("UTC"));
		assert.ok(zones.every((zone) => isValidTimeZone(zone)));
	});

	test("systemTimeZone is itself a valid zone", () => {
		assert.ok(isValidTimeZone(systemTimeZone()));
	});
});

describe("presets", () => {
	test("every preset is a valid, non-empty format", () => {
		for (const preset of TITLE_FORMAT_PRESETS) {
			const rendered = formatDateTime(T, preset.format, "UTC");
			assert.ok(rendered.length > 0, preset.format);
			assert.ok(preset.label.length > 0, preset.format);
		}
	});

	test("the default format is offered as a preset", () => {
		assert.ok(
			TITLE_FORMAT_PRESETS.some((p) => p.format === DEFAULT_TITLE_FORMAT)
		);
	});

	test("every preset survives filename sanitising", () => {
		for (const preset of TITLE_FORMAT_PRESETS) {
			const name = titleFor(preset.format, "UTC", T);
			assert.ok(name.length > 0, preset.format);
			assert.doesNotMatch(name, /[\\/:*?"<>|]/, preset.format);
		}
	});
});

describe("sanitizeFileName", () => {
	test("leaves an ordinary timestamp alone", () => {
		assert.equal(sanitizeFileName("202601312359"), "202601312359");
		assert.equal(sanitizeFileName("2026-01-31 2359"), "2026-01-31 2359");
	});

	test("replaces path separators rather than honouring them", () => {
		// A format with slashes must make one note, not nested folders.
		assert.equal(sanitizeFileName("2026/01/31"), "2026-01-31");
		assert.equal(sanitizeFileName("a\\b"), "a-b");
	});

	test("replaces every character a filename cannot hold", () => {
		assert.equal(sanitizeFileName('a:b*c?d"e<f>g|h'), "a-b-c-d-e-f-g-h");
	});

	test("strips characters Obsidian reserves for links and tags", () => {
		assert.equal(sanitizeFileName("a#b^c[d]e"), "a-b-c-d-e");
	});

	test("collapses runs of hyphens and whitespace", () => {
		assert.equal(sanitizeFileName("a///b"), "a-b");
		assert.equal(sanitizeFileName("a   b"), "a b");
	});

	test("trims leading and trailing dots, hyphens and spaces", () => {
		assert.equal(sanitizeFileName("  ..note--  "), "note");
		assert.equal(sanitizeFileName("...."), "");
	});

	test("removes control characters", () => {
		assert.equal(sanitizeFileName("abc"), "abc");
	});

	test("an entirely illegal name reduces to empty", () => {
		assert.equal(sanitizeFileName(""), "");
	});
});

describe("titleFor", () => {
	test("formats then sanitises", () => {
		assert.equal(titleFor("YYYY/MM/DD", "UTC", T), "2026-01-31");
	});

	test("falls back when a format yields nothing usable", () => {
		assert.equal(titleFor("///", "UTC", T), "Untitled");
		assert.equal(titleFor("", "UTC", T), "Untitled");
	});

	test("honours the timezone", () => {
		assert.equal(titleFor("YYYYMMDDHHmm", "Asia/Tokyo", T), "202602010859");
	});
});

describe("noteBody", () => {
	test("no tags means an empty note", () => {
		assert.equal(noteBody([]), "");
	});

	test("tags become frontmatter without the hash", () => {
		assert.equal(
			noteBody(["#alpha", "#beta"]),
			"---\ntags:\n  - alpha\n  - beta\n---\n\n"
		);
	});

	test("duplicates collapse", () => {
		assert.equal(noteBody(["#a", "#a"]), "---\ntags:\n  - a\n---\n\n");
	});

	test("tags without a hash are accepted as written", () => {
		assert.equal(noteBody(["alpha"]), "---\ntags:\n  - alpha\n---\n\n");
	});
});
