// Packages the built plugin for distribution.
//
// Produces two layouts under dist/, both from the same three build outputs
// (main.js, manifest.json, styles.css):
//   1. dist/<id>/   - a ready-to-copy plugin folder, for installing by hand
//                     into <vault>/.obsidian/plugins/<id>/
//   2. dist/main.js, manifest.json, styles.css - flat copies, for attaching
//                     as individual GitHub release assets (the layout BRAT
//                     and Obsidian's community plugin installer expect)
//
// Run via `npm run package` (which builds first).

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");

const REQUIRED_FILES = ["main.js", "manifest.json", "styles.css"];

async function main() {
	for (const file of REQUIRED_FILES) {
		if (!existsSync(path.join(root, file))) {
			console.error(
				`Missing ${file} in project root. Run "npm run build" first.`
			);
			process.exitCode = 1;
			return;
		}
	}

	const manifest = JSON.parse(
		await readFile(path.join(root, "manifest.json"), "utf8")
	);
	const { id, version } = manifest;
	if (!id || !version) {
		console.error("manifest.json is missing id or version.");
		process.exitCode = 1;
		return;
	}

	await rm(distDir, { recursive: true, force: true });
	await mkdir(distDir, { recursive: true });

	// 1. Flat copies, for GitHub release assets.
	for (const file of REQUIRED_FILES) {
		await cp(path.join(root, file), path.join(distDir, file));
	}

	// 2. Plugin folder, for manual installation.
	const pluginDir = path.join(distDir, id);
	await mkdir(pluginDir, { recursive: true });
	for (const file of REQUIRED_FILES) {
		await cp(path.join(root, file), path.join(pluginDir, file));
	}

	console.log(`Packaged ${id} ${version}:`);
	console.log(`  dist/${id}/                              (manual install folder)`);
	console.log(`  dist/main.js, manifest.json, styles.css  (release assets)`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
