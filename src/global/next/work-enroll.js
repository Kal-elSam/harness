/**
 * Idempotent conversation enrollment scoped by runtime projectKey + conversationId.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { projectKeyForPath } from "./project-key.js";
import { snapshotFileId } from "./work-snapshot.js";

export const WORK_ENROLLMENT_SCHEMA = "kairo.work-enrollment/v1";

function enrollmentPath(homeDir, projectKey, conversationId) {
  return join(
    harnessHomePaths(homeDir).sessionsDir,
    projectKey,
    "enrollments",
    `${snapshotFileId(conversationId)}.json`
  );
}

/** Never trusts agent-supplied projectKey — derives it from projectPath. */
export async function enrollConversation(
  homeDir,
  projectPath,
  { conversationId, provider = null } = {},
  deps = {}
) {
  if (typeof conversationId !== "string" || !conversationId.trim()) {
    throw new Error("conversationId is required to enroll.");
  }
  const id = conversationId.trim().slice(0, 160);
  const projectKey = projectKeyForPath(projectPath);
  const path = enrollmentPath(homeDir, projectKey, id);
  await mkdir(join(path, ".."), { recursive: true });
  const nowIso = deps.now ? deps.now() : new Date().toISOString();
  const writeAtomic = deps.writeAtomic ?? writeAtomicJson;

  let existing = null;
  try {
    existing = JSON.parse(await readFile(path, "utf8"));
  } catch {
    existing = null;
  }

  if (existing) {
    if (
      existing.schema !== WORK_ENROLLMENT_SCHEMA
      || existing.projectKey !== projectKey
      || existing.conversationId !== id
    ) {
      throw new Error("enrollment_identity_mismatch");
    }
    const refreshed = {
      ...existing,
      provider: provider ? String(provider).slice(0, 40) : existing.provider,
      updatedAt: nowIso
    };
    await writeAtomic(path, refreshed);
    return { created: false, enrollment: refreshed };
  }

  const enrollment = {
    schema: WORK_ENROLLMENT_SCHEMA,
    projectKey,
    conversationId: id,
    provider: provider ? String(provider).slice(0, 40) : null,
    enrolledAt: nowIso,
    updatedAt: nowIso
  };
  await writeAtomic(path, enrollment);
  return { created: true, enrollment };
}

export async function loadEnrollment(homeDir, projectPath, conversationId) {
  if (typeof conversationId !== "string" || !conversationId.trim()) return null;
  const projectKey = projectKeyForPath(projectPath);
  try {
    const raw = JSON.parse(
      await readFile(enrollmentPath(homeDir, projectKey, conversationId.trim()), "utf8")
    );
    if (
      raw?.schema !== WORK_ENROLLMENT_SCHEMA
      || raw.projectKey !== projectKey
      || raw.conversationId !== conversationId.trim()
    ) return null;
    return raw;
  } catch {
    return null;
  }
}
