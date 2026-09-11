import { createHash } from "node:crypto";

export const ARCHITECT_SCHEMA = "kairo.architect-task/v1";

export const PLAN_STATES = Object.freeze({
  DRAFT: "draft",
  AWAITING_APPROVAL: "awaiting_approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  FAILED: "failed"
});

export function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function normalizeArchitectTask(task) {
  return String(task ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function createArchitectureRequestKey({ projectRoot, baseHead, task, model = null }) {
  return sha256(JSON.stringify([
    String(projectRoot),
    String(baseHead),
    normalizeArchitectTask(task),
    model == null ? "" : String(model).trim()
  ]));
}

export function createTaskId(task, now = new Date()) {
  const slug = String(task ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${stamp}-${slug}-${sha256(task).slice(0, 8)}`;
}

export function assertTaskId(taskId) {
  if (typeof taskId !== "string" || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(taskId)) {
    throw new Error(`Invalid task id "${taskId ?? ""}".`);
  }
  return taskId;
}
