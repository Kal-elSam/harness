import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendCfprefsDiagnosticDelta,
  assertPositivePid,
  buildCfprefsShmReadDataAllowRule,
  buildPidLinkedSandboxCapturePlan,
  buildSandboxLogWindow,
  cfprefsObservedShmNames,
  expectedCfprefsDiagnosticVariant,
  freezeObservedProcessTree,
  linkSandboxEventsToObservedTree,
  parseSandboxOffenderEvent,
  parseSandboxOffenderEvents,
  profilePermissionsOtherwiseIntact
} from "../src/global/runtime/codex-delegated-write-canary-cfprefs-diagnostic.js";

const RUN3_BASELINE = `(version 1)
(deny default)
(allow process-fork)
(allow process-exec
  (subpath "/usr")
  (subpath "/bin")
  (literal "/usr/bin/true")
)
(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/System")
  (literal "/dev/null"))
(allow file-read-metadata
  (literal "/"))
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
(allow network*)
(allow system-socket)
`;

test("cfprefs names pin uid segment and daemonv1 only", () => {
  assert.deepEqual(cfprefsObservedShmNames(501), [
    "apple.cfprefs.501v1",
    "apple.cfprefs.daemonv1"
  ]);
  assert.deepEqual(cfprefsObservedShmNames(502), [
    "apple.cfprefs.502v1",
    "apple.cfprefs.daemonv1"
  ]);
});

test("diagnostic delta appends exact rule and leaves other permissions intact", () => {
  const { body, rule, names } = appendCfprefsDiagnosticDelta(RUN3_BASELINE, { uid: 501 });
  const expected = expectedCfprefsDiagnosticVariant(RUN3_BASELINE, { uid: 501 });
  assert.equal(body, expected.body);
  assert.match(rule, /ipc-posix-shm-read-data/);
  assert.match(rule, /\(ipc-posix-name "apple\.cfprefs\.501v1"\)/);
  assert.match(rule, /\(ipc-posix-name "apple\.cfprefs\.daemonv1"\)/);
  assert.doesNotMatch(rule, /notification_center/);
  assert.doesNotMatch(rule, /vfs\.disk-space/);
  assert.doesNotMatch(rule, /user-preference-read/);
  assert.doesNotMatch(rule, /ipc-posix-name-prefix/);
  assert.equal(profilePermissionsOtherwiseIntact(RUN3_BASELINE, body, { uid: 501 }), true);
  assert.deepEqual(names, ["apple.cfprefs.501v1", "apple.cfprefs.daemonv1"]);
  const drifted = `${body}\n(allow file-read* (subpath "/etc"))\n`;
  assert.equal(profilePermissionsOtherwiseIntact(RUN3_BASELINE, drifted, { uid: 501 }), false);
});

test("regression: preexisting exact rule is alreadyPresent; duplicate delta is not intact", () => {
  const once = appendCfprefsDiagnosticDelta(RUN3_BASELINE, { uid: 501 });
  const again = appendCfprefsDiagnosticDelta(once.body, { uid: 501 });
  assert.equal(again.alreadyPresent, true);
  assert.equal(again.body, once.body);
  assert.equal(profilePermissionsOtherwiseIntact(once.body, again.body, { uid: 501 }), true);
  // alreadyPresent means no differential treatment — not a valid A/B Arm B.
  assert.equal(
    again.alreadyPresent && again.body === once.body,
    true,
    "Arm B must append a fresh delta (alreadyPresent:false); preexisting rule is not treatment"
  );

  const duplicated = `${once.body}\n${once.rule}\n`;
  assert.equal(profilePermissionsOtherwiseIntact(RUN3_BASELINE, duplicated, { uid: 501 }), false);
  assert.throws(
    () => appendCfprefsDiagnosticDelta(duplicated, { uid: 501 }),
    /more than once/
  );
});

