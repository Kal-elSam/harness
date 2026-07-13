import ansiEscapes from "ansi-escapes";
import { stdout as defaultStdout } from "node:process";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * Idempotent alternate-screen session for Ink TTY flows.
 * Enter once for onboarding → setup → dashboard; leave exactly once on any exit.
 *
 * @param {{
 *   stdout?: { isTTY?: boolean, write?: Function },
 *   ansi?: { enterAlternativeScreen: string, exitAlternativeScreen: string, cursorHide: string, cursorShow: string },
 *   processRef?: NodeJS.Process,
 *   enabled?: boolean,
 *   onSignal?: (signal: string) => void
 * }} [options]
 */
export function createFullscreenSession({
  stdout = defaultStdout,
  ansi = ansiEscapes,
  processRef = process,
  enabled = Boolean(stdout?.isTTY),
  onSignal = null
} = {}) {
  let active = false;
  let left = false;
  const signalHandlers = new Map();

  function write(sequence) {
    if (!stdout || typeof stdout.write !== "function") return;
    try {
      stdout.write(sequence);
    } catch {
      // Best-effort restore; never throw from leave path.
    }
  }

  function detachSignals() {
    for (const [signal, handler] of signalHandlers) {
      try {
        processRef.removeListener(signal, handler);
      } catch {
        // ignore
      }
    }
    signalHandlers.clear();
  }

  function leave() {
    if (!active || left) return false;
    left = true;
    active = false;
    detachSignals();
    write(ansi.cursorShow);
    write(ansi.exitAlternativeScreen);
    return true;
  }

  function defaultSignalExit(signal) {
    const code = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
    try {
      processRef.exit(code);
    } catch {
      // ignore in constrained environments
    }
  }

  function attachSignals() {
    for (const signal of SIGNALS) {
      const handler = () => {
        leave();
        if (typeof onSignal === "function") {
          onSignal(signal);
          return;
        }
        defaultSignalExit(signal);
      };
      signalHandlers.set(signal, handler);
      processRef.on(signal, handler);
    }
  }

  function enter() {
    if (!enabled) return false;
    if (active) return false;
    left = false;
    active = true;
    write(ansi.enterAlternativeScreen);
    write(ansi.cursorHide);
    attachSignals();
    return true;
  }

  function isActive() {
    return active && !left;
  }

  return {
    enter,
    leave,
    isActive,
    get enabled() {
      return enabled;
    }
  };
}

/**
 * Run an async body inside a fullscreen session (enter → finally leave).
 * If `sessionOrOptions` is an existing session that is already active, does not leave it.
 */
export async function withFullscreenSession(sessionOrOptions, body) {
  const isExisting = typeof sessionOrOptions?.enter === "function";
  const session = isExisting
    ? sessionOrOptions
    : createFullscreenSession(sessionOrOptions);

  const wasActive = session.isActive();
  const didEnter = wasActive ? false : session.enter();

  try {
    return await body(session);
  } finally {
    if (didEnter) {
      session.leave();
    }
  }
}
