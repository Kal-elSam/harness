/**
 * The shared PTY e2e harness (scripts/kairo-ui-ask-pty-e2e.py, class Pty) must never block
 * forever while tearing down its child. On macos-15-intel the packaged verify hung in
 * `os.waitpid(pid, 0)` after SIGKILL (faulthandler traceback: Pty.kill -> waitpid), because the
 * child can sit in exit waiting for unread tty output while the master was still open.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HARNESS = fileURLToPath(new URL("../scripts/kairo-ui-ask-pty-e2e.py", import.meta.url));

function py(snippet) {
  return spawnSync("python3", ["-I", "-c", snippet], { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH } });
}

const LOAD = `
import importlib.util, os, signal, sys, time
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("ask_pty", ${JSON.stringify(HARNESS)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
Pty = mod.Pty
`;

test("Pty.kill gives up on a child that never becomes reapable instead of blocking forever", () => {
  const run = py(`${LOAD}
p = object.__new__(Pty)
p.pid = 424242
p.status = None
p.master = os.openpty()[0]
os.kill = lambda pid, sig: None            # SIGKILL "sent"
os.waitpid = lambda pid, flags: (0, 0) if flags & os.WNOHANG else time.sleep(3600)  # blocking wait would hang
start = time.monotonic()
p.kill(reap_timeout=0.5)
elapsed = time.monotonic() - start
print("elapsed=%.2f status=%s" % (elapsed, p.status))
assert elapsed < 5, elapsed
assert p.status == -1
`);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /elapsed=\d\.\d\d status=-1/);
});

test("Pty.kill closes the PTY master before it waits for the child (a child exiting with unread tty output needs it)", () => {
  const run = py(`${LOAD}
order = []
real_close, real_waitpid = os.close, os.waitpid
master, slave = os.openpty()
p = object.__new__(Pty)
p.pid = 424243
p.status = None
p.master = master
os.kill = lambda pid, sig: order.append("kill")
def fake_close(fd):
    if fd == master: order.append("close-master")
    real_close(fd)
def fake_waitpid(pid, flags):
    order.append("waitpid")
    return (pid, 0)
os.close, os.waitpid = fake_close, fake_waitpid
p.kill(reap_timeout=1)
os.close, os.waitpid = real_close, real_waitpid
real_close(slave)
print(",".join(order))
assert order.index("close-master") < order.index("waitpid"), order
`);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});

test("Pty.kill reaps a real child and closes the master exactly once", () => {
  const run = py(`${LOAD}
import subprocess
child = subprocess.Popen(["sleep", "60"])
master, slave = os.openpty()
os.close(slave)
p = object.__new__(Pty)
p.pid = child.pid
p.status = None
p.master = master
p.kill()
try:
    os.waitpid(child.pid, os.WNOHANG)
    reaped = False
except ChildProcessError:
    reaped = True
try:
    os.fstat(master)
    closed = False
except OSError:
    closed = True
print("reaped=%s closed=%s status=%s" % (reaped, closed, p.status))
assert reaped and closed and p.status == -1
p.kill()  # idempotent: a second call must not raise or double-close
`);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
