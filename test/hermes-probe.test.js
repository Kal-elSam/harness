import test from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_DIAGNOSTIC_SURFACES,
  HERMES_MANDATORY_SURFACES,
  createHermesProbe,
  detectHermesDiagnosticSurfaces,
  probeHermes,
  resolveHermesBinaryPath
} from "../src/global/observability/hermes-probe.js";
import {
  ensureObservabilityProbesRegistered,
  buildObservabilitySnapshot,
  resetObservabilityProbesForTests,
  getObservabilityProbe,
  createGentleProbe,
  createGraphifyProbe,
  registerObservabilityProbe
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

function assertOpaque(out, ...forbidden) {
  const blob = JSON.stringify(out);
  for (const s of forbidden) assert.ok(!blob.includes(s), `leaked ${s}`);
}

function productiveProbe(handler) {
  return trackArgs((cmd, args, opts) => {
    if (cmd === "which" && args[0] === "hermes") return ok(ABS);
    return handler(cmd, args, opts);
  });
}

test("surface constants and help detection", () => {
  assert.deepEqual([...HERMES_DIAGNOSTIC_SURFACES], ["version", "doctor", "status"]);
  assert.deepEqual([...HERMES_MANDATORY_SURFACES], ["version", "doctor"]);
  const surfaces = detectHermesDiagnosticSurfaces(HELP_OK);
  assert.equal(surfaces.version, true);
  assert.equal(surfaces.doctor, true);
  assert.equal(surfaces.status, true);
  assert.equal(detectHermesDiagnosticSurfaces("usage: hermes").doctor, false);
});

test("resolveHermesBinaryPath rejects bare and empty", () => {
  assert.equal(resolveHermesBinaryPath("hermes", {}, { whichCommand: () => "" }), null);
  assert.equal(resolveHermesBinaryPath("hermes", {}, { whichCommand: () => "hermes" }), null);
  assert.equal(resolveHermesBinaryPath("hermes", {}, { whichCommand: () => ABS }), ABS);
});

test("productive which → --version → --help; sync throws fail-soft", async () => {
  const { calls, probeCommand } = productiveProbe((_c, args) => {
    if (args[0] === "--version") return ok("Hermes Agent v0.17.0 (2026.6.19)");
    if (args[0] === "--help") return ok(HELP_OK);
    throw new Error(`unexpected ${args.join(" ")}`);
  });
  const available = await probeHermes({ probeCommand });
  assert.equal(available.state, "available");
  assert.equal(available.version, "0.17.0");
  assert.equal(available.contractCompatible, true);
  assert.equal(available.evidence.find((e) => e.kind === "binary").path, ABS);
  assert.equal(available.evidence.find((e) => e.kind === "diagnostic_surfaces").executed, false);
  assert.deepEqual(
    calls.map((c) => ({ cmd: c.cmd, args: c.args, timeoutMs: c.timeoutMs })),
    [
      { cmd: "which", args: ["hermes"], timeoutMs: 3000 },
      { cmd: ABS, args: ["--version"], timeoutMs: 8000 },
      { cmd: ABS, args: ["--help"], timeoutMs: 8000 }
    ]
  );
  assert.equal(calls.filter((c) => c.cmd === "which").length, 1);
  for (const c of calls) {
    assert.ok(!c.args.includes("doctor") && !c.args.includes("status") && !c.args.includes("--fix"));
  }

  assert.equal((await probeHermes({
    probeCommand: (cmd) => (cmd === "which" ? ok("") : ok(""))
  })).state, "missing");

  const whichThrow = await probeHermes({
    probeCommand: () => { throw new Error("which boom secret=TOKEN"); }
  });
  assert.equal(whichThrow.state, "error");
  assert.equal(whichThrow.error, "spawn_error");
  assertOpaque(whichThrow, "TOKEN", "which boom");

  const versionThrow = await probeHermes({
    probeCommand: (cmd, args) => {
      if (cmd === "which") return ok(ABS);
      if (args[0] === "--version") throw new Error("version boom path=/Users/private");
      return ok(HELP_OK);
    }
  });
  assert.equal(versionThrow.state, "error");
  assert.equal(versionThrow.error, "spawn_error");
  assert.match(versionThrow.diagnostics.join(" "), /--version/);
  assertOpaque(versionThrow, "/Users/private");

  const helpThrow = await probeHermes({
    probeCommand: (cmd, args) => {
      if (cmd === "which") return ok(ABS);
      if (args[0] === "--version") return ok("hermes 1.0.0");
      throw new Error("help boom token=SECRET");
    }
  });
  assert.equal(helpThrow.state, "error");
  assert.equal(helpThrow.error, "spawn_error");
  assert.match(helpThrow.diagnostics.join(" "), /--help/);
  assertOpaque(helpThrow, "SECRET");
});

test("probeHermes missing / incompatible / spawn error envelopes", async () => {
  assert.equal((await probeHermes({
    whichCommand: () => "", probeCommand: () => ok("")
  })).state, "missing");
  assert.equal((await probeHermes({
    whichCommand: () => "hermes", probeCommand: () => ok("Hermes Agent v0.17.0")
  })).state, "missing");

  const badVersion = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, args) => args[0] === "--version" ? ok("not-a-version-string") : ok(HELP_OK)
  });
  assert.equal(badVersion.state, "incompatible");

  const noDoctor = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, args) => args[0] === "--version"
      ? ok("hermes 1.2.3")
      : ok("commands: version status chat gateway")
  });
  assert.equal(noDoctor.state, "incompatible");
  assert.match(noDoctor.diagnostics.join(" "), /doctor/);

  const timedOut = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: () => ({
      ok: false, status: null, timedOut: true, stdout: "", stderr: "secret=TOKEN", error: "ETIMEDOUT"
    })
  });
  assert.equal(timedOut.state, "error");
  assert.match(timedOut.diagnostics.join(" "), /timed out/);
  assertOpaque(timedOut, "TOKEN", "secret=");

  const nonZero = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: () => ({
      ok: false, status: 2, timedOut: false,
      stdout: "token=SECRET", stderr: "stack\n  at internal", error: null
    })
  });
  assert.equal(nonZero.state, "error");
  assert.match(String(nonZero.error), /exit 2/);
  assertOpaque(nonZero, "SECRET", "stack");

  const spawnErr = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: () => ({
      ok: false, status: null, timedOut: false, stdout: "", stderr: "", error: "ENOENT boom"
    })
  });
  assert.equal(spawnErr.state, "error");
  assert.equal(spawnErr.error, "spawn_error");
  assert.ok(!String(spawnErr.error).includes("ENOENT"));
});

