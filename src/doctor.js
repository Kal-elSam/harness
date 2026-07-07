import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readManifest } from "./manifest.js";
import { formatCliCommand } from "./global/brand/cli.js";

const REQUIRED_FILES = ["AGENTS.md", "docs/ai/harness.md", "docs/ai/memory.md"];

const RECOMMENDED_FILES = [
  "docs/ai/context-graph.md",
  "docs/ai/architecture.md",
  ".github/copilot-instructions.md",
  ".cursor/rules/core.mdc"
];

const DRIFT_PREVIEW_LIMIT = 5;

export async function runDoctorChecks(project) {
  const checks = [
    ...REQUIRED_FILES.map((relativePath) => fileCheck(project.root, relativePath, "required")),
    ...RECOMMENDED_FILES.map((relativePath) => fileCheck(project.root, relativePath, "recommended"))
  ];

  checks.push(...await manifestChecks(project.root));

  const hasMissingRequired = checks.some((check) => check.status === "missing");
  return { checks, ok: !hasMissingRequired };
}

function fileCheck(root, relativePath, severity) {
  const exists = existsSync(resolve(root, relativePath));
  if (exists) return { name: relativePath, status: "ok" };
  return { name: relativePath, status: severity === "required" ? "missing" : "warning" };
}

async function manifestChecks(root) {
  const manifest = await readManifest(root);

  if (!manifest) {
    return [{
      name: ".harness/manifest.json",
      status: "warning",
      detail: `Not found. Run "${formatCliCommand("init")}" to enable "${formatCliCommand("update")}".`
    }];
  }

  const checks = [{
    name: ".harness/manifest.json",
    status: "ok",
    detail: `mode=${manifest.mode}, cliVersion=${manifest.cliVersion ?? "unknown"}`
  }];

  const drifted = Object.keys(manifest.files ?? {}).filter(
    (relativePath) => !existsSync(resolve(root, relativePath))
  );

  if (drifted.length > 0) {
    const preview = drifted.slice(0, DRIFT_PREVIEW_LIMIT).join(", ");
    const suffix = drifted.length > DRIFT_PREVIEW_LIMIT ? ", ..." : "";

    checks.push({
      name: "manifest drift",
      status: "warning",
      detail: `${drifted.length} tracked file(s) missing on disk: ${preview}${suffix}`
    });
  }

  return checks;
}
