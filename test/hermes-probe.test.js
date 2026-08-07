import test from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_DIAGNOSTIC_SURFACES, HERMES_MANDATORY_SURFACES, createHermesProbe,
  detectHermesDiagnosticSurfaces, probeHermes, resolveHermesBinaryPath
} from "../src/global/observability/hermes-probe.js";
import {
  ensureObservabilityProbesRegistered, buildObservabilitySnapshot,
  resetObservabilityProbesForTests, getObservabilityProbe,
  createGentleProbe, createGraphifyProbe, registerObservabilityProbe
} from "../src/global/observability/index.js";

const ABS = "/usr/local/bin/hermes";
const HELP_OK = `usage: hermes
  {chat,status,doctor,sessions,version} ...
    version   Show version
    doctor    Check configuration
    status    Show status
`;

function trackArgs(handler) {
  const calls = [];
  const probeCommand = (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], timeoutMs: opts?.timeoutMs });
    return handler(cmd, args, opts);
  };
  return { calls, probeCommand };
}

function ok(stdout) {
  return { ok: true, status: 0, stdout, stderr: "", error: null, timedOut: false };
}

function failEnv({ timedOut = false, status = null, error = null, stderr = "" } = {}) {
  return { ok: false, status, timedOut, stdout: "", stderr, error };
}

function assertOpaque(out, ...forbidden) {
  const blob = JSON.stringify(out);
  for (const s of forbidden) assert.ok(!blob.includes(s), `leaked ${s}`);
}

test("surface constants and help detection", () => {
  assert.deepEqual([...HERMES_DIAGNOSTIC_SURFACES], ["version", "doctor", "status"]);
  assert.deepEqual([...HERMES_MANDATORY_SURFACES], ["version", "doctor"]);
  const surfaces = detectHermesDiagnosticSurfaces(HELP_OK);
  assert.equal(surfaces.version && surfaces.doctor && surfaces.status, true);
  assert.equal(detectHermesDiagnosticSurfaces("usage: hermes").doctor, false);
});

test("resolveHermesBinaryPath rejects bare and empty", () => {
  assert.equal(resolveHermesBinaryPath("hermes", {}, { whichCommand: () => "" }), null);
  assert.equal(resolveHermesBinaryPath("hermes", {}, { whichCommand: () => "hermes" }), null);
  assert.equal(resolveHermesBinaryPath("hermes", {}, { whichCommand: () => ABS }), ABS);
});

test("productive which path + envelopes (no whichCommand inject)", async () => {
  const { calls, probeCommand } = trackArgs((cmd, args) => {
    if (cmd === "which" && args[0] === "hermes") return ok(ABS);
    if (cmd === ABS && args[0] === "--version") return ok("Hermes Agent v0.17.0 (2026.6.19)");
    if (cmd === ABS && args[0] === "--help") return ok(HELP_OK);
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  });
  const available = await probeHermes({ probeCommand });
  assert.equal(available.state, "available");
  assert.equal(available.version, "0.17.0");
  assert.equal(available.contractCompatible, true);
  assert.equal(available.evidence.find((e) => e.kind === "binary").path, ABS);
  assert.equal(available.evidence.find((e) => e.kind === "diagnostic_surfaces").executed, false);
  assert.deepEqual(calls.map((c) => ({ cmd: c.cmd, args: c.args, timeoutMs: c.timeoutMs })), [
    { cmd: "which", args: ["hermes"], timeoutMs: 3000 },
    { cmd: ABS, args: ["--version"], timeoutMs: 8000 },
    { cmd: ABS, args: ["--help"], timeoutMs: 8000 }
  ]);
  assert.equal(calls.filter((c) => c.cmd === "which").length, 1);
  for (const c of calls) {
    assert.ok(!c.args.includes("doctor") && !c.args.includes("status") && !c.args.includes("--fix"));
  }

  // Absence ≠ failure: exit 1 / empty stdout → missing.
  assert.equal((await probeHermes({
    probeCommand: () => failEnv({ status: 1 })
  })).state, "missing");
  assert.equal((await probeHermes({
    probeCommand: (cmd) => (cmd === "which" ? ok("") : ok(""))
  })).state, "missing");

  const whichTimeout = await probeHermes({
    probeCommand: () => failEnv({ timedOut: true, error: "ETIMEDOUT", stderr: "secret=TOKEN" })
  });
  assert.equal(whichTimeout.state, "error");
  assert.equal(whichTimeout.error, "timeout");
  assert.match(whichTimeout.diagnostics.join(" "), /which.*timed out/);
  assertOpaque(whichTimeout, "TOKEN", "secret=");

  const whichEnoent = await probeHermes({
    probeCommand: () => failEnv({ error: "ENOENT boom" })
  });
  assert.equal(whichEnoent.state, "error");
  assert.equal(whichEnoent.error, "spawn_error");
  assert.match(whichEnoent.diagnostics.join(" "), /which/);
  assertOpaque(whichEnoent, "ENOENT");

  const whichThrow = await probeHermes({
    probeCommand: () => { throw new Error("which boom secret=TOKEN"); }
  });
  assert.equal(whichThrow.state, "error");
  assert.equal(whichThrow.error, "spawn_error");
  assertOpaque(whichThrow, "TOKEN", "which boom");

  const versionThrow = await probeHermes({
    probeCommand: (cmd, args) => {
      if (cmd === "which") return ok(ABS);
      if (args[0] === "--version") throw new Error("boom path=/Users/private");
      return ok(HELP_OK);
    }
  });
  assert.equal(versionThrow.state, "error");
  assert.equal(versionThrow.error, "spawn_error");
  assert.match(versionThrow.diagnostics.join(" "), /--version/);
  assertOpaque(versionThrow, "/Users/private");
});

