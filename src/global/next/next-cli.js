import { resolveHomeDir } from "../paths.js";
import { printJson } from "../json-output.js";
import { commandHeader } from "../brand/index.js";
import { buildNextReport } from "./next-report.js";

export async function runNextCli(options = {}) {
  const report = await buildNextReport({
    homeDir: options.homeDir ?? resolveHomeDir(),
    cwd: options.cwd ?? process.cwd(),
    provider: options.provider ?? "cursor",
    client: options.mcpClient ?? options.client ?? "cursor"
  });

  if (options.json) {
    printJson(report);
    return report;
  }

  console.log(commandHeader("Next"));
  console.log(`Integration · ${report.integration.state}`);
  if (report.goal) console.log(`Goal · ${report.goal}`);
  if (report.now) console.log(`Now · ${report.now}`);
  if (report.next) console.log(`Next · ${report.next}`);
  if (report.blockers?.length) {
    console.log("Blockers");
    for (const item of report.blockers) console.log(`- ${item}`);
  }
  if (!report.goal && !report.now && !report.next) {
    console.log("No published work snapshot for this workspace.");
  }
  if (report.integration.showRepair) {
    console.log("Repair · MCP configuration looks broken. Re-run: kairo mcp install --yes");
  }
  return report;
}
