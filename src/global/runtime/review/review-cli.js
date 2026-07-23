import { resolveHomeDir } from "../../paths.js";
import { printJson } from "../../json-output.js";
import { commandHeader } from "../../brand/index.js";
import { formatCliCommand } from "../../brand/cli.js";
import {
  isInteractiveTerminal, promptApplyConfirmation
} from "../../apply-confirmation.js";
import {
  REVIEW_EXIT_CODES, REVIEW_SEVERITIES,
  assertReceiptSecretFree, assertSafeReviewId,
  listReviewReceipts, loadReviewReceipt
} from "./index.js";
import { runReview } from "./review-runner.js";

const FAIL_ON = new Set(Object.values(REVIEW_SEVERITIES));

function parseFailOn(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!FAIL_ON.has(normalized)) {
    throw new Error(`Invalid --fail-on "${value}". Use high, medium, or low.`);
  }
  return normalized;
}

async function resolvePrivateConfirmed(options, { prompt = promptApplyConfirmation } = {}) {
  if (!options.includePrivate) return { privateConfirmed: false, cancelled: false };
  if (options.yes || options.confirm) return { privateConfirmed: true, cancelled: false };
  if (!isInteractiveTerminal(options.interactive)) {
    throw new Error(
      "Including private paths requires --include-private with --yes/--confirm, or a TTY confirmation."
    );
  }
  const ok = await prompt({
    command: "review",
    question: "Include private paths in this review? [Y/n]: "
  });
  return { privateConfirmed: Boolean(ok), cancelled: !ok };
}

function publicReceipt(receipt) {
  return assertReceiptSecretFree(receipt);
}

function printReviewHuman(receipt, exitCode) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of receipt.findings ?? []) {
    if (counts[f.severity] != null) counts[f.severity] += 1;
  }
  console.log(commandHeader(`review ${receipt.reviewId}`));
  console.log(`Agent: ${receipt.agentId} · state: ${receipt.state} · exit: ${exitCode}`);
  console.log(
    `Findings: ${(receipt.findings ?? []).length}`
    + ` (high ${counts.high}, medium ${counts.medium}, low ${counts.low})`
  );
  console.log(
    `Snapshot: ${receipt.snapshot.mode} · files ${receipt.snapshot.totals.fileCount}`
    + ` · ${receipt.snapshot.fingerprint.slice(0, 12)}`
  );
  if ((receipt.warnings ?? []).length) console.log(`Warnings: ${receipt.warnings.length}`);
}

export async function runGlobalReview(options, packageManifest, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  try {
    if (!options.agent) {
      throw new Error(`Missing --agent. Use: ${formatCliCommand("review --agent codex|pi")}`);
    }
    const failOn = parseFailOn(options.failOn);
    const consent = await resolvePrivateConfirmed(options, { prompt: deps.prompt });
    if (consent.cancelled) {
      if (options.json) {
        printJson({
          ok: false, cancelled: true, exitCode: REVIEW_EXIT_CODES.ERROR,
          error: "Private path inclusion cancelled."
        });
      } else {
        console.log("Review cancelled: private paths not included.");
      }
      process.exitCode = REVIEW_EXIT_CODES.ERROR;
      return { cancelled: true, exitCode: REVIEW_EXIT_CODES.ERROR };
    }

    const result = await (deps.runReview ?? runReview)({
      cwd: options.cwd, agent: options.agent, base: options.base ?? null,
      commit: options.commit ?? null, model: options.model ?? null,
      includePrivate: Boolean(options.includePrivate),
      privateConfirmed: consent.privateConfirmed, failOn,
      homeDir, cliVersion: packageManifest?.version ?? null
    });
    const receipt = publicReceipt(result.receipt);
    if (options.json) printJson({ ok: result.exitCode === 0, exitCode: result.exitCode, receipt });
    else printReviewHuman(receipt, result.exitCode);
    process.exitCode = result.exitCode;
    return { receipt, exitCode: result.exitCode };
  } catch (error) {
    const exitCode = REVIEW_EXIT_CODES.ERROR;
    const message = String(error?.message ?? error);
    if (options.json) printJson({ ok: false, exitCode, error: message, code: error?.code ?? null });
    else console.error(message);
    process.exitCode = exitCode;
    return { exitCode, error };
  }
}

export async function runGlobalReviews(options, _packageManifest, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  try {
    const action = options.reviewsAction ?? "list";
    if (action === "list") {
      const receipts = (await listReviewReceipts({ homeDir, limit: options.limit }))
        .map((r) => publicReceipt(r));
      if (options.json) printJson({ receipts });
      else {
        console.log(commandHeader("reviews"));
        if (receipts.length === 0) console.log("  (no reviews yet)");
        for (const r of receipts) {
          console.log(
            `  ${r.reviewId}  ${String(r.state).padEnd(10)}  ${String(r.agentId).padEnd(6)}  ${r.createdAt}`
          );
        }
      }
      return { receipts };
    }
    if (action === "show") {
      if (!options.reviewId) {
        throw new Error(`Missing review id. Use: ${formatCliCommand("reviews show <reviewId>")}`);
      }
      try { assertSafeReviewId(options.reviewId); }
      catch { throw new Error(`Invalid review id "${options.reviewId}".`); }
      let receipt;
      try {
        receipt = publicReceipt(await loadReviewReceipt(options.reviewId, { homeDir }));
      } catch {
        throw new Error(`Review receipt not found: ${options.reviewId}`);
      }
      if (options.json) printJson({ receipt });
      else printReviewHuman(receipt, REVIEW_EXIT_CODES.OK);
      return { receipt };
    }
    throw new Error(`Unknown reviews action "${action}". Use list or show.`);
  } catch (error) {
    const exitCode = REVIEW_EXIT_CODES.ERROR;
    const message = String(error?.message ?? error);
    if (options.json) printJson({ ok: false, exitCode, error: message, code: error?.code ?? null });
    else console.error(message);
    process.exitCode = exitCode;
    return { exitCode, error };
  }
}
