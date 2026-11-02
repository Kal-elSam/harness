import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROLE_REGISTRY } from "../intelligence/role-registry.js";
import { readInstalledSkills, resolveSkillForSpecialty } from "../intelligence/skill-catalog.js";
import { scrubGitOverrideEnv } from "../observability/graphify-probe.js";

// S13: a generic, per-project proposal of cells, seats and seat specialties.
// It is plain data derived from real signals (work areas, change history by
// area and type, risk surfaces) and the analyst's evidenced role needs. It
// never edits the role registry and never activates anything: the strategy
// that carries it stays "suggested" until the existing human approval.

export const PROJECT_PROPOSAL_SCHEMA = "kairo.project-proposal/v1";

const CONTAINER_DIRS = new Set(["src", "lib", "app", "apps", "packages", "services", "internal", "cmd"]);
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "target", ".codegraph", ".venv"]);
const COMMIT_TYPES = new Set(["feat", "fix", "docs", "test", "chore", "refactor", "ci", "perf", "build", "style"]);
const MIN_RECURRING_CHANGES = 3;
const MIN_AREA_FILES_WITHOUT_HISTORY = 5;
const EVIDENCE_PATHS = 3;

// Work-area vocabulary: the area's last path segment names its domain. Extra
// cells exist only for domains the four default cells do not already own.
const DOMAINS = [
  { name: "frontend", pattern: /^(ui|web|frontend|client|components|pages|views|app|public)$/ },
  { name: "backend", pattern: /^(server|api|backend|services|routes|handlers)$/ },
  { name: "data", cell: "Data", pattern: /^(db|database|migrations?|schema|prisma|sql|data)$/ },
  { name: "infrastructure", cell: "Infrastructure", pattern: /^(infra|terraform|k8s|helm|deploy|ops)$/ },
  { name: "mobile", cell: "Mobile", pattern: /^(ios|android|mobile)$/ },
  { name: "machine-learning", cell: "ML", pattern: /^(ml|models|training|notebooks)$/ }
];

const RISK_SURFACES = [
  { kind: "security", pattern: /(^|\/)(auth|security|permissions?|crypto|secrets?|oauth|session)(\/|\.|$)/i },
  { kind: "money", pattern: /(^|\/)(payments?|billing|invoices?|checkout)(\/|\.|$)/i },
  { kind: "data-migration", pattern: /(^|\/)migrations?(\/|$)/i },
  { kind: "delivery", pattern: /(^|\/)(\.github\/workflows|Dockerfile|docker-compose[\w.-]*|\.gitlab-ci\.yml|Jenkinsfile|fly\.toml|vercel\.json)(\/|$)/ }
];

function runGit(root, args, spawn) {
  try {
    const result = spawn("git", args, { cwd: root, encoding: "utf8", timeout: 5000, env: scrubGitOverrideEnv(process.env), maxBuffer: 20 * 1024 * 1024 });
    return result.status === 0 ? String(result.stdout ?? "") : null;
  } catch { return null; }
}

/** Bounded walk used only when the project is not a git checkout. */
function walkFiles(root, dir = "", depth = 0, out = []) {
  if (depth > 4 || out.length > 5000) return out;
  let entries = [];
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!IGNORED_DIRS.has(entry.name)) walkFiles(root, path, depth + 1, out); }
    else if (statSync(join(root, path), { throwIfNoEntry: false })?.isFile()) out.push(path);
  }
  return out;
}

