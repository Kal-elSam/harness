import { stdin as input, stdout as output } from "node:process";
import { runCockpitApp as defaultRunCockpitApp } from "./app.js";

/**
 * `kairo start`/`resume` entrypoint: boots the interactive cockpit and
 * waits for it to exit (Ctrl+C, `q`, or SIGTERM).
 *
 * @param {object} options - parsed CLI options (uses options.cwd)
 * @param {string|null} [options.sessionId] - a real, already-resolved
 *   session id to bind this run to (from `runKairoStart`/`runKairoResume`
 *   below). Omitted, `runCockpitApp` falls back to its own
 *   resolveActiveSession policy — kept only for any embedder that
 *   predates explicit session selection.
 * @param {object} [deps]
 * @param {typeof defaultRunCockpitApp} [deps.runCockpitApp]
 * @param {boolean} [deps.interactive] - overrides the TTY auto-detection (for tests)
 */
export async function runCockpitCli(options, deps = {}) {
  const interactive = deps.interactive ?? Boolean(input.isTTY && output.isTTY);
  if (!interactive) {
    throw new Error(
      "kairo start requires an interactive terminal (TTY). Run it directly in your shell."
    );
  }

  const factory = deps.runCockpitApp ?? defaultRunCockpitApp;
  const app = await factory({ cwd: options.cwd, sessionId: options.sessionId ?? null });

  const onSignal = () => app.stop();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await app.done;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