test("probeHermes missing / incompatible / spawn error envelopes", async () => {
  assert.equal((await probeHermes({
    whichCommand: () => "", probeCommand: () => ok("")
  })).state, "missing");
  assert.equal((await probeHermes({
    whichCommand: () => "hermes", probeCommand: () => ok("v1")
  })).state, "missing");

  assert.equal((await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, a) => a[0] === "--version" ? ok("not-a-version") : ok(HELP_OK)
  })).state, "incompatible");

  const noDoctor = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, a) => a[0] === "--version" ? ok("hermes 1.2.3") : ok("commands: version status")
  });
  assert.equal(noDoctor.state, "incompatible");
  assert.match(noDoctor.diagnostics.join(" "), /doctor/);

  const timedOut = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: () => failEnv({ timedOut: true, error: "ETIMEDOUT", stderr: "secret=TOKEN" })
  });
  assert.equal(timedOut.state, "error");
  assert.match(timedOut.diagnostics.join(" "), /timed out/);
  assertOpaque(timedOut, "TOKEN", "secret=");

  const nonZero = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: () => ({
      ok: false, status: 2, timedOut: false, stdout: "token=SECRET", stderr: "stack", error: null
    })
  });
  assert.equal(nonZero.state, "error");
  assert.match(String(nonZero.error), /exit 2/);
  assertOpaque(nonZero, "SECRET", "stack");

  const spawnErr = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: () => failEnv({ error: "ENOENT boom" })
  });
  assert.equal(spawnErr.state, "error");
  assert.equal(spawnErr.error, "spawn_error");
});

test("hostile help never published; status optional", async () => {
  const hostile = `${HELP_OK}\ntoken=SECRET\n/Users/private/.hermes/keys\n`;
  const out = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, a) => a[0] === "--version" ? ok("v1.0.0") : ok(hostile)
  });
  assert.equal(out.state, "available");
  assertOpaque(out, "SECRET", "/Users/private", hostile.slice(0, 40));

  const noStatus = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, a) => a[0] === "--version" ? ok("hermes 2.0.0") : ok("commands: {version,doctor}")
  });
  assert.equal(noStatus.state, "available");
  assert.match(noStatus.diagnostics.join(" "), /status/);
});

test("createHermesProbe + soft snapshot registration", async () => {
  resetObservabilityProbesForTests();
  registerObservabilityProbe(createGentleProbe({ whichCommand: () => "" }));
  registerObservabilityProbe(createGraphifyProbe({ whichCommand: () => "" }));
  registerObservabilityProbe(createHermesProbe({ whichCommand: () => "" }));
  ensureObservabilityProbesRegistered();
  assert.ok(getObservabilityProbe("hermes") && getObservabilityProbe("gentle") && getObservabilityProbe("graphify"));
  const probe = createHermesProbe({ whichCommand: () => "" });
  assert.equal(probe.id, "hermes");
  assert.deepEqual(probe.declaredEvents, []);
  assert.deepEqual(probe.declaredActions, []);
  assert.equal((await probe.probe({})).state, "missing");
  const snap = await buildObservabilitySnapshot({});
  assert.equal(snap.byId.hermes.state, "missing");
  assert.ok(snap.byId.gentle && snap.byId.graphify);
});
