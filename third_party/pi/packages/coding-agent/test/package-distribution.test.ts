import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

interface CodingAgentPackageJson {
	name: string;
	bin?: { pi: string };
	main: string;
	exports: {
		".": { import: string };
		"./rpc-entry": { import: string };
	};
}

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as CodingAgentPackageJson;

// Kairo fork: this package is a private, unpublished-CLI dependency of the Kairo launcher.
// It is consumed as a library (dist/bundle/index.js and dist/bundle/rpc-entry.js), never
// invoked as a standalone `pi` executable. See NOTICE.md for the upstream/fork relationship.
describe("package distribution entrypoints (Kairo fork)", () => {
	test("is published under the Kairo scope with no CLI bin", () => {
		expect(packageJson.name).toBe("@kal-elsam/kairo-pi-coding-agent");
		expect(packageJson.bin).toBeUndefined();
	});

	test("exposes only the bundled library and rpc-entry entrypoints", () => {
		expect(packageJson.main).toBe("./dist/bundle/index.js");
		expect(packageJson.exports["."].import).toBe("./dist/bundle/index.js");
		expect(packageJson.exports["./rpc-entry"].import).toBe("./dist/bundle/rpc-entry.js");
	});
});
