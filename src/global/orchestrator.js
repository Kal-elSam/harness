import { BRAND } from "./brand/index.js";
import { buildReadOnlyDiagnostics, shouldExecutePlan } from "./action-planner.js";

export async function runOrchestratorDiagnostics({
  homeDir,
  workspaceRoot,
  packageName,
  packageRoot,
  cliVersion,
  json = false
}) {
  const diagnostics = await buildReadOnlyDiagnostics({
    homeDir,
    workspaceRoot,
    packageName,
    packageRoot,
    cliVersion
  });

  if (json) {
    return diagnostics;
  }

  console.log(commandHeader("orchestrator — agent capability diagnostics"));
  console.log(`Home: ${homeDir}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("");

  for (const capability of diagnostics.capabilities) {
    console.log(
      `  ${capability.label.padEnd(14)} ${capability.state.padEnd(14)} detected=${capability.detected ? "yes" : "no"}`
    );
  }

  if (diagnostics.intelligence) {
    console.log("");
    console.log("Intelligence backends:");
    for (const backend of diagnostics.intelligence.backends) {
      console.log(
        `  ${backend.label.padEnd(14)} ${backend.state.padEnd(14)} models=${backend.models?.length ?? 0}`
      );
    }
    console.log(`  Routing: ${diagnostics.intelligence.routingPreview?.reason ?? "n/a"}`);
  }

  console.log("");
  console.log("Recommendations:");
  for (const recommendation of diagnostics.recommendations) {
    console.log(`  - ${recommendation}`);
  }

  return diagnostics;
}

function commandHeader(title) {
  return `${BRAND.displayName} ${title}`;
}

export function assertPlanExecution(plan, { confirmed = false } = {}) {
  if (!shouldExecutePlan(plan, { confirmed })) {
    throw new Error("Plan declined. No writes or installations were performed.");
  }
}
