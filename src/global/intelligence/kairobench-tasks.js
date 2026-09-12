// KairoBench: a small, hand-authored, reproducible task battery — NOT
// hundreds of tasks fired at once. Every task runs identically against
// every real model Kairo has access to (same prompt, same working
// directory shape, same verification), so results are directly
// comparable in a way no public leaderboard can be, since it's measured
// against exactly what Kairo can actually invoke, not a vendor's idea of
// what matters.
//
// Deliberately starts tiny per explicit decision: stage KairoBench, never
// run a large paid batch at once. Grows only after this batch's results
// are reviewed.
//
// `verify` is a scriptable, deterministic pass/fail check against the
// task's real working directory — never an LLM-graded "quality" score,
// which would just be another unverified opinion layered on top. Judged
// quality scoring is explicitly out of scope for this first version.

export const KAIROBENCH_TASKS = [
  {
    id: "implementation-01",
    category: "Implementation",
    prompt: "Create a file named answer.txt in the current directory containing exactly the text: 42",
    /** @param {{readFile: (path: string, encoding: string) => Promise<string>}} io */
    async verify({ readFile }) {
      try {
        const content = await readFile("answer.txt", "utf8");
        return content.trim() === "42";
      } catch {
        return false;
      }
    }
  },
  {
    id: "debugging-01",
    category: "Debugging",
    prompt: "The file broken.js exports add(a, b) but its return statement is missing, so it always returns undefined. Fix it so add(2, 3) returns 5. Do not change the function signature or exports.",
    /** @param {{writeFile: (path: string, content: string) => Promise<void>}} io */
    async setup({ writeFile }) {
      await writeFile("broken.js", "function add(a, b) {\n  a + b;\n}\n\nmodule.exports = { add };\n");
    },
    /** @param {{run: (command: string, args: string[]) => Promise<{stdout: string, exitCode: number}>}} io */
    async verify({ run }) {
      const result = await run("node", ["-e", "console.log(require('./broken.js').add(2, 3))"]);
      return result.exitCode === 0 && result.stdout.trim() === "5";
    }
  }
];
