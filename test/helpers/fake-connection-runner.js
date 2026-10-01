// Test double for the provider-connections runner contract.
// All CLI behavior is SIMULATED: nothing here spawns a process.
//   runner(argv, opts) -> { done: Promise<result>, kill() }
export function createFakeRunner(script = {}) {
  const calls = [];
  const kills = [];
  function runner(argv, opts = {}) {
    calls.push({ argv: [...argv], opts });
    const key = argv.join(" ");
    const entry = script[key] ?? { errorCode: "ENOENT" };
    let kill = () => {};
    const done = new Promise((resolve, reject) => {
      if (entry.hang) { kill = () => { kills.push(key); }; return; }
      kill = () => { kills.push(key); };
      if (entry.errorCode) {
        const error = new Error(`simulated ${entry.errorCode}`);
        error.code = entry.errorCode;
        return reject(error);
      }
      resolve({ code: entry.code ?? 0, stdout: entry.stdout ?? "", stderr: entry.stderr ?? "" });
    });
    return { done, kill: () => kill() };
  }
  runner.calls = calls;
  runner.kills = kills;
  return runner;
}
