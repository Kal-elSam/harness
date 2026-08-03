import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import { exportGentleReviewBundle } from "../src/global/observability/gentle-bundle-export.js";
import { runGlobalReviews } from "../src/global/runtime/review/review-cli.js";

const availableProbe = {
  id: "gentle",
  state: "available",
  version: "2.2.4",
  contractCompatible: true,
  diagnostics: [],
  evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }],
  error: null
};

test("parseArgs: reviews export requires lineage and accepts --out", () => {
  const parsed = parseArgs([
    "reviews", "export", "review-aaaaaaaaaaaaaaaa", "--out", "/tmp/bundle.json", "--json"
  ]);
  assert.equal(parsed.options.reviewsAction, "export");
  assert.equal(parsed.options.lineage, "review-aaaaaaaaaaaaaaaa");
  assert.equal(parsed.options.outPath, "/tmp/bundle.json");
  assert.equal(parsed.options.json, true);
  assert.throws(
    () => parseArgs(["reviews", "export", "--out", "/tmp/x.json"]),
    /Missing lineage/
  );
});

test("exportGentleReviewBundle fail-closed when probe not available", async () => {
  for (const state of ["missing", "incompatible", "error"]) {
    const result = await exportGentleReviewBundle({
      lineage: "review-aaaaaaaaaaaaaaaa",
      outPath: "/tmp/out.bundle",
      cwd: "/repo",
      probeGentle: async () => ({
        ...availableProbe, state, contractCompatible: false, diagnostics: [state]
      }),
      probeCommand: () => { throw new Error("must not invoke provider"); }
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, `gentle_${state}`);
  }
});

test("exportGentleReviewBundle invokes exact Gentle argv and leaves bundle bytes alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kairo-export-"));
  const outPath = join(dir, "bundle.bin");
  const sentinel = Buffer.from("GENTLE-AUTHORITY-BYTES-DO-NOT-TOUCH");
  let seen = null;

  const result = await exportGentleReviewBundle({
    lineage: "review-4d877864f603b4e5",
    outPath,
    cwd: "/work/repo",
    probeGentle: async () => availableProbe,
    probeCommand: (cmd, args, opts) => {
      seen = { cmd, args: [...args], cwd: opts.cwd };
      writeFileSync(outPath, sentinel);
      return { ok: true, status: 0, stdout: "exported", stderr: "", error: null, timedOut: false };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.lineage, "review-4d877864f603b4e5");
  assert.equal(result.outPath, outPath);
  assert.equal(seen.cmd, "/usr/bin/gentle-ai");
  assert.deepEqual(seen.args, [
    "review-bundle-export",
    "--cwd", "/work/repo",
    "--lineage", "review-4d877864f603b4e5",
    "--out", outPath
  ]);
  assert.deepEqual(await readFile(outPath), sentinel);
});

test("exportGentleReviewBundle provider error is fail-closed", async () => {
  const result = await exportGentleReviewBundle({
    lineage: "review-aaaaaaaaaaaaaaaa",
    outPath: "/tmp/out.bundle",
    cwd: "/repo",
    probeGentle: async () => availableProbe,
    probeCommand: () => ({
      ok: false, status: 3, stdout: "", stderr: "export failed", error: null, timedOut: false
    })
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "provider_error");
  assert.match(result.diagnostics.join(" "), /export failed|exit 3/);
});

test("runGlobalReviews export wires structured JSON diagnostics", async () => {
  const prev = process.exitCode;
  process.exitCode = undefined;
  const result = await runGlobalReviews({
    reviewsAction: "export",
    lineage: "review-aaaaaaaaaaaaaaaa",
    outPath: "/tmp/bundle.json",
    cwd: "/repo",
    json: true
  }, {}, {
    exportGentleReviewBundle: async () => ({
      ok: false,
      exitCode: 2,
      code: "gentle_missing",
      lineage: "review-aaaaaaaaaaaaaaaa",
      outPath: "/tmp/bundle.json",
      diagnostics: ["gentle-ai not found in PATH"],
      providerStatus: null
    })
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "gentle_missing");
  assert.equal(process.exitCode, 2);
  process.exitCode = prev;
});
