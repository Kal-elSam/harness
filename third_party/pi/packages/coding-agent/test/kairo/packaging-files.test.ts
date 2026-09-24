/**
 * Kairo fork packaging regression test.
 *
 * The fork's package.json "files" field controls what `npm pack`/`npm
 * publish` actually ships. A narrow "files" list can build and pass every
 * other test while silently shipping a broken package: the interactive TUI
 * loads theme/component/utility assets from the built dist tree at runtime,
 * and none of that is exercised by importing the bundle in-process the way
 * the other kairo tests do.
 *
 * This test derives its expectations from the ACTUAL BUILT dist tree (and
 * the repo's docs/examples directories) instead of a hand-picked list of
 * assets, applies the same exclusion patterns upstream's package.json uses
 * ("!dist/client", "!dist/experimental", "!dist/cli/experimental"), and
 * fails if `npm pack --dry-run` would omit any runtime file that survives
 * those exclusions. It requires `dist` to already be built (the release
 * build, e.g. `npm run build:offline` at the repo root).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = new URL("../..", import.meta.url).pathname;

/** Upstream's package.json "files" exclusions for the dist tree (negated globs). */
const DIST_EXCLUSIONS = ["dist/client", "dist/experimental", "dist/cli/experimental"];

function isExcluded(posixRelativePath: string): boolean {
	return DIST_EXCLUSIONS.some(
		(excluded) => posixRelativePath === excluded || posixRelativePath.startsWith(`${excluded}/`),
	);
}

/** npm's own always-ignored basenames, applied regardless of "files". */
const NPM_DEFAULT_IGNORED_BASENAMES = new Set([".gitignore", ".npmignore", ".DS_Store", ".git"]);

function walkFiles(root: string, dir: string, out: string[]): string[] {
	for (const entry of readdirSync(dir)) {
		if (NPM_DEFAULT_IGNORED_BASENAMES.has(entry)) {
			continue;
		}
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			walkFiles(root, full, out);
		} else if (stat.isFile()) {
			out.push(relative(root, full).split(sep).join("/"));
		}
	}
	return out;
}

function expectedRuntimeFiles(): string[] {
	const distDir = join(packageRoot, "dist");
	if (!existsSync(distDir)) {
		throw new Error(
			`packages/coding-agent/dist is missing. Build the release bundle first (e.g. "npm run build:offline" at the repo root) before running this test.`,
		);
	}
	const distFiles = walkFiles(packageRoot, distDir, []).filter((path) => !isExcluded(path));

	const expected = [...distFiles];
	for (const extraDir of ["docs", "examples"]) {
		const fullDir = join(packageRoot, extraDir);
		if (existsSync(fullDir)) {
			expected.push(...walkFiles(packageRoot, fullDir, []));
		}
	}
	return expected;
}

interface NpmPackEntry {
	path: string;
}

interface NpmPackResult {
	files: NpmPackEntry[];
}

function packedFilePaths(): Set<string> {
	const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
		cwd: packageRoot,
		encoding: "utf8",
	});
	const [result] = JSON.parse(stdout) as NpmPackResult[];
	return new Set(result.files.map((entry) => entry.path));
}

describe("fork packaging (npm pack)", () => {
	it("packs every built runtime asset that survives upstream's dist exclusions", () => {
		const expected = expectedRuntimeFiles();
		const packed = packedFilePaths();

		const missing = expected.filter((path) => !packed.has(path));

		expect(missing).toEqual([]);
	});

	it("packs npm-shrinkwrap.json", () => {
		const packed = packedFilePaths();
		expect(packed.has("npm-shrinkwrap.json")).toBe(true);
	});

	it("packs the interactive TUI theme JSON files", () => {
		const themeDir = join(packageRoot, "dist", "modes", "interactive", "theme");
		if (!existsSync(themeDir)) {
			throw new Error(`${themeDir} is missing; build the release bundle first.`);
		}
		const themeFiles = walkFiles(packageRoot, themeDir, []).filter((path) => path.endsWith(".json"));
		expect(themeFiles.length).toBeGreaterThan(0);

		const packed = packedFilePaths();
		const missingThemeFiles = themeFiles.filter((path) => !packed.has(path));
		expect(missingThemeFiles).toEqual([]);
	});
});
