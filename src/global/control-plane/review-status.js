/**
 * Official Gentle review status v2/v3 only. Never read authority inventory.
 */
import { isAbsolute } from "node:path";
import { SUPPORTED_CONTRACT } from "../observability/gentle-probe.js";

export const REVIEW_STATUS_SCHEMAS = Object.freeze([
  "gentle-ai.review-integration.status/v2",
  "gentle-ai.review-integration.status/v3"
]);

const INVENTORY_SCHEMA = "gentle-ai.review-authority-status/v1";
const UNSAFE_TOKEN = /[|;&$`\n\r]/;
const PLACEHOLDER = /^<[^>]+>$/;

export const GENTLE_224_BOOTSTRAP =
  "gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --next-transition";
export const GENTLE_230_BOOTSTRAP =
  "gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition";

const failArgv = () => ({ ok: false, error: "gentle_incompatible", binary: null, argv: null });

export function bootstrapCommandFromProbe(probe) {
  return probe?.evidence?.find((row) => row?.kind === "bootstrap" && row.command)?.command ?? null;
}

export function argvFromBootstrap(command, { repo, binaryPath }) {
  if (typeof command !== "string" || !command.trim() || UNSAFE_TOKEN.test(command)) return failArgv();
  if (typeof binaryPath !== "string" || !isAbsolute(binaryPath)) return failArgv();
  if (typeof repo !== "string" || !repo) return failArgv();
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "gentle-ai") return failArgv();
  const args = [];
  const rest = tokens.slice(1);
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i];
    if (UNSAFE_TOKEN.test(tok)) return failArgv();
    if (tok === "--cwd") {
      const next = rest[i + 1];
      const needsRepo = next === "<repo>" || next == null || next.startsWith("-");
      args.push("--cwd", needsRepo ? repo : next);
      if (!needsRepo || next === "<repo>") i += 1;
      continue;
    }
    if (PLACEHOLDER.test(tok)) return failArgv();
    args.push(tok);
  }
  if (args[0] !== "review" || args[1] !== "status") return failArgv();
  return { ok: true, error: null, binary: binaryPath, argv: args };
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function publishedReceipt(receiptField) {
  if (typeof receiptField === "string" && receiptField) return receiptField;
  if (!isObject(receiptField)) return null;
  if (typeof receiptField.id === "string" && receiptField.id) return receiptField.id;
  if (typeof receiptField.digest === "string" && receiptField.digest) return receiptField.digest;
  return null;
}

function publishedGate(payload) {
  if (typeof payload.gate === "string" && payload.gate) return payload.gate;
  if (isObject(payload.receipt) && typeof payload.receipt.gate === "string" && payload.receipt.gate) {
    return payload.receipt.gate;
  }
  return null;
}

/**
 * Fail closed unless schema/contract are official. Pass next_transition through unaltered.
 */
export function mapOfficialReviewStatus(payload) {
  if (!isObject(payload)) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }
  if (
    payload.schema === INVENTORY_SCHEMA
    || payload.authoritative === true
    || Array.isArray(payload.entries)
  ) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }
  if (!REVIEW_STATUS_SCHEMAS.includes(payload.schema)) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }
  if (payload.contract != null && payload.contract !== SUPPORTED_CONTRACT) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }

  const nextTransition = Object.prototype.hasOwnProperty.call(payload, "next_transition")
    ? payload.next_transition
    : null;
  const receipt = publishedReceipt(payload.receipt);
  const gate = publishedGate(payload);
  const applicability = typeof payload.applicability === "string" ? payload.applicability : null;
  const action = typeof payload.action === "string" ? payload.action : null;
  const receiptStatus = isObject(payload.receipt) && typeof payload.receipt.status === "string"
    ? payload.receipt.status
    : null;

  const review = (receipt || gate || applicability || action)
    ? {
        lineageId: null,
        state: applicability ?? action,
        status: receiptStatus,
        receipt,
        gate
      }
    : null;

  return { ok: true, error: null, review, nextTransition };
}