test("hostile help never published; status optional", async () => {
  const hostileHelp = `${HELP_OK}\ntoken=SECRET\n/Users/private/.hermes/keys\n`;
  const out = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, args) => args[0] === "--version" ? ok("v1.0.0") : ok(hostileHelp)
  });
  assert.equal(out.state, "available");
  assertOpaque(out, "SECRET", "/Users/private", hostileHelp.slice(0, 40));

  const noStatus = await probeHermes({
    whichCommand: () => ABS,
    probeCommand: (_c, args) => args[0] === "--version"
      ? ok("hermes 2.0.0")
      : ok("commands: {version,doctor,chat}")
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
  assert.ok(getObservabilityProbe("hermes"));
  assert.ok(getObservabilityProbe("gentle"));
  assert.ok(getObservabilityProbe("graphify"));

  const probe = createHermesProbe({ whichCommand: () => "" });
  assert.equal(probe.id, "hermes");
  assert.deepEqual(probe.declaredEvents, []);
  assert.deepEqual(probe.declaredActions, []);
  assert.equal((await probe.probe({})).state, "missing");

  const snap = await buildObservabilitySnapshot({});
  assert.ok(snap.byId.hermes);
  assert.equal(snap.byId.hermes.state, "missing");
  assert.ok(snap.byId.gentle);
  assert.ok(snap.byId.graphify);
});
