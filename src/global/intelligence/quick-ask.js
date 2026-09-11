import { spawn as defaultSpawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A real, read-only question -> answer call — no task, no plan, no
// approval gate. This spends real provider usage (unlike the zero-cost
// /usage local_command probes), which is expected: answering a real
// question is real work. Fail-closed: any spawn/parse error yields
// `status: "error"`, never a fabricated answer.
const DEFAULT_TIMEOUT_MS = 30_000;

function unknown(error) {
  return { status: "error", answer: null, error: String(error) };
}

/** @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number}} args */
function askClaude({ question, model, cwd, spawn, timeoutMs }) {
  const args = ["-p", question, "--output-format", "json"];
  if (model) args.push("--model", model);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve(unknown(error?.message ?? error));
      return;
    }
    let stdout = "";
    let finished = false;
    const timer = setTimeout(() => finish(unknown("claude -p timed out")), timeoutMs);
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", () => {
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { return finish(unknown("malformed JSON from claude -p")); }
      if (typeof parsed?.result !== "string") return finish(unknown("no result text in claude -p response"));
      finish({ status: "answered", answer: parsed.result, error: null });
    });
  });
}

/** @param {{question:string, model:string|null, cwd:string, spawn:Function, timeoutMs:number}} args */
async function askCodex({ question, model, cwd, spawn, timeoutMs }) {
  let outDir;
  try {
    outDir = await mkdtemp(join(tmpdir(), "kairo-ask-codex-"));
  } catch (error) {
    return unknown(error?.message ?? error);
  }
  const outFile = join(outDir, "answer.txt");
  // read-only sandbox has nothing to approve, so --approve-for-me would
  // conflict with --sandbox (the real CLI rejects combining them).
  const args = ["exec", "--sandbox", "read-only", "-o", outFile];
  if (model) args.unshift("--model", model);
  args.push(question);

  try {
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn("codex", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        resolve(unknown(error?.message ?? error));
        return;
      }
      let finished = false;
      const timer = setTimeout(() => finish(unknown("codex exec timed out")), timeoutMs);
      function finish(result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { child.kill?.(); } catch { /* best effort */ }
        resolve(result);
      }
      child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
      child.once?.("close", async () => {
        try {
          const text = (await readFile(outFile, "utf8")).trim();
          if (!text) return finish(unknown("codex exec produced no final message"));
          finish({ status: "answered", answer: text, error: null });
        } catch (error) {
          finish(unknown(error?.message ?? error));
        }
      });
    });
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Asks the given provider a real, read-only question and returns its real
 * answer text. Supports Codex and Claude today; any other provider yields
 * an honest "unsupported" result rather than a guess.
 * @param {object} args
 * @param {"codex"|"claude"} args.provider
 * @param {string} args.question
 * @param {string|null} [args.model]
 * @param {string} args.cwd
 */
export async function askProvider({
  provider, question, model = null, cwd, spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (provider === "claude") return askClaude({ question, model, cwd, spawn, timeoutMs });
  if (provider === "codex") return askCodex({ question, model, cwd, spawn, timeoutMs });
  return { status: "unsupported", answer: null, error: `ASK is not supported for provider "${provider}" yet.` };
}
