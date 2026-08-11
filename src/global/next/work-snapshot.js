/**
 * kairo.work-snapshot/v1 — semantic work state for observability.
 * Never stores prompts, transcripts, or agent-supplied workspace identity.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { projectKeyForPath } from "./project-key.js";

export const WORK_SNAPSHOT_SCHEMA = "kairo.work-snapshot/v1";

/** Known smoke/fixture conversation ids — ignored on read, never auto-deleted. */
export const IGNORED_SMOKE_CONVERSATION_IDS = Object.freeze([
  "echopilot-visual-smoke"
]);

const PRIVATE_KEYS = Object.freeze([
  "prompt", "prompts", "transcript", "transcripts", "response", "messages"
]);

const TECH_LEAK_RE =
  /\bks_[a-f0-9]{8,}\b|kairo\.(?:work|next|session)|call kairo_|engramRef|schema\s*[:=]/i;

export function isIgnoredSmokeConversationId(id) {
  return Boolean(id) && IGNORED_SMOKE_CONVERSATION_IDS.includes(String(id));
}

export function looksLikeTechnicalLeak(text) {
  return TECH_LEAK_RE.test(String(text ?? ""));
}

export function assertNoWorkPrivatePayload(input) {
  if (!input || typeof input !== "object") return;
  for (const key of PRIVATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`Private field "${key}" is not allowed on work payloads.`);
    }
  }
}

function snapshotsDir(homeDir, projectKey) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKey, "snapshots");
}

/** Stable file id — avoids collisions from sanitized path characters. */
export function snapshotFileId(conversationId) {
  return createHash("sha256").update(String(conversationId)).digest("hex").slice(0, 32);
}

function snapshotFilePath(homeDir, projectKey, conversationId) {
  return join(snapshotsDir(homeDir, projectKey), `${snapshotFileId(conversationId)}.json`);
}

function resolveConversationId(conversationId, snapshot) {
  const raw = conversationId ?? snapshot?.conversationId ?? null;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("conversationId is required to save a work snapshot.");
  }
  return raw.trim().slice(0, 160);
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || looksLikeTechnicalLeak(trimmed)) return null;
  return trimmed.slice(0, max);
}

function cleanTextList(list, maxItem, maxItems) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => cleanText(item, maxItem)).filter(Boolean).slice(0, maxItems);
}

function sanitizeDelegations(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const title = cleanText(row.title ?? row.goal, 160);
      const workId = typeof row.workId === "string" && /^kw_[a-f0-9]{32}$/i.test(row.workId)
        ? row.workId
        : null;
      if (!title && !workId) return null;
      const role = row.role === "orchestrator" || row.role === "worker" ? row.role : null;
      const state = ["assigned", "working", "blocked", "completed", "failed"].includes(row.state)
        ? row.state
        : null;
      return {
        ...(workId ? { workId } : {}),
        ...(title ? { title } : {}),
        ...(role ? { role } : {}),
        ...(state ? { state } : {})
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

export function isWorkSnapshotSchema(schema) {
  return schema === WORK_SNAPSHOT_SCHEMA;
}

/** Build a sanitized v1 snapshot. Incomplete inputs keep nulls — never invent text. */
export function createWorkSnapshot(input = {}) {
  assertNoWorkPrivatePayload(input);
  const goal = cleanText(input.goal, 160);
  const now = cleanText(input.now, 240);
  const next = cleanText(input.next, 240);
  const progress = cleanTextList(input.progress, 160, 3);
  const blockers = cleanTextList(input.blockers, 200, 12);
  const delegations = sanitizeDelegations(input.delegations);
  const conversationId = input.conversationId
    ? String(input.conversationId).slice(0, 160)
    : null;
  const provider = input.provider ? String(input.provider).slice(0, 40) : null;

  return {
    schema: WORK_SNAPSHOT_SCHEMA,
    goal,
    progress,
    now,
    blockers,
    next,
    ...(delegations.length > 0 ? { delegations } : {}),
    conversationId,
    provider,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
}

export function snapshotIsComplete(snapshot) {
  return Boolean(
    snapshot
    && isWorkSnapshotSchema(snapshot.schema)
    && snapshot.goal
    && snapshot.now
    && snapshot.next
  );
}

function acceptStoredSnapshot(raw) {
  if (!isWorkSnapshotSchema(raw?.schema)) return null;
  if (isIgnoredSmokeConversationId(raw.conversationId)) return null;
  return raw;
}

export async function saveWorkSnapshot(
  homeDir,
  projectPath,
  conversationId,
  snapshot,
  deps = {}
) {
  const resolvedId = resolveConversationId(conversationId, snapshot);
  const projectKey = projectKeyForPath(projectPath);
  await mkdir(snapshotsDir(homeDir, projectKey), { recursive: true });
  const nowIso = deps.now ? deps.now() : new Date().toISOString();
  const payload = {
    ...createWorkSnapshot({
      ...snapshot,
      conversationId: resolvedId,
      updatedAt: nowIso
    }),
    projectKey,
    updatedAt: nowIso
  };
  await (deps.writeAtomic ?? writeAtomicJson)(
    snapshotFilePath(homeDir, projectKey, resolvedId),
    payload
  );
  return payload;
}

export async function loadWorkSnapshot(homeDir, projectPath, conversationId) {
  if (typeof conversationId !== "string" || !conversationId.trim()) return null;
  const projectKey = projectKeyForPath(projectPath);
  try {
    const raw = JSON.parse(
      await readFile(snapshotFilePath(homeDir, projectKey, conversationId.trim()), "utf8")
    );
    return acceptStoredSnapshot(raw);
  } catch {
    return null;
  }
}

export async function listWorkSnapshots(homeDir, projectPath) {
  const projectKey = projectKeyForPath(projectPath);
  const dir = snapshotsDir(homeDir, projectKey);
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(join(dir, name), "utf8"));
      const accepted = acceptStoredSnapshot(raw);
      if (accepted) out.push(accepted);
    } catch {
      // corrupt files are skipped — callers see absence, not invented content
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Most recently updated real snapshot for this workspace. */
export async function selectLatestWorkSnapshot(homeDir, projectPath) {
  const [latest] = await listWorkSnapshots(homeDir, projectPath);
  return latest ?? null;
}
