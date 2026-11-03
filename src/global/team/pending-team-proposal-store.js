import { normalizeRoleDocument, originalRoleDocument } from "../intelligence/role-registry.js";
// Persists the PENDING team proposal a manual re-analysis produced while a
// team was already ACTIVE. The active strategy file is never touched by a
// re-analysis; the result waits here (one file per project, next to
// project-strategy.json) until a human approves the exact proposal they
// viewed, or rejects it. It survives Esc and process restarts.
//
// The id is a content hash of the proposal AND the base (active) team it was
// built against, so "approve THE viewed proposal" and "the base did not
// change" are both checkable without trusting any in-memory state.

import { createHash } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const PENDING_TEAM_PROPOSAL_SCHEMA = "kairo.pending-team-proposal/v1";

function pendingPath(homeDir, projectRoot) {
  const { sessionsDir } = harnessHomePaths(homeDir);
  return join(sessionsDir, projectKeyForPath(projectRoot), "pending-team-proposal.json");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hash of a whole strategy document: the identity of "the base team". */
export function strategyHash(strategy) {
  return createHash("sha256").update(stableStringify(originalRoleDocument(strategy) ?? null)).digest("hex");
}

/** Stable id for a proposal bound to the base it was built against. */
export function computeProposalId(proposal, basedOn) {
  return createHash("sha256").update(stableStringify({ proposal, basedOn })).digest("hex").slice(0, 24);
}

/** The pending proposal, or null for a missing, malformed or foreign file. */
export async function readPendingTeamProposal(homeDir, projectRoot, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const doc = JSON.parse(await read(pendingPath(homeDir, projectRoot), "utf8"));
    if (doc?.schema !== PENDING_TEAM_PROPOSAL_SCHEMA || typeof doc.id !== "string" || typeof doc.proposal !== "object" || !doc.proposal) return null;
    return { ...doc, proposal: normalizeRoleDocument(doc.proposal) };
  } catch {
    return null;
  }
}

export async function writePendingTeamProposal(homeDir, projectRoot, proposal, deps = {}) {
  if (typeof proposal?.id !== "string" || typeof proposal?.proposal !== "object" || !proposal.proposal) {
    throw new Error("A pending team proposal needs an id and the proposed strategy.");
  }
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = pendingPath(homeDir, projectRoot);
  const doc = { ...proposal, schema: PENDING_TEAM_PROPOSAL_SCHEMA };
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
  return doc;
}

/** Idempotent: clearing nothing is not an error. */
export async function clearPendingTeamProposal(homeDir, projectRoot, deps = {}) {
  const remove = deps.unlink ?? unlink;
  try {
    await remove(pendingPath(homeDir, projectRoot));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
