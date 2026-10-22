import { resolveHomeDir } from "../paths.js";
import { resolveProjectRoot } from "../architect/architect-store.js";
import { loadProjectRoleCatalog } from "../intelligence/role-catalog.js";
import { HOST_IDS, getHost, listHosts } from "./registry.js";
import { planRoleFiles, applyRoleFiles, retireRoleFiles } from "./plan.js";
import { collectRolePicks } from "./picks.js";

export const ROLES_ACTIONS = Object.freeze(["sync", "retire"]);

function selectHosts(selection, context) {
  if (selection === "all") return listHosts();
  if (selection) return [getHost(selection)];
  return listHosts().filter((host) => host.detect(context).installed);
}

function renderText(result) {
  const lines = [result.applied ? "Applied." : `Preview only; pass --yes to ${result.action === "retire" ? "remove" : "write"}.`];
  for (const host of result.hosts) {
    for (const role of host.roles) lines.push(`${host.host}  ${role.action}  ${role.role}${role.path ? `  ${role.path}` : ""}${role.source ? `  (${role.source})` : ""}${role.reason ? `  [${role.reason}]` : ""}`);
  }
  for (const note of [...result.notes, ...result.warnings]) lines.push(`note: ${note}`);
  if (!result.hosts.length) lines.push("No host detected; pass --host <id|all>.");
  return lines.join("\n");
}

/** `kairo team roles sync|retire`: project-scope role files per host. Preview unless options.yes. */
export async function runTeamRolesCli(options, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const log = deps.log ?? console.log;
  try {
    if (!ROLES_ACTIONS.includes(options.rolesAction)) throw new Error(`Use kairo team roles ${ROLES_ACTIONS.join("|")} [--host ${HOST_IDS.join("|")}|all] [--yes].`);
    const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const hosts = selectHosts(options.roleHost, { homeDir, projectRoot, env: process.env });
    const yes = options.yes === true;
    const result = { ok: true, action: options.rolesAction, applied: false, projectRoot, hosts: [], notes: [], warnings: [] };
    if (options.rolesAction === "sync") {
      const catalog = loadProjectRoleCatalog({ projectRoot });
      const { picks, notes } = await collectRolePicks({ catalog, projectRoot, homeDir, readRoute: deps.readRoute });
      result.notes.push(...notes);
      result.warnings.push(...catalog.warnings);
      for (const host of hosts) {
        const outcome = yes
          ? await applyRoleFiles({ host: host.id, projectRoot, catalog, picks, yes, now: deps.now })
          : await planRoleFiles({ host: host.id, projectRoot, catalog, picks });
        result.hosts.push(stripPlan(outcome));
      }
    } else {
      for (const host of hosts) result.hosts.push(await retireRoleFiles({ host: host.id, projectRoot, yes }));
    }
    result.applied = result.hosts.some((host) => host.applied);
    log(options.json ? JSON.stringify(result) : renderText(result));
    return result;
  } catch (error) {
    if (options.json) log(JSON.stringify({ ok: false, error: error.message }));
    else log(error.message);
    process.exitCode = 1;
    return null;
  }
}

const stripPlan = (plan) => ({ ...plan, roles: plan.roles.map(({ content, ...rest }) => rest) });
