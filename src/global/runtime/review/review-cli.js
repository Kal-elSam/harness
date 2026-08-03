import { resolveHomeDir } from "../../paths.js";
import { printJson } from "../../json-output.js";
import { commandHeader } from "../../brand/index.js";
import { formatCliCommand } from "../../brand/cli.js";
import {
  isInteractiveTerminal, promptApplyConfirmation
} from "../../apply-confirmation.js";
import { exportGentleReviewBundle as defaultExportGentleReviewBundle } from "../../observability/gentle-bundle-export.js";
import { importGentleReviewBundle as defaultImportGentleReviewBundle } from "../../observability/gentle-bundle-import.js";
import {
  REVIEW_EXIT_CODES, REVIEW_SEVERITIES,
  assertReceiptSecretFree, assertSafeReviewId,
  listReviewReceipts, loadReviewReceipt, verifyStagedReviewReceipt
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
      commit: options.commit ?? null, staged: Boolean(options.staged),
      model: options.model ?? null,
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
    if (action === "verify") {
      if (!options.reviewId) {
        throw new Error(`Missing review id. Use: ${formatCliCommand("reviews verify <reviewId> --staged")}`);
      }
      if (!options.staged) {
        throw new Error(`Staged verification requires --staged. Use: ${formatCliCommand("reviews verify <reviewId> --staged")}`);
      }
      try { assertSafeReviewId(options.reviewId); }
      catch { throw new Error(`Invalid review id "${options.reviewId}".`); }
      let receipt;
      try {
        receipt = publicReceipt(await loadReviewReceipt(options.reviewId, { homeDir }));
      } catch {
        throw new Error(`Review receipt not found: ${options.reviewId}`);
      }
      const verified = await (deps.verifyStaged ?? verifyStagedReviewReceipt)(receipt, {
        cwd: options.cwd ?? process.cwd()
      });
      const exitCode = verified.ok ? REVIEW_EXIT_CODES.OK : REVIEW_EXIT_CODES.ERROR;
      if (options.json) {
        printJson({
          ok: verified.ok, exitCode, stale: verified.stale, reviewId: receipt.reviewId,
          previousFingerprint: verified.previousFingerprint,
          nextFingerprint: verified.nextFingerprint, headSha: verified.headSha
        });
      } else {
        console.log(commandHeader(`reviews verify ${receipt.reviewId}`));
        console.log(verified.ok ? "Staged candidate matches receipt." : "Staged candidate drifted; receipt invalid.");
      }
      process.exitCode = exitCode;
      return { ...verified, exitCode, receipt };
    }
    if (action === "export") {
      if (!options.lineage) {
        throw new Error(
          `Missing lineage. Use: ${formatCliCommand("reviews export <lineage> --out <path>")}`
        );
      }
      if (!options.outPath) {
        throw new Error(
          `Missing --out. Use: ${formatCliCommand("reviews export <lineage> --out <path>")}`
        );
      }
      const exported = await (deps.exportGentleReviewBundle ?? defaultExportGentleReviewBundle)({
        lineage: options.lineage,
        outPath: options.outPath,
        cwd: options.cwd ?? process.cwd()
      });
      const exitCode = exported.ok ? REVIEW_EXIT_CODES.OK : REVIEW_EXIT_CODES.ERROR;
      process.exitCode = exitCode;
      if (options.json) {
        printJson({
          ok: exported.ok,
          exitCode,
          code: exported.code,
          lineage: exported.lineage,
          outPath: exported.outPath,
          diagnostics: exported.diagnostics,
          providerStatus: exported.providerStatus ?? null,
          timedOut: Boolean(exported.timedOut)
        });
      } else {
        console.log(commandHeader(`reviews export ${exported.lineage ?? options.lineage}`));
        if (exported.ok) console.log(`Exported via Gentle AI → ${exported.outPath}`);
        else {
          console.error(`Export failed (${exported.code}).`);
          for (const line of exported.diagnostics ?? []) console.error(`  ${line}`);
        }
      }
      return { ...exported, exitCode };
    }
    if (action === "import") {
      if (!options.bundlePath) {
        throw new Error(
          `Missing --bundle. Use: ${formatCliCommand("reviews import --bundle <path> --confirm-import")}`
        );
      }
      const imported = await (deps.importGentleReviewBundle ?? defaultImportGentleReviewBundle)({
        bundlePath: options.bundlePath,
        cwd: options.cwd ?? process.cwd(),
        confirmImport: Boolean(options.confirmImport)
      });
      const exitCode = imported.ok ? REVIEW_EXIT_CODES.OK : REVIEW_EXIT_CODES.ERROR;
      process.exitCode = exitCode;
      if (options.json) {
        printJson({
          ok: imported.ok,
          exitCode,
          code: imported.code,
          mutationOutcome: imported.mutationOutcome,
          bundlePath: imported.bundlePath,
          cwd: imported.cwd,
          diagnostics: imported.diagnostics,
          providerStatus: imported.providerStatus ?? null,
          timedOut: Boolean(imported.timedOut),
          permissionAuthority: imported.permissionAuthority ?? null
        });
      } else {
        console.log(commandHeader(`reviews import ${imported.bundlePath ?? options.bundlePath}`));
        if (imported.ok) console.log("Imported via Gentle AI (provider-owned authority).");
        else {
          console.error(`Import failed (${imported.code}; mutation=${imported.mutationOutcome}).`);
          for (const line of imported.diagnostics ?? []) console.error(`  ${line}`);
        }
      }
      return { ...imported, exitCode };
    }
    throw new Error(`Unknown reviews action "${action}". Use list, show, verify, export, or import.`);
  } catch (error) {
    const exitCode = REVIEW_EXIT_CODES.ERROR;
    const message = String(error?.message ?? error);
    if (options.json) printJson({ ok: false, exitCode, error: message, code: error?.code ?? null });
    else console.error(message);
    process.exitCode = exitCode;
    return { exitCode, error };
  }
}
