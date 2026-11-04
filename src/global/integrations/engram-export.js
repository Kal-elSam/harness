import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execute = promisify(nodeExecFile);

/** Official export only; scratch is private and retained for caller-owned cleanup. */
export async function loadEngramExport({ project, execFile = execute, timeout = 15_000 } = {}) {
  let scratchPath = null;
  const failure = (code) => ({ records: [], error: { code }, scratchPath });
  try {
    const directory = await mkdtemp(join(tmpdir(), "kairo-engram-export-"));
    scratchPath = join(directory, "export.json");
    const file = await open(scratchPath, "wx", 0o600);
    await file.close();
    const args = ["export", scratchPath];
    if (project) args.push("--project", project);
    await execFile("engram", args, { shell: false, timeout, maxBuffer: 1024 * 1024 });
  } catch (error) {
    return failure(error?.code === "ENOENT" ? "binary_missing"
      : error?.code === "ETIMEDOUT" || error?.killed ? "timeout" : "export_failed");
  }
  try {
    const payload = JSON.parse(await readFile(scratchPath, "utf8"));
    if (!Array.isArray(payload?.observations)) return failure("invalid_export");
    return { records: payload.observations, error: null, scratchPath };
  } catch {
    return failure("invalid_export");
  }
}
