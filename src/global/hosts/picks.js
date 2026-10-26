import { readTeamRoute } from "../team/routing-input-cache.js";

/**
 * Read-only picks per catalog role from the T5 route. A STALE route falls back
 * to the approved assignment (source "approved-fallback"). Roles that are not
 * in the approved team follow their `sourceRole` / `extendsRole` base role.
 * @returns {Promise<{picks: Record<string, {adapterId: string, model: string, source: string, viaRole?: string}>, notes: string[]}>}
 */
export async function collectRolePicks({ catalog, projectRoot, homeDir, host, readRoute = readTeamRoute } = {}) {
  const picks = {};
  const notes = [];
  const cache = new Map();
  const route = async (role) => {
    if (!cache.has(role)) {
      cache.set(role, readRoute({ role, cwd: projectRoot, homeDir, ...(host ? { activeHost: host } : {}) }).catch((error) => ({ error })));
    }
    return cache.get(role);
  };
  for (const [id, entry] of Object.entries(catalog.registry)) {
    const candidates = [id, entry.sourceRole, entry.extendsRole].filter((value, index, all) => typeof value === "string" && all.indexOf(value) === index);
    for (const role of candidates) {
      const result = await route(role);
      if (result.error) {
        if (result.error.code === "no_approved_team") { notes.push(result.error.message); return { picks: {}, notes }; }
        continue;
      }
      const model = result.model;
      if (!model?.modelId || (result.decision !== "ROUTED" && result.decision !== "STALE")) continue;
      picks[id] = {
        adapterId: result.provider ?? model.adapterId,
        model: model.modelId,
        source: result.decision === "STALE" ? "approved-fallback" : "route",
        ...(role === id ? {} : { viaRole: role })
      };
      break;
    }
  }
  return { picks, notes };
}
