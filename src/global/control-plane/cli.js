import { resolveHomeDir } from "../paths.js";
import { printJson } from "../json-output.js";
import { commandHeader } from "../brand/index.js";
import { buildControlPlaneReport } from "./build-report.js";

export async function runControlPlaneCli(options = {}) {
  const report = await buildControlPlaneReport({
    homeDir: options.homeDir ?? resolveHomeDir(),
    cwd: options.cwd ?? process.cwd(),
    client: options.mcpClient ?? options.client ?? "cursor",
    provider: options.provider ?? "cursor",
    packageRoot: options.packageRoot ?? null,
    packageName: options.packageName ?? null,
    cliVersion: options.cliVersion ?? null
  });

  if (options.json) {
    printJson(report);
    return report;
  }

  console.log(commandHeader("Control plane"));
  console.log(`Work · ${report.work?.integration?.state ?? "—"}`);
  console.log(`Workflow · ${report.workflow?.label ?? "—"}`);
  const platforms = report.team?.platforms ?? [];
  console.log(`Team · ${platforms.length} platform(s)`);
  for (const p of platforms) {
    console.log(`  ${p.platform} · ${p.honesty} · agents=${p.agents?.length ?? 0}`);
  }
  const primary = report.attention?.primaryActions ?? [];
  if (primary.length) {
    console.log("Primary");
    for (const action of primary) console.log(`- ${action.label}`);
  }
  return report;
}
