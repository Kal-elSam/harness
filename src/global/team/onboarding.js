import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readProjectStrategy } from './project-strategy-store.js';

const analysis = 'On yes, run kairo team analysts, let the user pick an analyst, then run kairo team analyze --analyst CHOICE --yes. Show the proposed team with kairo team show and ask for approval before running kairo team approve --yes.';
const decline = 'On no, continue and do not ask again this session.';
const asks = {
  not_git: `Kairo team analysis needs a Git repository. Before any other work, ask the user one question whether to run git init so Kairo can analyze this project. Do not initialize Git without consent. ${decline}`,
  no_team: `This project has no approved Kairo team, so delegation falls back to the session default model. Before any other work, ask the user one question whether to analyze the project now. ${analysis} ${decline}`,
  suggested: `This project has a proposed Kairo team that is not approved. Before any other work, ask the user one question whether to review and approve it. On yes, run kairo team show, show the proposed team and ask for approval before running kairo team approve --yes. ${decline}`,
  stale: `This project's approved Kairo team is stale. Before any other work, ask the user one question whether to re-analyze it now. ${analysis} ${decline}`,
};

/** Read-only onboarding advice; consent and analysis remain in the conversation. */
export async function runTeamOnboardingCli(options, deps = {}) {
  let cwd;
  try {
    cwd = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
  } catch (error) {
    if (!error.message?.startsWith('Architect requires a Git repository:')) throw error;
  }
  const strategy = cwd ? await readProjectStrategy(deps.homeDir ?? resolveHomeDir(), cwd) : null;
  const state = !cwd ? 'not_git' : strategy?.status ?? 'no_team';
  const result = { ok: true, state, ask: asks[state] ?? null };
  (deps.log ?? console.log)(options.json ? JSON.stringify(result) : result.ask ?? 'Kairo team is active.');
  return result;
}
