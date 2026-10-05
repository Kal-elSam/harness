import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendCfprefsDiagnosticDelta,
  buildCfprefsShmReadDataAllowRule,
  buildPidLinkedSandboxCapturePlan,
  buildSandboxLogWindow,
  cfprefsObservedShmNames,
  freezeObservedProcessTree,
  linkSandboxEventsToObservedTree,
  parseSandboxOffenderEvent,
  parseSandboxOffenderEvents,
  profilePermissionsOtherwiseIntact,
  stripCfprefsDiagnosticDelta
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
  assert.match(rule, /ipc-posix-shm-read-data/);
  assert.match(rule, /\(ipc-posix-name "apple\.cfprefs\.501v1"\)/);
  assert.match(rule, /\(ipc-posix-name "apple\.cfprefs\.daemonv1"\)/);
  assert.doesNotMatch(rule, /notification_center/);
  assert.doesNotMatch(rule, /vfs\.disk-space/);
  assert.doesNotMatch(rule, /user-preference-read/);
  assert.doesNotMatch(rule, /ipc-posix-name-prefix/);
  assert.equal(profilePermissionsOtherwiseIntact(RUN3_BASELINE, body, { uid: 501 }), true);
  assert.equal(stripCfprefsDiagnosticDelta(body, { uid: 501 }), RUN3_BASELINE.endsWith("\n")
    ? RUN3_BASELINE
    : `${RUN3_BASELINE}\n`);
  assert.deepEqual(names, ["apple.cfprefs.501v1", "apple.cfprefs.daemonv1"]);
  // Any extra allow elsewhere breaks the intact check.
  const drifted = `${body}\n(allow file-read* (subpath "/etc"))\n`;
  assert.equal(profilePermissionsOtherwiseIntact(RUN3_BASELINE, drifted, { uid: 501 }), false);
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

test("PID linkage uses offender identity + observed tree; name alone is insufficient", () => {
  const tree = freezeObservedProcessTree([
    { pid: 100, ppid: 1, comm: "sandbox-exec" },
    { pid: 101, ppid: 100, comm: "codex" }
  ]);
  const events = parseSandboxOffenderEvents([
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

  const onlyForeign = linkSandboxEventsToObservedTree(
    parseSandboxOffenderEvents(
      "Sandbox: codex(9999) deny(1) ipc-posix-shm-read-data apple.cfprefs.daemonv1"
    ),
    tree
  );
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
  assert.ok(plan.requirements.some((item) => /offenderPid/i.test(item)));
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

    // Apple system.sb precedent still on disk — syntax witness only.
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
