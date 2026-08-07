import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fetchPublishedVersion } from "../npm-registry.js";
import { harnessHomePaths } from "../paths.js";
import { probeCommand as defaultProbeCommand } from "../cli-probe.js";

export const ECOSYSTEM_UPDATES_CACHE_MS = 24 * 60 * 60 * 1000;
export const ECOSYSTEM_UPDATES_TIMEOUT_MS = 8000;
export const AGENT_SKILLS_PINNED_REV = "d2478bf0c73a6357df39a3ed6aff16acaa218843";
export const AGENT_SKILLS_UPSTREAM =
  "https://api.github.com/repos/addyosmani/agent-skills/commits/HEAD";

const TOOL_IDS = Object.freeze(["kairo", "hermes", "gentle", "skills"]);

function emptyTool(id, state = "unavailable") {
  return {
    id, state, installed: null, latest: null, updateAvailable: false,
    provenance: null, error: state === "error" || state === "unavailable" ? state : null
  };
}

function envelope(partial = {}) {
  return {
    state: "error", checkedAt: null, cacheHit: false, diagnostics: [],
    tools: Object.fromEntries(TOOL_IDS.map((id) => [id, emptyTool(id)])),
    ...partial
  };
}

function whichAbsolute(command, env, probeCommand) {
  const which = probeCommand("which", [command], { env, timeoutMs: 3000 });
  if (!which?.ok) return "";
  const path = String(which.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return isAbsolute(path) ? path : "";
}

function compareSemver(a, b) {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((p) => Number.parseInt(p, 10) || 0);
  const aa = parse(a), bb = parse(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function parseGentleUpdateOutput(stdout) {
  const tools = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const m = line.match(/\[(ok|UP)\]\s+(\S+)\s+installed:\s+(\S+)\s+latest:\s+(\S+)/i);
    if (m) tools.push({ name: m[2], installed: m[3], latest: m[4], updateAvailable: m[1].toUpperCase() === "UP" });
  }
  return tools;
}

export function parseHermesUpdateCheck(stdout, stderr, ok) {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`;
  if (/update available|behind|new version|commits? behind/i.test(text)) {
    return { state: "available", updateAvailable: true };
  }
  if (/up to date|already up.to.date|no update/i.test(text)) {
    return { state: "available", updateAvailable: false };
  }
  if (!ok || /failed|fatal|error|unable/i.test(text)) {
    return { state: "error", updateAvailable: false, error: "check_failed" };
  }
  return { state: "partial", updateAvailable: false };
}

async function checkKairo({ packageName, installedVersion, fetchVersion }) {
  try {
    const latest = await fetchVersion(packageName);
    if (typeof latest !== "string" || !latest) {
      return { ...emptyTool("kairo", "error"), installed: installedVersion, error: "malformed", provenance: "npm" };
    }
    return {
      id: "kairo", state: "available", installed: installedVersion, latest,
      updateAvailable: compareSemver(latest, installedVersion) > 0,
      provenance: "npm-registry", error: null
    };
  } catch (err) {
    const offline = /ENOTFOUND|ECONN|network|fetch|HTTP|timed?\s*out/i.test(String(err?.message ?? err));
    return {
      ...emptyTool("kairo", offline ? "unavailable" : "error"),
      installed: installedVersion, provenance: "npm-registry",
      error: offline ? "offline" : "check_failed"
    };
  }
}

function checkHermes({ env, probeCommand, timeoutMs }) {
  const bin = whichAbsolute("hermes", env, probeCommand);
  if (!bin) return emptyTool("hermes", "unavailable");
  const res = probeCommand(bin, ["update", "--check"], { env, timeoutMs });
  if (res?.timedOut) return { ...emptyTool("hermes", "error"), error: "timeout", provenance: bin };
  const parsed = parseHermesUpdateCheck(res?.stdout, res?.stderr, Boolean(res?.ok));
  return {
    id: "hermes", state: parsed.state, installed: null, latest: null,
    updateAvailable: parsed.updateAvailable === true, provenance: bin, error: parsed.error ?? null
  };
}

function checkGentle({ env, probeCommand, timeoutMs }) {
  const bin = whichAbsolute("gentle-ai", env, probeCommand);
  if (!bin) return emptyTool("gentle", "unavailable");
  const res = probeCommand(bin, ["update"], { env, timeoutMs });
  if (res?.timedOut) return { ...emptyTool("gentle", "error"), error: "timeout", provenance: bin };
  if (!res?.ok && !res?.stdout) return { ...emptyTool("gentle", "error"), error: "check_failed", provenance: bin };
  const rows = parseGentleUpdateOutput(res.stdout);
  if (rows.length === 0) return { ...emptyTool("gentle", "partial"), provenance: bin, error: "malformed" };
  const root = rows.find((r) => r.name === "gentle-ai") ?? rows[0];
  return {
    id: "gentle", state: "available", installed: root.installed, latest: root.latest,
    updateAvailable: rows.some((r) => r.updateAvailable), provenance: bin, error: null
  };
}

async function checkSkills({ pinnedRev, fetchJson }) {
  try {
    const meta = await fetchJson(AGENT_SKILLS_UPSTREAM);
    const sha = typeof meta?.sha === "string" ? meta.sha : null;
    if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      return { ...emptyTool("skills", "error"), installed: pinnedRev, error: "malformed", provenance: "github" };
    }
    const exactDiff = sha.toLowerCase() !== pinnedRev.toLowerCase()
      && !(pinnedRev.length >= 7 && sha.toLowerCase().startsWith(pinnedRev.toLowerCase()));
    return {
      id: "skills", state: "available", installed: pinnedRev, latest: sha,
      updateAvailable: exactDiff, provenance: "github-commits-api", error: null
    };
  } catch (err) {
    const offline = /ENOTFOUND|ECONN|network|fetch|HTTP|403|429|timed?\s*out/i.test(String(err?.message ?? err));
    return {
      ...emptyTool("skills", offline ? "unavailable" : "error"),
      installed: pinnedRev, provenance: "github-commits-api",
      error: offline ? "offline" : "check_failed"
    };
  }
}

function aggregateState(tools) {
  const states = TOOL_IDS.map((id) => tools[id]?.state);
  if (states.every((s) => s === "unavailable")) return "unavailable";
  if (states.some((s) => s === "error" || s === "partial" || s === "unavailable")) return "partial";
  return "available";
}

/** Read-only ecosystem update detection. Never invokes mutating updaters. */
export async function loadEcosystemUpdates({
  packageName = "@kal-elsam/kairo-runtime",
  installedVersion = "0.0.0",
  homeDir,
  env = process.env,
  nowMs = Date.now(),
  cacheTtlMs = ECOSYSTEM_UPDATES_CACHE_MS,
  timeoutMs = ECOSYSTEM_UPDATES_TIMEOUT_MS,
  forceRefresh = false,
  pinnedSkillsRev = AGENT_SKILLS_PINNED_REV,
  probeCommand = defaultProbeCommand,
  fetchVersion = fetchPublishedVersion,
  fetchJson = defaultFetchJson,
  readCacheFile = async (p) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } },
  writeCacheFile = async (p, payload) => {
    try {
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, `${JSON.stringify(payload)}\n`, "utf8");
    } catch { /* best-effort */ }
  }
} = {}) {
  const cachePath = homeDir
    ? join(harnessHomePaths(homeDir).root, "cache", "ecosystem-updates.json")
    : null;

  if (!forceRefresh && cachePath) {
    const cached = await readCacheFile(cachePath);
    const checkedAt = cached?.checkedAt ? Date.parse(cached.checkedAt) : NaN;
    if (Number.isFinite(checkedAt) && (nowMs - checkedAt) < cacheTtlMs && cached?.tools) {
      return envelope({
        state: cached.state ?? aggregateState(cached.tools),
        checkedAt: cached.checkedAt, cacheHit: true,
        diagnostics: Array.isArray(cached.diagnostics) ? cached.diagnostics : [],
        tools: cached.tools
      });
    }
  }

  const perToolTimeout = Math.max(1000, Math.floor(timeoutMs / 2));
  try {
    const settled = await Promise.race([
      Promise.all([
        checkKairo({ packageName, installedVersion, fetchVersion }),
        Promise.resolve().then(() => checkHermes({ env, probeCommand, timeoutMs: perToolTimeout })),
        Promise.resolve().then(() => checkGentle({ env, probeCommand, timeoutMs: perToolTimeout })),
        checkSkills({ pinnedRev: pinnedSkillsRev, fetchJson })
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))
    ]);
    const tools = { kairo: settled[0], hermes: settled[1], gentle: settled[2], skills: settled[3] };
    const payload = envelope({
      state: aggregateState(tools),
      checkedAt: new Date(nowMs).toISOString(),
      cacheHit: false, diagnostics: [], tools
    });
    if (cachePath) await writeCacheFile(cachePath, payload);
    return payload;
  } catch (err) {
    const isTimeout = /timeout/i.test(String(err?.message ?? err));
    return envelope({
      state: isTimeout ? "error" : "unavailable",
      checkedAt: new Date(nowMs).toISOString(),
      cacheHit: false,
      diagnostics: [isTimeout ? "ecosystem updates timeout" : "ecosystem updates error"],
      tools: Object.fromEntries(TOOL_IDS.map((id) => [id, emptyTool(id, isTimeout ? "error" : "unavailable")]))
    });
  }
}

async function defaultFetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "kairo-ecosystem-updates" }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.json();
}
