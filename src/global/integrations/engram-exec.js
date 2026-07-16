import { spawn } from "node:child_process";

export const ENGRAM_SETUP_TIMEOUT_MS = 180_000;
const LOG_LIMIT = 480;

/** Absolute `engram setup <slug>` without shell. SIGTERM→SIGKILL on timeout. */
export function runEngramSetup({
  binaryPath,
  slug,
  env = process.env,
  spawnImpl = spawn,
  timeoutMs = ENGRAM_SETUP_TIMEOUT_MS,
  terminationGraceMs = 1000,
  killGraceMs = 1000
} = {}) {
  assertSafeSetupInvocation(binaryPath, slug);
  const args = ["setup", slug];

  return new Promise((resolve, reject) => {
    const child = spawnImpl(binaryPath, args, { env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timers = [];
    const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; };
    const schedule = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      detachIo();
      resolve(result);
    };
    const finish = ({ status = null, signal = null, terminationFailed = false } = {}) => {
      settle({
        ok: status === 0 && !timedOut && !terminationFailed,
        command: [binaryPath, ...args],
        slug, status, signal, timedOut, terminationFailed,
        stdout: redactEngramLog(stdout),
        stderr: redactEngramLog(stderr)
      });
    };
    const onStdout = (c) => { stdout = appendLimited(stdout, c, LOG_LIMIT * 4); };
    const onStderr = (c) => { stderr = appendLimited(stderr, c, LOG_LIMIT); };
    const onError = (error) => {
      if (settled) return;
      settled = true; clearTimers(); detachIo(); reject(error);
    };
    const onClose = (status, signal) => finish({ status: status ?? null, signal: signal ?? null });
    const detachIo = () => {
      child.stdout?.off?.("data", onStdout);
      child.stderr?.off?.("data", onStderr);
      child.off?.("close", onClose);
    };
    schedule(() => {
      if (settled) return;
      timedOut = true;
      safeKill(child, "SIGTERM");
      schedule(() => {
        if (settled) return;
        safeKill(child, "SIGKILL");
        schedule(() => {
          if (settled) return;
          try { child.unref?.(); } catch { /* ignore */ }
          finish({ terminationFailed: true });
        }, killGraceMs);
      }, terminationGraceMs);
    }, timeoutMs);
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
  });
}

export function assertSafeSetupInvocation(binaryPath, slug) {
  if (typeof binaryPath !== "string" || !binaryPath.startsWith("/") || binaryPath.includes("\0")) {
    throw new Error("Engram setup requires an absolute binary path.");
  }
  if (typeof slug !== "string" || !/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid Engram setup slug "${slug}".`);
  }
  if (/engram\.db/i.test(binaryPath) || /engram\.db/i.test(slug)) {
    throw new Error("Engram setup refuses paths that reference the memory database.");
  }
}

export function redactEngramLog(text, { limit = LOG_LIMIT } = {}) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(/\b(sk-[A-Za-z0-9_-]+)\b/g, "[REDACTED]");
  out = out.replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  if (out.length > limit) out = `${out.slice(0, Math.max(0, limit - 1))}…`;
  return out;
}

function appendLimited(current, chunk, limit) {
  if (current.length >= limit) return current;
  const next = current + String(chunk);
  return next.length > limit ? next.slice(0, limit) : next;
}

function safeKill(child, signal) {
  try { return typeof child.kill === "function" ? child.kill(signal) !== false : false; }
  catch { return false; }
}