test("sandbox offender parser extracts process + pid + operation + resource", () => {
  const event = parseSandboxOffenderEvent(
    "Sandbox: codex(4242) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1"
  );
  assert.deepEqual(event, {
    offenderProcess: "codex",
    offenderPid: 4242,
    decision: "deny",
    decisionCode: 1,
    operation: "ipc-posix-shm-read-data",
    resource: "apple.cfprefs.501v1",
    raw: "Sandbox: codex(4242) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1"
  });
});

test("regression: multiline Sandbox capture coalesces continuation onto header", () => {
  const parsed = parseSandboxOffenderEvents([
    "Sandbox: codex(101) deny(1) ipc-posix-shm-read-data",
    "  apple.cfprefs.501v1",
    "Sandbox: codex(101) deny(1) ipc-posix-shm-read-data",
    "\tapple.cfprefs.daemonv1"
  ].join("\n"));
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].resource, "apple.cfprefs.501v1");
  assert.equal(parsed.events[1].resource, "apple.cfprefs.daemonv1");
  assert.equal(parsed.unparsedRelevantLines.length, 0);
});

test("regression: unknown relevant line is preserved, not silent-dropped", () => {
  const parsed = parseSandboxOffenderEvents([
    "Sandbox: codex(101) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1",
    "Sandbox: weird-shape without-parens deny shm",
    "unrelated noise line",
    "cfprefsd: something odd in the window"
  ].join("\n"));
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.unparsedRelevantLines.length, 2);
  assert.match(parsed.unparsedRelevantLines[0].line, /weird-shape/);
  assert.match(parsed.unparsedRelevantLines[1].line, /cfprefsd/);
});

test("regression: invalid offender PID throws; plan rejects NaN sandboxExecPid", () => {
  assert.throws(() => assertPositivePid(0, "pid"), /positive integer/);
  assert.throws(() => assertPositivePid(-3, "pid"), /positive integer/);
  assert.throws(() => assertPositivePid(Number.NaN, "pid"), /positive integer/);
  assert.throws(
    () => parseSandboxOffenderEvent("Sandbox: codex(0) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1"),
    /positive integer/
  );
  assert.throws(
    () => freezeObservedProcessTree([{ pid: -1, comm: "codex" }]),
    /positive integer/
  );
  assert.throws(
    () => buildPidLinkedSandboxCapturePlan({
      startedAt: "2026-10-05T18:31:42.791Z",
      endedAt: "2026-10-05T18:31:42.916Z",
      sandboxExecPid: Number.NaN,
      observedTree: [{ pid: 100, ppid: 1, comm: "sandbox-exec" }]
    }),
    /positive integer/
  );
  const invalidInLog = parseSandboxOffenderEvents(
    "Sandbox: codex(0) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1"
  );
  assert.equal(invalidInLog.events.length, 0);
  assert.equal(invalidInLog.unparsedRelevantLines.length, 1);
  assert.match(invalidInLog.unparsedRelevantLines[0].reason, /positive integer/);
});

test("PID linkage uses offender identity + observed tree; name alone is insufficient", () => {
  const tree = freezeObservedProcessTree([
    { pid: 100, ppid: 1, comm: "sandbox-exec" },
    { pid: 101, ppid: 100, comm: "codex" }
  ]);
  const { events } = parseSandboxOffenderEvents([
    "Sandbox: codex(101) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1",
    "Sandbox: codex(9999) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1",
    "Sandbox: kernelmanagerd(50) deny(1) system-info vfs.disk-space"
  ].join("\n"));

  const linked = linkSandboxEventsToObservedTree(events, tree, { sandboxExecPid: 100 });
  assert.equal(linked.linkedCfprefs.length, 1);
  assert.equal(linked.linkedCfprefs[0].offenderPid, 101);
  assert.equal(linked.unlinkedCfprefs.length, 1);
  assert.equal(linked.unlinkedCfprefs[0].offenderPid, 9999);
  assert.equal(linked.hasPidLinkedCfprefsSignal, true);
  assert.equal(linked.hasPidUnlinkedCfprefsSignal, true);
  assert.equal(linked.inconclusivePidUnlinked, false);

  const { events: foreignOnly } = parseSandboxOffenderEvents(
    "Sandbox: codex(9999) deny(1) ipc-posix-shm-read-data apple.cfprefs.daemonv1"
  );
  const onlyForeign = linkSandboxEventsToObservedTree(foreignOnly, tree);
  assert.equal(onlyForeign.inconclusivePidUnlinked, true);
  assert.equal(onlyForeign.hasPidLinkedCfprefsSignal, false);
});

