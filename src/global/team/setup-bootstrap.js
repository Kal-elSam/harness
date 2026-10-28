import { accessSync, constants, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readProjectStrategy } from './project-strategy-store.js';
import { runTeamCli } from './team-cli.js';
import { runTeamProvidersCli } from './providers-cli.js';
import { runTeamRolesInitCli } from './roles-init.js';
import { runTeamRolesCli } from '../hosts/roles-cli.js';
import { listHosts } from '../hosts/registry.js';

const chooseAnalyst = 'Choose an analyst: kairo setup --analyst MODEL --yes';

function claudeCommand(env) {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(dir, 'claude');
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch { /* Continue through PATH. */ }
  }
  return null;
}

async function installRouter({ homeDir, cwd, env }) {
  const cli = claudeCommand(env);
  if (!cli) return 'skipped (claude CLI not on PATH)';
  try {
    const installed = JSON.parse(await readFile(join(env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homeDir, '.claude'), 'plugins/installed_plugins.json'), 'utf8'));
    if (installed.plugins?.['kairo-router@kairo']?.some(entry =>
      entry.scope === 'user' || (['project', 'local'].includes(entry.scope) && entry.projectPath === cwd))) return 'already installed';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const args of [['plugin', 'marketplace', 'add', 'Kal-elSam/harness'], ['plugin', 'install', 'kairo-router@kairo']]) {
    execFileSync(cli, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  }
  return 'installed';
}

