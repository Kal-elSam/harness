// `kairo start` / `kairo resume [sessionId]` / `kairo list` — the explicit
// CLI surface for multi-session support (Increment 4). Everything these
// commands need (real session creation/listing/resolution, hostile-input
// hardening) already exists in session-registry.js as of Increments 1-3;
// this file is the thin CLI wiring on top of it, plus one real interactive
// picker for `resume` with no id and more than one real session.

import { resolveHomeDir } from "../paths.js";
import { resolveProjectRoot } from "../architect/architect-store.js";
import { createSession, listSessions, resolveSessionRef } from "./session-registry.js";
import { runCockpitCli } from "../cockpit/cli.js";
import { commandHeader } from "../brand/index.js";
import { formatCliCommand } from "../brand/cli.js";
import { printJson } from "../json-output.js";
import { createReadlinePrompt, isInteractiveTerminal } from "../apply-confirmation.js";

function formatSessionLabel(session) {
  const title = session.title ?? `(untitled, started ${session.createdAt})`;
  return `${session.id}  ${title}  [${session.mode}]  updated ${session.updatedAt}`;
}

/** `kairo list`: every real session for this project, most recently updated first. Never interactive. */
export async function runKairoSessionsList(options, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const resolveRoot = deps.resolveProjectRoot ?? resolveProjectRoot;
  const listSessionsImpl = deps.listSessions ?? listSessions;
  const projectRoot = await resolveRoot(options.cwd);
  const sessions = await listSessionsImpl(homeDir, projectRoot);

  if (options.json) {
    printJson({ sessions });
    return sessions;
  }

  console.log(commandHeader("list — real sessions for this project"));
  if (sessions.length === 0) {
    console.log(`No sessions yet. Run ${formatCliCommand("start")} to create one.`);
    return sessions;
  }
  sessions.forEach((session, index) => console.log(`${index + 1}. ${formatSessionLabel(session)}`));
  return sessions;
}

/** `kairo start`: always a brand new real session — never resumes an existing one. */
export async function runKairoStart(options, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const resolveRoot = deps.resolveProjectRoot ?? resolveProjectRoot;
  const createSessionImpl = deps.createSession ?? createSession;
  const runCockpit = deps.runCockpitCli ?? runCockpitCli;
  const projectRoot = await resolveRoot(options.cwd);
  const session = await createSessionImpl(homeDir, projectRoot, {});
  return runCockpit({ ...options, sessionId: session.id }, { runCockpitApp: deps.runCockpitApp, interactive: deps.interactive });
}

/**
 * `kairo resume [sessionId]`: with a real id or unique prefix, resumes
 * exactly that session (throws — never guesses — on an unknown or
 * ambiguous reference, matching resolveSessionRef's own contract). With no
 * reference: the single existing session resumes with no prompt; more
 * than one shows a real numbered picker (never auto-picks "the most
 * recent" silently — that would defeat the point of an explicit choice).
 * A non-interactive terminal with more than one candidate and no explicit
 * reference is a real error, not a guess.
 */
export async function runKairoResume(options, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const resolveRoot = deps.resolveProjectRoot ?? resolveProjectRoot;
  const resolveRefImpl = deps.resolveSessionRef ?? resolveSessionRef;
  const listSessionsImpl = deps.listSessions ?? listSessions;
  const runCockpit = deps.runCockpitCli ?? runCockpitCli;
  const projectRoot = await resolveRoot(options.cwd);

  if (options.sessionRef) {
    const session = await resolveRefImpl(homeDir, projectRoot, options.sessionRef);
    if (!session) {
      throw new Error(`No session matches "${options.sessionRef}". Run ${formatCliCommand("list")} to see real sessions.`);
    }
    return runCockpit({ ...options, sessionId: session.id }, { runCockpitApp: deps.runCockpitApp, interactive: deps.interactive });
  }

  const sessions = await listSessionsImpl(homeDir, projectRoot);
  if (sessions.length === 0) {
    throw new Error(`No sessions yet. Run ${formatCliCommand("start")} to create one.`);
  }
  if (sessions.length === 1) {
    return runCockpit({ ...options, sessionId: sessions[0].id }, { runCockpitApp: deps.runCockpitApp, interactive: deps.interactive });
  }

  const interactive = deps.interactive ?? isInteractiveTerminal();
  if (!interactive) {
    throw new Error(
      `${sessions.length} sessions exist — a non-interactive terminal needs an explicit id. `
      + `Use ${formatCliCommand("resume <sessionId>")} (run ${formatCliCommand("list")} to see them).`
    );
  }

  console.log(commandHeader("resume — pick a real session"));
  sessions.forEach((session, index) => console.log(`${index + 1}. ${formatSessionLabel(session)}`));
  const createPrompt = deps.createPrompt ?? createReadlinePrompt;
  const prompt = createPrompt();
  try {
    const answer = (await prompt(`Resume which session? [1-${sessions.length}]: `)).trim();
    const index = Number.parseInt(answer, 10);
    if (!Number.isInteger(index) || index < 1 || index > sessions.length) {
      throw new Error(`"${answer}" is not a valid choice — enter a number from 1 to ${sessions.length}.`);
    }
    return runCockpit({ ...options, sessionId: sessions[index - 1].id }, { runCockpitApp: deps.runCockpitApp, interactive: deps.interactive });
  } finally {
    await prompt.close?.();
  }
}
