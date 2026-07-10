import { supervisePreparedRun } from "./run-supervisor.js";
import { deleteRunHandoff } from "./run-handoff.js";

const homeDir = process.env.KAIRO_SUPERVISOR_HOME;
const runId = process.env.KAIRO_SUPERVISOR_RUN_ID;

if (homeDir && runId) {
  supervisePreparedRun({ homeDir, runId }).catch(async () => {
    await deleteRunHandoff(homeDir, runId).catch(() => {});
    process.exitCode = 1;
  });
}
