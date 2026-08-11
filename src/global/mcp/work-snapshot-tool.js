import * as z from "zod";
import { publishWorkSnapshot } from "../next/publish-work-snapshot.js";

export const workSnapshotPublishSchema = z.object({
  conversationId: z.string().min(1).max(160),
  provider: z.enum(["cursor", "codex", "claude", "opencode", "pi", "other"]),
  goal: z.string().min(1).max(160),
  now: z.string().min(1).max(240),
  next: z.string().min(1).max(240),
  progress: z.array(z.string().max(160)).max(3).optional(),
  blockers: z.array(z.string().max(200)).max(12).optional(),
  delegations: z.array(z.object({
    workId: z.string().max(64).optional(),
    title: z.string().max(160).optional(),
    role: z.enum(["orchestrator", "worker"]).optional(),
    state: z.enum(["assigned", "working", "blocked", "completed", "failed"]).optional()
  }).strict()).max(12).optional()
}).strict();

export function createPublishWorkSnapshotHandler(deps = {}) {
  const publishSnapshot = deps.publishWorkSnapshot ?? ((input) => publishWorkSnapshot(input, {
    homeDir: deps.homeDir,
    cwd: deps.cwd,
    now: deps.now,
    writeAtomic: deps.writeAtomic
  }));
  const toResult = deps.mcpResult;
  if (typeof toResult !== "function") {
    throw new Error("mcpResult dependency is required");
  }

  return async function kairo_publish_work_snapshot(args = {}) {
    try {
      const result = await publishSnapshot(args);
      return toResult({
        ok: Boolean(result?.ok),
        code: result?.code ?? "publish_failed",
        data: result?.data ?? null,
        diagnostics: result?.diagnostics ?? [],
        isError: !result?.ok
      });
    } catch {
      return toResult({
        ok: false, code: "publish_failed", data: null,
        diagnostics: ["publish_failed"], isError: true
      });
    }
  };
}
