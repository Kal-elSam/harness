import { spawn as defaultSpawn } from "node:child_process";
import { join } from "node:path";
import { resolveHomeDir } from "../paths.js";

const GO_URL = "https://opencode.ai/zen/go/v1/usage";
const DEFAULT_TIMEOUT_MS = 4000;
// `opencode stats` scans local session history and can take several seconds on
// larger databases. It runs at most once per five-minute cache window.
const STATS_TIMEOUT_MS = 20_000;

function unknown(error = null, source = "opencode usage") {
  return { status: "unknown", source, windows: [], error: error ? String(error).replace(/(key|token|secret|authorization)[^\s]*/ig, "$1=[redacted]") : null };
}

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

export function normalizeOpenCodeGoUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;
  const windows = [];
  for (const [name, value] of Object.entries(usage)) {
    const percent = clamp(value?.percent);
    if (percent == null) continue;
    windows.push({
      name,
      usedPercent: percent,
      remainingPercent: 100 - percent,
      resetsAt: typeof value.resetsAt === "string" ? value.resetsAt : null,
      status: value.status === "rate-limited" ? "rate-limited" : "ok"
    });
  }
  if (!windows.length) return null;
  return {
    status: windows.some((window) => window.status === "rate-limited") ? "rate-limited" : "measured",
    source: GO_URL,
    windows,
    primary: windows.find((window) => window.name === "rolling") ?? null,
    secondary: windows.find((window) => window.name === "weekly") ?? null,
    monthly: windows.find((window) => window.name === "monthly") ?? null
  };
}

async function readGoUsage({ readFile, fetchImpl = globalThis.fetch, authPath, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let auth;
  try { auth = JSON.parse(await readFile(authPath, "utf8")); } catch (error) { return unknown(error?.code === "ENOENT" ? "OpenCode Go auth not found" : "invalid OpenCode auth", GO_URL); }
  const credential = auth?.["opencode-go"] ?? (auth?.type === "api" ? auth : null);
  const key = credential?.type === "api" && typeof credential.key === "string" ? credential.key : null;
  if (!key) return unknown("OpenCode Go credential unavailable", GO_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GO_URL, { method: "GET", headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    if (!response?.ok) return unknown(`OpenCode Go usage HTTP ${response?.status ?? "error"}`, GO_URL);
    const parsed = await response.json();
    return normalizeOpenCodeGoUsage(parsed) ?? unknown("unusable OpenCode Go usage", GO_URL);
  } catch (error) { return unknown(error?.name === "AbortError" ? "OpenCode Go usage timeout" : "OpenCode Go usage request failed", GO_URL); }
  finally { clearTimeout(timer); }
}

/** Parse only rows explicitly belonging to OpenCode providers; this is local history, not billing. */
export function parseOpenCodeStats(text) {
  const stripAnsi = (value) => String(value).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
  const parseAmount = (value) => {
    const match = String(value).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
    if (!match) return null;
    const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] ?? "").toUpperCase()] ?? 1;
    return Number(match[1]) * multiplier;
  };
  const records = [];
  let current = null;
  const push = () => {
    if (!current) return;
    current.tokens = (current.inputTokens ?? 0) + (current.outputTokens ?? 0)
      + (current.cacheRead ?? 0) + (current.cacheWrite ?? 0) || null;
    if (current.cost != null || current.tokens != null) records.push(current);
    current = null;
  };
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = stripAnsi(rawLine);
    const model = line.match(/(?:│|\|)?\s*((?:opencode-go|opencode)\/[^\s│|]+)/i)?.[1];
    if (model) {
      push();
      current = { model, provider: model.startsWith("opencode-go/") ? "opencode-go" : "opencode", cost: null, inputTokens: null, outputTokens: null, cacheRead: null, cacheWrite: null };
      continue;
    }
    if (!current) continue;
    const input = line.match(/Input Tokens\s+([\d.,]+\s*[KMB]?)/i)?.[1];
    const output = line.match(/Output Tokens\s+([\d.,]+\s*[KMB]?)/i)?.[1];
    const cost = line.match(/Cost\s+\$\s*([\d.,]+\s*[KMB]?)/i)?.[1];
    if (input) current.inputTokens = parseAmount(input);
    if (output) current.outputTokens = parseAmount(output);
    const cacheRead = line.match(/Cache Read\s+([\d.,]+\s*[KMB]?)/i)?.[1];
    const cacheWrite = line.match(/Cache Write\s+([\d.,]+\s*[KMB]?)/i)?.[1];
    if (cacheRead) current.cacheRead = parseAmount(cacheRead);
    if (cacheWrite) current.cacheWrite = parseAmount(cacheWrite);
    if (cost) current.cost = parseAmount(cost);
  }
  push();
  const zenRecords = records.filter((record) => record.provider === "opencode");
  if (!zenRecords.length) return null;
  return {
    status: "local_recorded",
    source: "opencode stats --days 7 --models",
    billing: "PAYG",
    balance: "unknown",
    autoReload: "unknown",
    kairoPolicy: "PAYG blocked",
    days: 7,
    records: zenRecords,
    goRecords: records.filter((record) => record.provider === "opencode-go"),
    totalCost: zenRecords.reduce((sum, record) => sum + (record.cost ?? 0), 0),
    totalTokens: zenRecords.reduce((sum, record) => sum + (record.tokens ?? 0), 0)
  };
}

function readStats({ spawn = defaultSpawn, timeoutMs = STATS_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn("opencode", ["stats", "--days", "7", "--models"], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch { resolve(unknown("OpenCode stats unavailable", "opencode stats --days 7 --models")); return; }
    let output = "";
    let settled = false;
    const timer = setTimeout(() => finish(unknown("OpenCode stats timeout", "opencode stats --days 7 --models")), timeoutMs);
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill?.(); } catch {} resolve(value); };
    child.stdout?.on("data", (chunk) => { output += String(chunk).slice(0, 100_000 - output.length); });
    child.once?.("error", () => finish(unknown("OpenCode stats failed", "opencode stats --days 7 --models")));
    child.once?.("close", () => finish(parseOpenCodeStats(output) ?? unknown("unparseable OpenCode stats", "opencode stats --days 7 --models")));
  });
}

export async function readOpenCodeGoUsage({
  readFile = (path, encoding) => import("node:fs/promises").then((fs) => fs.readFile(path, encoding)),
  fetchImpl = globalThis.fetch,
  homeDir = resolveHomeDir(),
  authPath = join(homeDir, ".local/share/opencode/auth.json"),
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return readGoUsage({ readFile, fetchImpl, authPath, timeoutMs });
}

export async function readOpenCodeStats({ spawn = defaultSpawn, timeoutMs = STATS_TIMEOUT_MS } = {}) {
  return readStats({ spawn, timeoutMs });
}

export async function readOpenCodeUsage({
  readFile = (path, encoding) => import("node:fs/promises").then((fs) => fs.readFile(path, encoding)),
  fetchImpl = globalThis.fetch,
  spawn = defaultSpawn,
  homeDir = resolveHomeDir(),
  authPath = join(homeDir, ".local/share/opencode/auth.json"),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  statsTimeoutMs = STATS_TIMEOUT_MS
} = {}) {
  const [go, zen] = await Promise.all([
    readOpenCodeGoUsage({ readFile, fetchImpl, authPath, homeDir, timeoutMs }),
    readOpenCodeStats({ spawn, timeoutMs: statsTimeoutMs })
  ]);
  return { go, zen };
}
