/**
 * Timezone-aware date formatting for generated note titles.
 *
 * Obsidian bundles plain moment.js, which cannot resolve named IANA
 * timezones without moment-timezone. `Intl.DateTimeFormat` can, is built into
 * the runtime, and needs no dependency — so wall-clock parts are read from it
 * and then substituted into a moment-style format string, which is the token
 * vocabulary Obsidian users already know.
 */

export const DEFAULT_TITLE_FORMAT = "YYYYMMDDHHmm";

export interface TitleFormatPreset {
	format: string;
	label: string;
}

export const TITLE_FORMAT_PRESETS: TitleFormatPreset[] = [
	{ format: "YYYYMMDDHHmm", label: "202601312359 — compact timestamp" },
	{ format: "YYYYMMDDHHmmss", label: "20260131235959 — with seconds" },
	{ format: "YYYY-MM-DD HHmm", label: "2026-01-31 2359 — dated, readable" },
	{ format: "YYYY-MM-DD", label: "2026-01-31 — date only" },
	{ format: "YYYY-MM-DD dddd", label: "2026-01-31 Saturday — with weekday" },
	{ format: "DD.MM.YYYY HH-mm", label: "31.01.2026 23-59 — day first" },
	{ format: "YYYYMMDD-HHmm", label: "20260131-2359 — split date and time" },
	{ format: "[Note] YYYY-MM-DD HHmm", label: "Note 2026-01-31 2359 — prefixed" },
];

const MONTHS_SHORT = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const MONTHS_LONG = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];
const DAYS_SHORT = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
const DAYS_LONG = [
	"Sunday", "Monday", "Tuesday", "Wednesday",
	"Thursday", "Friday", "Saturday",
];

interface Wall {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
	hour: number; // 0-23
	minute: number;
	second: number;
	weekday: number; // 0 = Sunday
}

/** True when the runtime recognises this IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
	if (!timeZone) return true; // empty means "system default"
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

/** Every zone the runtime knows, or a small fallback list if it will not say. */
export function availableTimeZones(): string[] {
	const supported = (
		Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
	).supportedValuesOf;
	if (typeof supported === "function") {
		try {
			const zones = supported("timeZone");
			// supportedValuesOf returns canonical zone names, which spell UTC as
			// "Etc/UTC". Plain "UTC" is valid and is what people look for, so it
			// is offered explicitly rather than left out of the list.
			return zones.includes("UTC") ? zones : ["UTC", ...zones];
		} catch {
			/* fall through to the fallback list */
		}
	}
	return ["UTC", "Europe/London", "Europe/Kyiv", "America/New_York", "Asia/Tokyo"];
}

/** The zone the system is currently in, for labelling the default option. */
export function systemTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** Read the wall-clock parts of `date` as observed in `timeZone`. */
function wallClock(date: Date, timeZone: string): Wall {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		// h23 rather than hour12:false — the latter can yield "24" for midnight.
		hourCycle: "h23",
	};
	if (timeZone) options.timeZone = timeZone;

	const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
	const read = (type: string): number => {
		const part = parts.find((p) => p.type === type);
		return part ? Number(part.value) : 0;
	};

	const year = read("year");
	const month = read("month");
	const day = read("day");
	// Weekday is derived from the zone-local calendar date rather than asked
	// for separately, so it can never disagree with the y/m/d above.
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

	return {
		year,
		month,
		day,
		hour: read("hour") % 24,
		minute: read("minute"),
		second: read("second"),
		weekday,
	};
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

/** Longest first, so "YYYY" is matched before "YY". */
const TOKENS: Array<[string, (w: Wall) => string]> = [
	["YYYY", (w) => pad(w.year, 4)],
	["MMMM", (w) => MONTHS_LONG[w.month - 1] ?? ""],
	["dddd", (w) => DAYS_LONG[w.weekday] ?? ""],
	["MMM", (w) => MONTHS_SHORT[w.month - 1] ?? ""],
	["ddd", (w) => DAYS_SHORT[w.weekday] ?? ""],
	["YY", (w) => pad(w.year % 100)],
	["MM", (w) => pad(w.month)],
	["DD", (w) => pad(w.day)],
	["HH", (w) => pad(w.hour)],
	["hh", (w) => pad(((w.hour + 11) % 12) + 1)],
	["mm", (w) => pad(w.minute)],
	["ss", (w) => pad(w.second)],
	["M", (w) => String(w.month)],
	["D", (w) => String(w.day)],
	["H", (w) => String(w.hour)],
	["h", (w) => String(((w.hour + 11) % 12) + 1)],
	["m", (w) => String(w.minute)],
	["s", (w) => String(w.second)],
	["A", (w) => (w.hour < 12 ? "AM" : "PM")],
	["a", (w) => (w.hour < 12 ? "am" : "pm")],
];

/**
 * Render `date` using a moment-style format string, as observed in
 * `timeZone` (empty means the system zone). Text inside square brackets is
 * emitted literally, so `[Note] YYYY` gives "Note 2026".
 *
 * An unrecognised timezone silently falls back to the system zone rather than
 * throwing — a bad setting should not stop a note from being created.
 */
export function formatDateTime(
	date: Date,
	format: string,
	timeZone = ""
): string {
	const zone = isValidTimeZone(timeZone) ? timeZone : "";
	const wall = wallClock(date, zone);

	let out = "";
	let index = 0;
	while (index < format.length) {
		const char = format[index];

		if (char === "[") {
			const close = format.indexOf("]", index + 1);
			if (close < 0) {
				// Unterminated bracket: emit the rest verbatim.
				out += format.slice(index + 1);
				break;
			}
			out += format.slice(index + 1, close);
			index = close + 1;
			continue;
		}

		const token = TOKENS.find(([name]) => format.startsWith(name, index));
		if (token) {
			out += token[1](wall);
			index += token[0].length;
			continue;
		}

		out += char;
		index++;
	}
	return out;
}

/** Characters no common filesystem (or Obsidian) will accept in a name. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;
const CONTROL = /[\u0000-\u001F\u007F]/g;

/**
 * Make a formatted title safe to use as a filename. Path separators are
 * replaced rather than honoured, so a format containing "/" produces one note
 * with a hyphen instead of silently creating folders.
 */
export function sanitizeFileName(name: string): string {
	return name
		.replace(CONTROL, "")
		.replace(ILLEGAL, "-")
		.replace(/\s+/g, " ")
		.replace(/-{2,}/g, "-")
		.replace(/^[.\-\s]+/, "")
		.replace(/[.\-\s]+$/, "");
}
