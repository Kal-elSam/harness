/**
 * Publish kairo.work-snapshot/v1 from runtime-derived workspace identity.
 */
import { resolveHomeDir } from "../paths.js";
import { projectKeyForPath } from "./project-key.js";
import { enrollConversation } from "./work-enroll.js";
import {
  assertNoWorkPrivatePayload,
  createWorkSnapshot,
  isIgnoredSmokeConversationId,
  saveWorkSnapshot,
  selectLatestWorkSnapshot,
  snapshotIsComplete
} from "./work-snapshot.js";

const FORBIDDEN = Object.freeze([
  "projectKey", "projectPath", "cwd", "homeDir", "workspaceRoot"
]);

function fail(code) {
  return { ok: false, code, data: null, diagnostics: [code] };
}

/**
 * Validate → enroll → atomic snapshot write.
 * Workspace comes only from deps.cwd / process.cwd().
 */
export async function publishWorkSnapshot(input = {}, deps = {}) {
  try {
    assertNoWorkPrivatePayload(input);
  } catch {
    return fail("private_payload");
  }
  for (const key of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return fail("forbidden_identity_fields");
    }
  }

  const conversationId = typeof input.conversationId === "string"
    ? input.conversationId.trim()
    : "";
  if (!conversationId) return fail("conversation_required");
  if (isIgnoredSmokeConversationId(conversationId)) return fail("ignored_conversation");

  const provider = typeof input.provider === "string" && input.provider.trim()
    ? input.provider.trim().slice(0, 40)
    : null;
  if (!provider) return fail("provider_required");

  const draft = createWorkSnapshot({
    goal: input.goal,
    progress: input.progress,
    now: input.now,
    blockers: input.blockers,
    next: input.next,
    delegations: input.delegations,
    conversationId,
    provider
  });
  if (!snapshotIsComplete(draft)) return fail("incomplete_snapshot");

  const homeDir = deps.homeDir ?? resolveHomeDir();
  const projectPath = deps.cwd ?? process.cwd();
  const projectKey = projectKeyForPath(projectPath);
  const io = { now: deps.now, writeAtomic: deps.writeAtomic };

  let enrollmentResult;
  try {
    enrollmentResult = await (deps.enrollConversation ?? enrollConversation)(
      homeDir, projectPath, { conversationId, provider }, io
    );
  } catch {
    return fail("enroll_failed");
  }

  let saved;
  try {
    saved = await (deps.saveWorkSnapshot ?? saveWorkSnapshot)(
      homeDir, projectPath, conversationId, draft, io
    );
  } catch {
    return fail("snapshot_write_failed");
  }

  if (saved.projectKey !== projectKey || saved.conversationId !== conversationId) {
    return fail("identity_mismatch");
  }

  const latest = await (deps.selectLatestWorkSnapshot ?? selectLatestWorkSnapshot)(
    homeDir, projectPath
  );

  return {
    ok: true,
    code: enrollmentResult.created ? "enrolled" : "updated",
    data: {
      projectKey,
      conversationId,
      enrolled: true,
      created: enrollmentResult.created === true,
      snapshot: {
        schema: saved.schema,
        goal: saved.goal,
        progress: saved.progress,
        now: saved.now,
        blockers: saved.blockers,
        next: saved.next,
        ...(saved.delegations ? { delegations: saved.delegations } : {}),
        updatedAt: saved.updatedAt
      },
      selected: latest?.conversationId === conversationId
    },
    diagnostics: []
  };
}