/** The work area a path belongs to: its top directory, one level deeper under a container directory. */
export function workAreaOf(path) {
  const parts = path.split("/");
  if (parts.length === 1) return null;
  return CONTAINER_DIRS.has(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

const domainOf = area => {
  const last = area.split("/").at(-1).toLowerCase();
  return DOMAINS.find(domain => domain.pattern.test(last)) ?? null;
};

/** Deterministic project signals: work areas, change history by area and type, risk surfaces. Fail-soft, never throws. */
export function collectProjectSignals(root, { spawn = spawnSync } = {}) {
  const listed = runGit(root, ["ls-files"], spawn);
  const files = (listed === null ? walkFiles(root) : listed.split("\n")).map(line => line.trim()).filter(Boolean);
  const areas = new Map();
  const area = name => {
    if (!areas.has(name)) areas.set(name, { area: name, files: 0, changes: 0, types: {}, paths: [] });
    return areas.get(name);
  };
  for (const path of files) {
    const name = workAreaOf(path);
    if (!name) continue;
    const entry = area(name);
    entry.files += 1;
    if (entry.paths.length < EVIDENCE_PATHS) entry.paths.push(path);
  }
  const log = runGit(root, ["log", "--since=180.days", "--name-only", "--pretty=format:@@%s"], spawn);
  let commits = 0;
  if (log) {
    let type = "other";
    for (const raw of log.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("@@")) {
        commits += 1;
        const found = /^(\w+)(\([^)]*\))?!?:/.exec(line.slice(2))?.[1]?.toLowerCase();
        type = COMMIT_TYPES.has(found) ? found : "other";
      } else if (line) {
        const name = workAreaOf(line);
        if (!name) continue;
        const entry = area(name);
        entry.changes += 1;
        entry.types[type] = (entry.types[type] ?? 0) + 1;
      }
    }
  }
  const riskSurfaces = RISK_SURFACES.map(({ kind, pattern }) => {
    const paths = files.filter(path => pattern.test(path));
    return paths.length ? { kind, count: paths.length, paths: paths.slice(0, EVIDENCE_PATHS) } : null;
  }).filter(Boolean);
  return {
    workAreas: [...areas.values()].sort((a, b) => b.changes - a.changes || b.files - a.files || a.area.localeCompare(b.area)),
    riskSurfaces,
    fileCount: files.length,
    commitCount: commits,
    hasTests: files.some(path => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$/.test(path)),
    hasDocs: files.some(path => /^docs\/|\.md$/i.test(path) && !/^(node_modules)\//.test(path))
  };
}

const typesText = types => Object.entries(types).sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type} ${count}`).join(", ");
const areaEvidence = entry => `${entry.area}: ${entry.files} files, ${entry.changes} changes${entry.changes ? ` (${typesText(entry.types)})` : ""}`;
const recurring = (entry, signals) => entry.changes >= MIN_RECURRING_CHANGES
  || (signals.commitCount === 0 && entry.files >= MIN_AREA_FILES_WITHOUT_HISTORY);

// A default seat stays when real work maps to it; the first three always stay.
// `keep` returns evidence lines, or a drop reason string.
const SEAT_RULES = {
  "Technical Lead": () => ["baseline seat: every project needs design analysis"],
  Builder: () => ["baseline seat: every project writes code"],
  "Quality Lead": () => ["baseline seat: implementation never approves its own quality"],
  Explorer: signals => signals.fileCount >= 10 ? [`${signals.fileCount} files to map before design`] : "fewer than 10 files; nothing to map",
  Reviewer: signals => signals.fileCount > 0 ? [`${signals.fileCount} files under independent review`] : "no files to review",
  Documenter: signals => {
    const docs = signals.workAreas.filter(area => area.area === "docs" || area.paths.some(path => /\.md$/i.test(path)));
    return docs.length || signals.hasDocs ? docs.map(areaEvidence).concat(docs.length ? [] : ["markdown documentation present"]) : "no documentation work mapped";
  },
  "Security Reviewer": signals => {
    const surfaces = signals.riskSurfaces.filter(surface => surface.kind === "security" || surface.kind === "money");
    return surfaces.length ? surfaces.map(surface => `${surface.kind} surface: ${surface.paths.join(", ")}`) : "no security or money risk surface found";
  },
  Deliverer: signals => {
    const surface = signals.riskSurfaces.find(entry => entry.kind === "delivery");
    return surface ? [`delivery surface: ${surface.paths.join(", ")}`] : "no CI, container or deploy surface found";
  },
  "Test Repro Runner": (signals, profile) => signals.hasTests || profile?.quality?.testCommand
    ? [signals.hasTests ? "test files present" : `test command: ${profile.quality.testCommand}`] : "no tests or test command found",
  "Execution Coordinator": (_signals, _profile, specialtyCount) => specialtyCount >= 2
    ? [`${specialtyCount} independent implementation specialties to split and integrate`] : "fewer than 2 implementation specialties; nothing to coordinate"
};

/**
 * Builds the S13 proposal.
 * @param {{root: string, profile?: object|null, analysis?: object|null, homeDir?: string|null, catalog?: Array<{name: string, path: string}>|null, skills?: Array<{name: string, path: string}>|null, spawn?: Function}} args
 */
export async function buildProjectProposal({ root, profile = null, analysis = null, homeDir = null, skills = null, catalog = null, spawn = spawnSync } = {}) {
  const signals = collectProjectSignals(root, { spawn });
  const installed = skills ?? await readInstalledSkills({ root, homeDir, catalog }).catch(() => []);
  const specialtyFor = (name, evidence) => {
    const skill = resolveSkillForSpecialty(name, installed);
    return { name, skill, missingSkill: skill === null, evidence };
  };

  // Specialties of the Builder seat come from areas of real, recurring work in default-cell domains.
  const builderSpecialties = [];
  const extraCells = [];
  for (const entry of signals.workAreas) {
    const domain = domainOf(entry.area);
    if (!domain || !recurring(entry, signals)) continue;
    if (domain.cell) {
      let extra = extraCells.find(cell => cell.domain === domain);
      if (!extra) extraCells.push(extra = { domain, evidence: [] });
      extra.evidence.push(areaEvidence(entry));
    } else {
      const found = builderSpecialties.find(specialty => specialty.name === domain.name);
      if (found) found.evidence.push(areaEvidence(entry));
      else builderSpecialties.push(specialtyFor(domain.name, [areaEvidence(entry)]));
    }
  }

  const seats = [];
  const dropped = [];
  const analystNeeds = new Map((analysis?.recommendedRoleNeeds ?? []).filter(need => need.evidence?.length).map(need => [need.role, need]));
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) {
    if (entry.catalog !== "default") continue;
    const verdict = SEAT_RULES[role](signals, profile, builderSpecialties.length + extraCells.length);
    const need = analystNeeds.get(role);
    if (typeof verdict === "string" && !need) { dropped.push({ role, cell: entry.cell, reason: verdict }); continue; }
    const evidence = typeof verdict === "string" ? [] : verdict;
    if (need) evidence.push(`analyst: ${need.reason ?? "recommended"} (${need.evidence.join(", ")})`);
    seats.push({ role, cell: entry.cell, source: need && typeof verdict === "string" ? "analyst" : "signal", specialties: role === "Builder" ? builderSpecialties : [], evidence });
  }

  const cells = [];
  for (const seat of seats) {
    let cell = cells.find(entry => entry.name === seat.cell);
    if (!cell) cells.push(cell = { id: seat.cell, name: seat.cell, source: "default", seats: [], evidence: [] });
    cell.seats.push(seat.role);
  }
  for (const { domain, evidence } of extraCells) {
    const role = `${domain.cell} Builder`;
    seats.push({ role, cell: domain.cell, source: "proposed", extends: "Builder", specialties: [specialtyFor(domain.name, evidence)], evidence });
    cells.push({ id: domain.cell.toLowerCase(), name: domain.cell, source: "proposed", seats: [role], evidence });
  }
  for (const cell of cells) if (cell.source === "default") cell.evidence = cell.seats.map(role => `${role}: ${seats.find(seat => seat.role === role).evidence[0] ?? "mapped work"}`);

  return {
    schema: PROJECT_PROPOSAL_SCHEMA,
    status: "suggested",
    cells,
    seats,
    dropped,
    signals: {
      workAreas: signals.workAreas.slice(0, 12).map(entry => ({ area: entry.area, files: entry.files, changes: entry.changes, types: entry.types })),
      riskSurfaces: signals.riskSurfaces,
      commitCount: signals.commitCount
    }
  };
}

/** Human-readable proposal with its evidence, shown before the user approves. */
export function formatProposalEvidence(proposal) {
  if (!proposal) return "";
  const lines = ["Proposed cells and seats (suggested, nothing active until you approve):"];
  for (const cell of proposal.cells ?? []) {
    lines.push(`- ${cell.name} cell${cell.source === "proposed" ? " (extra cell proposed for this project)" : ""}`);
    for (const line of cell.evidence ?? []) lines.push(`    evidence: ${line}`);
    for (const role of cell.seats ?? []) {
      const seat = proposal.seats.find(entry => entry.role === role);
      lines.push(`  * ${role}`);
      for (const specialty of seat?.specialties ?? []) {
        lines.push(`      specialty ${specialty.name}: ${specialty.missingSkill ? "missing skill (no installed SKILL.md)" : specialty.skill.path}`);
        for (const line of specialty.evidence ?? []) lines.push(`        evidence: ${line}`);
      }
    }
  }
  if (proposal.dropped?.length) {
    lines.push("Dropped seats (no work maps to them):");
    for (const entry of proposal.dropped) lines.push(`- ${entry.role}: ${entry.reason}`);
  }
  return lines.join("\n");
}
