// Bundles every tests/*.test.ts with esbuild (aliasing `obsidian` to the local
// stub) and hands the output to Node's built-in test runner.
//
// Bundling rather than transpiling in-process keeps the test setup identical
// to how the plugin itself is built, so a test never passes against code the
// bundler would have rejected.

import esbuild from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(testsDir);
const outDir = path.join(root, ".test-build");

const entryPoints = readdirSync(testsDir)
	.filter((name) => name.endsWith(".test.ts"))
	.map((name) => path.join(testsDir, name));

if (entryPoints.length === 0) {
	console.error("No test files found in tests/.");
	process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });

await esbuild.build({
	entryPoints,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	outdir: outDir,
	sourcemap: "inline",
	logLevel: "warning",
	alias: { obsidian: path.join(testsDir, "helpers", "obsidian.ts") },
	// Node's own modules stay external; everything else is bundled in.
	external: ["node:*"],
	outExtension: { ".js": ".mjs" },
});

// Explicit file paths, not the directory: `node --test <dir>` resolves the
// directory as a module rather than scanning it.
const builtTests = readdirSync(outDir)
	.filter((name) => name.endsWith(".test.mjs"))
	.map((name) => path.join(outDir, name));

const child = spawn(
	process.execPath,
	[
		"--test",
		...(process.argv.includes("--watch") ? ["--watch"] : []),
		...builtTests,
	],
	{ stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 1));