test("capture plan bounds the log window and records tree + precedent caveat", () => {
  const plan = buildPidLinkedSandboxCapturePlan({
    startedAt: "2026-10-05T18:31:42.791Z",
    endedAt: "2026-10-05T18:31:42.916Z",
    padBeforeMs: 2000,
    padAfterMs: 2000,
    sandboxExecPid: 100,
    observedTree: [
      { pid: 100, ppid: 1, comm: "sandbox-exec" },
      { pid: 101, ppid: 100, comm: "codex" }
    ],
    uid: 501
  });
  const window = buildSandboxLogWindow({
    startedAt: plan.window.startedAt,
    endedAt: plan.window.endedAt,
    padBeforeMs: 2000,
    padAfterMs: 2000
  });
  assert.equal(plan.window.windowStartIso, window.windowStartIso);
  assert.equal(plan.window.windowEndIso, window.windowEndIso);
  assert.deepEqual(plan.treePids, [100, 101]);
  assert.equal(plan.doesNotProveCodexFix, true);
  assert.match(plan.syntaxPrecedent.path, /system\.sb$/);
  assert.match(plan.syntaxPrecedent.note, /does not prove Codex/);
  assert.ok(plan.requirements.some((item) => /inconclusive_pid_unlinked only when/i.test(item)));
  assert.ok(plan.requirements.some((item) => /unparsed/i.test(item)));
});

test("offline SBPL accepts exact ipc-posix-name rule on darwin (syntax only)", (t) => {
  if (process.platform !== "darwin") {
    t.skip("sandbox-exec is macOS-only");
    return;
  }

  const evidenceProfile =
    `${process.env.HOME}/.harness/canary-evidence/delegated-write-20261005T123142/profile.sb`;
  let run3Baseline;
  try {
    run3Baseline = readFileSync(evidenceProfile, "utf8");
  } catch {
    t.skip("run3 evidence profile not present on this host");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "cfprefs-sbpl-"));
  try {
    const { body, rule } = appendCfprefsDiagnosticDelta(run3Baseline, { uid: 501 });
    assert.equal(body.includes(rule), true);
    assert.equal(profilePermissionsOtherwiseIntact(run3Baseline, body, { uid: 501 }), true);

    const goodPath = join(dir, "good.sb");
    writeFileSync(goodPath, body, "utf8");
    const good = spawnSync("/usr/bin/sandbox-exec", ["-f", goodPath, "/usr/bin/true"], {
      encoding: "utf8"
    });
    assert.equal(good.status, 0, `expected parse+exec ok, stderr=${good.stderr}`);
    assert.doesNotMatch(good.stderr ?? "", /unbound variable/i);

    const badPath = join(dir, "bad.sb");
    writeFileSync(
      badPath,
      `${run3Baseline}\n(allow ipc-posix-shm-read-data (ipc-posix-name-TYPO "x"))\n`,
      "utf8"
    );
    const bad = spawnSync("/usr/bin/sandbox-exec", ["-f", badPath, "/usr/bin/true"], {
      encoding: "utf8"
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /unbound variable:\s*ipc-posix-name-TYPO/i);

    const systemSb = readFileSync("/System/Library/Sandbox/Profiles/system.sb", "utf8");
    assert.match(systemSb, /ipc-posix-name-prefix "apple\.cfprefs\."/);
    assert.match(systemSb, /ipc-posix-shm-read\*/);
    assert.equal(
      buildCfprefsShmReadDataAllowRule({ uid: 501 }).includes("ipc-posix-name-prefix"),
      false,
      "diagnostic stays on exact names, not Apple's broader prefix"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
