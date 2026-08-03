import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import { importGentleReviewBundle } from "../src/global/observability/gentle-bundle-import.js";
import {
  CONSENT_TYPES,
  PermissionAuthorityError,
  authorizeUnsafeOperation
} from "../src/global/runtime/run-permissions.js";
import { runGlobalReviews } from "../src/global/runtime/review/review-cli.js";

const availableProbe = {
  id: "gentle", state: "available", version: "2.2.4", contractCompatible: true,
  diagnostics: [], evidence: [{ kind: "binary", path: "/usr/bin/gentle-ai" }], error: null
};

test("import CLI parse + consent assertion + exact argv + mutation outcomes", async () => {
  const parsed = parseArgs([
    "reviews", "import", "--bundle", "/tmp/in.bundle", "--confirm-import", "--json"
  ]);
  assert.equal(parsed.options.reviewsAction, "import");
  assert.equal(parsed.options.bundlePath, "/tmp/in.bundle");
  assert.equal(parsed.options.confirmImport, true);
  assert.throws(
    () => parseArgs(["reviews", "import", "--confirm-import"]),
    /Missing --bundle/
  );

  assert.throws(
    () => authorizeUnsafeOperation({
      operation: "gentle-bundle-import", confirmed: false, source: "cli",
      consentType: CONSENT_TYPES.CLI_CONFIRM_IMPORT
    }),
    (e) => e instanceof PermissionAuthorityError && e.code === "import_consent_required"
  );
  const auth = authorizeUnsafeOperation({
    operation: "gentle-bundle-import", confirmed: true, source: "cli",
    consentType: CONSENT_TYPES.CLI_CONFIRM_IMPORT
  });
  assert.equal(auth.permissionAuthority.consent, "cli-confirm-import");
  assert.equal(auth.operation, "gentle-bundle-import");

  let invoked = false;
  const noConsent = await importGentleReviewBundle({
    bundlePath: "/tmp/in.bundle", cwd: "/repo", confirmImport: false,
    probeGentle: async () => availableProbe,
    probeCommand: () => { invoked = true; return { ok: true, status: 0 }; }
  });
  assert.equal(invoked, false);
  assert.equal(noConsent.code, "import_consent_required");
  assert.equal(noConsent.mutationOutcome, "not_started");

  for (const state of ["missing", "incompatible", "error"]) {
    const r = await importGentleReviewBundle({
      bundlePath: "/tmp/in.bundle", cwd: "/repo", confirmImport: true,
      probeGentle: async () => ({ ...availableProbe, state, diagnostics: [state] }),
      probeCommand: () => { throw new Error("no"); }
    });
    assert.equal(r.code, `gentle_${state}`);
    assert.equal(r.mutationOutcome, "not_started");
  }

  const unbound = await importGentleReviewBundle({
    bundlePath: "/tmp/in.bundle", cwd: "/repo", confirmImport: true,
    probeGentle: async () => ({
      ...availableProbe, evidence: [{ kind: "binary", path: "gentle-ai" }]
    }),
    probeCommand: () => { invoked = true; return { ok: true, status: 0 }; }
  });
  assert.equal(invoked, false);
  assert.equal(unbound.code, "gentle_binary_unbound");
  assert.equal(unbound.mutationOutcome, "not_started");

  let seen = null;
  const ok = await importGentleReviewBundle({
    bundlePath: "/work/in.bundle", cwd: "/work/repo", confirmImport: true,
    probeGentle: async () => availableProbe,
    probeCommand: (cmd, args) => {
      seen = { cmd, args: [...args] };
      return { ok: true, status: 0, stdout: "", stderr: "", error: null, timedOut: false };
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.code, "imported");
  assert.equal(ok.mutationOutcome, "committed");
  assert.equal(ok.permissionAuthority.consent, "cli-confirm-import");
  assert.equal(seen.cmd, "/usr/bin/gentle-ai");
  assert.deepEqual(seen.args, [
    "review-bundle-import", "--cwd", "/work/repo", "--bundle", "/work/in.bundle"
  ]);
  assert.ok(!seen.args.includes("--receipt"));
  assert.ok(!seen.args.includes("--request"));

  const secret = "token=sk-live-SECRET path=/Users/private/.ssh/id_rsa";
  for (const provider of [
    { ok: false, status: 3, stdout: "", stderr: secret, error: null, timedOut: false },
    { ok: false, status: null, stdout: "", stderr: secret, error: null, timedOut: true }
  ]) {
    const failed = await importGentleReviewBundle({
      bundlePath: "/tmp/in.bundle", cwd: "/repo", confirmImport: true,
      probeGentle: async () => availableProbe,
      probeCommand: () => provider
    });
    assert.equal(failed.code, "mutation_outcome_unknown");
    assert.equal(failed.mutationOutcome, "unknown");
    assert.ok(!("providerStderr" in failed));
    assert.equal(JSON.stringify(failed).includes("SECRET"), false);
    if (provider.timedOut) assert.ok(failed.diagnostics.includes("timed_out"));
    else assert.ok(failed.diagnostics.includes("status=3"));
  }

  const prev = process.exitCode;
  process.exitCode = undefined;
  const wiredFail = await runGlobalReviews({
    reviewsAction: "import", bundlePath: "/tmp/in.bundle",
    confirmImport: true, cwd: "/repo", json: true
  }, {}, {
    importGentleReviewBundle: async () => ({
      ok: false, exitCode: 2, code: "mutation_outcome_unknown",
      mutationOutcome: "unknown", diagnostics: ["provider_error", "status=3"],
      providerStatus: 3, timedOut: false,
      permissionAuthority: { mode: "unsafe", source: "cli", consent: "cli-confirm-import" }
    })
  });
  assert.equal(wiredFail.code, "mutation_outcome_unknown");
  assert.equal(wiredFail.exitCode, 2);
  assert.equal(process.exitCode, 2);
  assert.equal(JSON.stringify(wiredFail).includes("SECRET"), false);

  process.exitCode = undefined;
  const wiredOk = await runGlobalReviews({
    reviewsAction: "import", bundlePath: "/tmp/in.bundle",
    confirmImport: true, cwd: "/repo", json: true
  }, {}, {
    importGentleReviewBundle: async () => ({
      ok: true, exitCode: 0, code: "imported", mutationOutcome: "committed",
      diagnostics: [], providerStatus: 0, timedOut: false, binary: "/usr/bin/gentle-ai",
      permissionAuthority: { mode: "unsafe", source: "cli", consent: "cli-confirm-import" }
    })
  });
  assert.equal(wiredOk.code, "imported");
  assert.equal(wiredOk.mutationOutcome, "committed");
  assert.equal(process.exitCode, 0);
  process.exitCode = prev;
});
