import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  exportGentleReviewBundle,
  resolveNegotiatedGentleBinary
} from "../src/global/observability/gentle-bundle-export.js";
import { probeGentle } from "../src/global/observability/gentle-probe.js";
import { runGlobalReviews } from "../src/global/runtime/review/review-cli.js";

const availableProbe = {
  id: "gentle", state: "available", version: "2.2.4", contractCompatible: true,
  diagnostics: [], evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }], error: null
};
const capsOk = () => ({
  schema: "gentle-ai.review-integration.capabilities/v2",
  contract: "gentle-ai.review-integration/v2",
  protocol: { major: 2, minor: 0 },
  package: { name: "gentle-ai", version: "2.2.4" },
  features: {
    mandatory: [
      "compact_v2_authority", "exact_receipt_replay", "five_delivery_gates",
      "immutable_snapshot", "legacy_v1_target_scoped_read_only",
      "repository_independent_capabilities", "restart_safe_projection",
      "sdd_receipt_binding", "target_scoped_status", "uniform_failure_envelope"
    ].map((name) => ({ name, supported: true, requires: [] })),
    optional: []
  }
});

test("export CLI + absolute binary binding + typed provider errors", async () => {
  const parsed = parseArgs([
    "reviews", "export", "review-aaaaaaaaaaaaaaaa", "--out", "/tmp/bundle.json", "--json"
  ]);
  assert.equal(parsed.options.reviewsAction, "export");
  assert.equal(parsed.options.lineage, "review-aaaaaaaaaaaaaaaa");
  assert.throws(() => parseArgs(["reviews", "export", "--out", "/tmp/x.json"]), /Missing lineage/);

  assert.equal((await probeGentle({
    whichCommand: () => "gentle-ai",
    probeCommand: () => { throw new Error("shadow"); }
  })).state, "missing");

  const absolute = await probeGentle({
    whichCommand: () => "/opt/gentle/bin/gentle-ai",
    probeCommand: (_c, args) => args.includes("capabilities")
      ? { ok: true, status: 0, stdout: JSON.stringify(capsOk()), stderr: "", error: null }
      : { ok: true, status: 0, stdout: "gentle-ai 2.2.4", stderr: "", error: null }
  });
  assert.equal(absolute.state, "available");
  assert.equal(absolute.evidence.find((e) => e.kind === "binary").path, "/opt/gentle/bin/gentle-ai");

  for (const state of ["missing", "incompatible", "error"]) {
    const r = await exportGentleReviewBundle({
      lineage: "review-aaaaaaaaaaaaaaaa", outPath: "/tmp/out.bundle", cwd: "/repo",
      probeGentle: async () => ({ ...availableProbe, state, diagnostics: [state] }),
      probeCommand: () => { throw new Error("no"); }
    });
    assert.equal(r.code, `gentle_${state}`);
  }

  assert.equal(resolveNegotiatedGentleBinary({ evidence: [{ kind: "binary", path: "gentle-ai" }] }), null);
  let invoked = false;
  const unbound = await exportGentleReviewBundle({
    lineage: "review-aaaaaaaaaaaaaaaa", outPath: "/tmp/out.bundle", cwd: "/repo",
    probeGentle: async () => ({ ...availableProbe, evidence: [{ kind: "binary", path: "gentle-ai" }] }),
    probeCommand: () => { invoked = true; return { ok: true, status: 0, stdout: "", stderr: "", error: null }; }
  });
  assert.equal(invoked, false);
  assert.equal(unbound.code, "gentle_binary_unbound");

  const dir = await mkdtemp(join(tmpdir(), "kairo-export-"));
  const outPath = join(dir, "bundle.bin");
  const sentinel = Buffer.from("GENTLE-AUTHORITY-BYTES-DO-NOT-TOUCH");
  let seen = null;
  const ok = await exportGentleReviewBundle({
    lineage: "review-4d877864f603b4e5", outPath, cwd: "/work/repo",
    probeGentle: async () => availableProbe,
    probeCommand: (cmd, args) => {
      seen = { cmd, args: [...args] };
      writeFileSync(outPath, sentinel);
      return { ok: true, status: 0, stdout: "exported", stderr: "", error: null, timedOut: false };
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(seen.cmd, "/usr/bin/gentle-ai");
  assert.deepEqual(await readFile(outPath), sentinel);

  const secret = "token=sk-live-SECRET path=/Users/private/.ssh/id_rsa";
  const failed = await exportGentleReviewBundle({
    lineage: "review-aaaaaaaaaaaaaaaa", outPath: "/tmp/out.bundle", cwd: "/repo",
    probeGentle: async () => availableProbe,
    probeCommand: () => ({
      ok: false, status: 3, stdout: "", stderr: secret, error: null, timedOut: false
    })
  });
  assert.equal(failed.code, "provider_error");
  assert.ok(!("providerStderr" in failed));
  assert.deepEqual(failed.diagnostics, ["provider_error", "status=3"]);
  assert.equal(JSON.stringify(failed).includes("SECRET"), false);

  const prev = process.exitCode;
  process.exitCode = undefined;
  const wired = await runGlobalReviews({
    reviewsAction: "export", lineage: "review-aaaaaaaaaaaaaaaa",
    outPath: "/tmp/bundle.json", cwd: "/repo", json: true
  }, {}, { exportGentleReviewBundle: async () => failed });
  assert.equal(JSON.stringify(wired).includes("SECRET"), false);
  process.exitCode = prev;
});
