import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

const execute = promisify(execFile);

/** Read existing report only. Never invokes Graphify or changes its index. */
export async function loadGraphifyExport({ cwd = process.cwd(), projectDir = cwd, project = null, maxBytes = 256 * 1024 } = {}) {
  let root = resolve(projectDir);
  try {
    const result = await execute("git", ["-C", root, "rev-parse", "--show-toplevel"], { shell: false, timeout: 5000 });
    root = result.stdout.trim();
  } catch { /* Explicit non-Git project directories are supported too. */ }
  let file;
  try {
    file = await open(resolve(root, "graphify-out", "GRAPH_REPORT.md"), "r");
    if ((await file.stat()).size > maxBytes) return { architecture: [], diagnostics: ["Graphify report size too large"] };
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return { architecture: [], diagnostics: ["Graphify report size too large"] };
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const architecture = [];
    for (const match of text.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)) {
      if (!match[2].trim()) continue;
      architecture.push({ id: `graphify-${architecture.length + 1}`, title: match[1].trim(), detail: match[2].trim(), project, source: "graphify-report" });
      if (architecture.length >= 40) break;
    }
    return { architecture, diagnostics: [] };
  } catch (error) {
    return { architecture: [], diagnostics: [error?.code === "ENOENT" ? "Graphify report missing" : "Graphify report unreadable"] };
  } finally {
    await file?.close();
  }
}
