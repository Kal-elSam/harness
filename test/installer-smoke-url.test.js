import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInstallScriptUrlArgs,
  resolveInstallScriptRef,
  resolveInstallScriptUrl,
  usesLegacyHarnessTag
} from "../scripts/lib/install-script-url.mjs";

test("resolveInstallScriptRef uses main for latest", () => {
  assert.equal(resolveInstallScriptRef({ version: "latest" }), "main");
  assert.equal(resolveInstallScriptRef({ version: "latest", tag: "kairo-runtime-v0.1.1" }), "main");
});

test("resolveInstallScriptRef uses explicit package-aware tag", () => {
  assert.equal(
    resolveInstallScriptRef({ version: "0.1.1", tag: "kairo-runtime-v0.1.1" }),
    "kairo-runtime-v0.1.1"
  );
});

test("resolveInstallScriptRef defaults kairo-runtime versions to package-aware tags", () => {
  assert.equal(resolveInstallScriptRef({ version: "0.1.3" }), "kairo-runtime-v0.1.3");
  assert.equal(resolveInstallScriptRef({ version: "0.1.1" }), "kairo-runtime-v0.1.1");
  assert.equal(resolveInstallScriptRef({ version: "0.2.0" }), "kairo-runtime-v0.2.0");
});

test("usesLegacyHarnessTag identifies pre-kairo-runtime releases", () => {
  assert.equal(usesLegacyHarnessTag("0.29.1"), true);
  assert.equal(usesLegacyHarnessTag("0.30.0"), true);
  assert.equal(usesLegacyHarnessTag("0.1.3"), false);
});

test("resolveInstallScriptRef falls back to legacy v-prefixed tag", () => {
  assert.equal(resolveInstallScriptRef({ version: "0.29.1" }), "v0.29.1");
  assert.equal(resolveInstallScriptRef({ version: "0.29.1", tag: null }), "v0.29.1");
});

test("resolveInstallScriptUrl builds raw GitHub install.sh URL", () => {
  assert.equal(
    resolveInstallScriptUrl({ version: "latest" }),
    "https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh"
  );
  assert.equal(
    resolveInstallScriptUrl({ version: "0.1.1", tag: "kairo-runtime-v0.1.1" }),
    "https://raw.githubusercontent.com/Kal-elSam/harness/kairo-runtime-v0.1.1/scripts/install.sh"
  );
  assert.equal(
    resolveInstallScriptUrl({ version: "0.1.3" }),
    "https://raw.githubusercontent.com/Kal-elSam/harness/kairo-runtime-v0.1.3/scripts/install.sh"
  );
  assert.equal(
    resolveInstallScriptUrl({ version: "0.29.1" }),
    "https://raw.githubusercontent.com/Kal-elSam/harness/v0.29.1/scripts/install.sh"
  );
});

test("parseInstallScriptUrlArgs accepts --version and --tag forms", () => {
  assert.deepEqual(
    parseInstallScriptUrlArgs(["node", "script", "--version", "0.1.1", "--tag", "kairo-runtime-v0.1.1"]),
    { version: "0.1.1", tag: "kairo-runtime-v0.1.1", repo: "Kal-elSam/harness" }
  );
  assert.deepEqual(
    parseInstallScriptUrlArgs(["node", "script", "--version=0.29.1"]),
    { version: "0.29.1", tag: null, repo: "Kal-elSam/harness" }
  );
});