/** Compose existing public operations; only an explicit analyst authorizes team analysis. */
export async function runSetupBootstrap(options, { setupHarness, setupClaudeKit, shouldRunClaudeSetup }) {
  const homeDir = resolveHomeDir();
  const env = process.env;
  let projectRoot = null;
  try { projectRoot = await resolveProjectRoot(options.cwd); } catch { /* Global setup is valid outside Git. */ }
  const cwd = projectRoot ?? options.cwd;
  const approved = projectRoot && (await readProjectStrategy(homeDir, projectRoot))?.status === 'active';
  const hosts = listHosts().filter(host => host.detect({ homeDir, projectRoot, env }).installed);
  const preview = options.yes !== true || options.dryRun === true;
  // Evaluate Claude eligibility before harness setup, which may create the Claude home directory.
  const claudeEligible = shouldRunClaudeSetup(options);
  const json = options.json === true;
  const say = line => { if (!json) console.log(line); };
  const report = { mode: preview ? 'preview' : 'run', steps: [] };
  // Bootstrap is host-neutral; wrappers are synced explicitly for every detected host.
  const quiet = { homeDir, env: { ...env, KAIRO_HOST: 'gentle-shell' }, log: () => {} };
  let step = 'discovery';
  try {
    // Team discovery is deliberately routed through the same read-only CLI operation.
    let analysts = [];
    if (projectRoot && preview) {
      const result = await runTeamCli({ ...options, cwd, teamAction: 'analysts', json: true }, quiet);
      if (!result?.ok) throw new Error(result?.error ?? 'Analyst discovery failed');
      analysts = result.analysts;
    }
    const choices = analysts.map(a => `${a.modelId} (${a.provider})`).join(', ') || 'none available';
    if (preview) {
      const inventory = await runTeamProvidersCli({ cwd, json: true }, quiet);
      // Preserve the existing explicit --dry-run plan as additional preview detail.
      if (options.dryRun) await setupHarness({ ...options, interactive: false });
      const providers = inventory.providers.filter(p => p.installed).map(p => p.providerId);
      const stepList = ['harness setup + Claude kit'];
      if (projectRoot) stepList.push(
        approved && !options.analyst ? 'analyze (skipped: team already approved)' : 'analyze',
        approved && !options.analyst ? 'approve (skipped: team already approved)' : 'approve',
        'roles init', 'roles sync');
      else stepList.push('team steps 2-5 (skipped: project is not a Git repository)');
      stepList.push('kairo-router');
      const next = approved || !projectRoot ? 'kairo setup --yes' : chooseAnalyst.slice('Choose an analyst: '.length);
      Object.assign(report, { providers, hosts: hosts.map(h => h.id), analysts: analysts.map(a => ({ modelId: a.modelId, provider: a.provider })),
        approved: Boolean(approved), steps: stepList, next });
      say('Team bootstrap — read-only preview');
      say(`Detected providers: ${providers.join(', ') || 'none'}`);
      say(`Detected hosts: ${hosts.map(h => h.id).join(', ') || 'none'}`);
      say(`Available analysts: ${choices}`);
      say(`Approved team: ${approved ? 'yes' : 'no'}`);
      say('1. harness setup + Claude kit (non-interactive)');
      if (projectRoot) {
        say(`2. analyze${approved && !options.analyst ? ' — skipped (team already approved)' : ' with selected analyst'}`);
        say(`3. approve${approved && !options.analyst ? ' — skipped (team already approved)' : ''}`);
        say('4. roles init');
        say(`5. roles sync: ${hosts.map(h => h.id).join(', ') || 'no detected hosts'}`);
      } else say('2–5. Team steps skipped: project is not a Git repository');
      say('6. kairo-router: install when Claude is selected, its home directory exists and claude CLI is on PATH, unless already installed');
      say(`Next: ${next}`);
      if (json) console.log(JSON.stringify(report));
      return;
    }
    const runStep = async (name, action) => {
      step = name;
      const result = await action();
      if (process.exitCode || result === null || result?.ok === false || result?.cancelled) {
        throw new Error(result?.error ?? 'operation did not complete');
      }
      report.steps.push({ name, status: 'done' });
      say(`${name}: done`);
      return result;
    };
    await runStep('harness setup', async () => {
      const outcome = await setupHarness({ ...options, interactive: false });
      if (outcome?.cancelled) return outcome;
      await setupClaudeKit(options);
      return outcome;
    });
    const skip = (name, reason) => { report.steps.push({ name, status: 'skipped', reason }); };
    if (!projectRoot) {
      skip('team steps 2-5', 'project is not a Git repository');
      say('Team steps 2–5 skipped: project is not a Git repository');
    } else if (!approved && !options.analyst) {
      skip('team steps 2-5', 'run kairo setup --analyst MODEL --yes');
      say('Team steps 2–5 skipped: run kairo setup --analyst MODEL --yes');
    } else {
      if (approved && !options.analyst) {
        skip('analyze', 'team already approved');
        skip('approve', 'team already approved');
        say('analyze: skipped (team already approved)');
        say('approve: skipped (team already approved)');
      } else {
        for (const action of ['analyze', 'approve']) await runStep(action,
          () => runTeamCli({ ...options, cwd, teamAction: action, yes: true, json: true }, quiet));
      }
      await runStep('roles init', () => runTeamRolesInitCli({ ...options, cwd, yes: true }, quiet));
      await runStep('roles sync', async () => {
        for (const host of hosts) {
          const result = await runTeamRolesCli({ ...options, cwd, rolesAction: 'sync', roleHost: host.id, yes: true }, quiet);
          if (!result?.ok || process.exitCode) return null;
        }
        return { ok: true };
      });
    }
    step = 'kairo-router';
    const routerResult = claudeEligible
      ? await installRouter({ homeDir, cwd, env })
      : 'skipped (claude not selected or .claude directory absent)';
    report.steps.push({ name: 'kairo-router', status: routerResult.startsWith('skipped') ? 'skipped' : 'done', reason: routerResult });
    say(`kairo-router: ${routerResult}`);
    if (json) console.log(JSON.stringify(report));
  } catch (error) {
    process.exitCode = 1;
    if (json) {
      report.steps.push({ name: step, status: 'failed', reason: error.message });
      console.log(JSON.stringify(report));
    } else console.error(`${step}: failed — ${error.message}`);
  }
}
