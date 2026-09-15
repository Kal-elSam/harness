import { spawn as defaultSpawn } from "node:child_process";
import { tmpdir } from "node:os";

// `cursor-agent status`/`whoami` do NOT reliably reflect whether a real
// invocation will actually work — verified empirically: on this machine
// `status` reports "Logged in" (exit 0) while a real `cursor-agent -p`
// call fails outright with "Authentication required. Please run 'agent
// login' first, or set CURSOR_API_KEY environment variable." `models`
// behaves the same way (a clean "No models available for this account."
// even while the session is actually unusable for real invocation).
//
// So the only decisive signal for "can Cursor actually be invoked right
// now" is a real invocation attempt. This probe uses the cheapest one
// available: a harmless -p call whose failure mode, when unauthenticated,
// is a local, near-instant CLI rejection (no network round trip) — it
// has NOT been confirmed whether a genuinely authenticated probe call
// itself consumes real usage, so this should only be called where a real
// eligibility decision is actually needed, not on a hot path.
//
// --trust is required here too (verified empirically — the probe's cwd,
// an OS tmpdir cursor-agent has never seen, otherwise triggers an
// interactive "Workspace Trust Required" prompt that blocks non-
// interactive use, exactly like a real Bootstrap Analysis snapshot dir
// would without it).
// A real -p call to a real model has been observed taking just over
// 20s — verified empirically, not assumed — so this needs real margin,
// not a tight bound.
const DEFAULT_TIMEOUT_MS = 45_000;
const SOURCE = "cursor-agent -p (probe)";
const AUTH_REQUIRED_PATTERN = /authentication required/i;

function unknown(error = null) {
  return { authenticated: false, status: "unknown", source: SOURCE, reason: error ? String(error) : null };
}

/**
 * Real, decisive probe for whether Cursor can actually be invoked right
 * now — NOT whether `status`/`whoami` merely claim it can.
 * @returns {Promise<{authenticated: boolean, status: "measured"|"unknown", source: string, reason: string|null}>}
 */
export async function probeCursorAuth({
  spawn = defaultSpawn,
  cwd = tmpdir(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const args = [
    "-p", "Reply with the single word: ok", "--output-format", "json",
    "--mode", "ask", "--sandbox", "enabled", "--workspace", cwd, "--trust"
  ];
  let child;
  try {
    child = spawn("cursor-agent", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return unknown(error?.message ?? error);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => finish(unknown("cursor-agent -p probe timed out")), timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", (code, signal) => {
      const combined = `${stdout}\n${stderr}`;
      if (AUTH_REQUIRED_PATTERN.test(combined)) {
        return finish({
          authenticated: false, status: "measured", source: SOURCE,
          reason: "cursor-agent reports \"Authentication required\" — the CLI's session/keychain is not actually usable for a real invocation, regardless of what `status`/`models` claim."
        });
      }
      if (signal) return finish(unknown(`cursor-agent -p probe was killed by signal ${signal}${stderr ? `: ${stderr.trim()}` : ""}`));
      if (code !== 0) return finish(unknown(`cursor-agent -p probe exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      finish({ authenticated: true, status: "measured", source: SOURCE, reason: null });
    });
  });
}
