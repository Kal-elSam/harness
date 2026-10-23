// Best-effort termination of a provider process TREE.
//
// A child spawned with `detached: true` leads its own process group, so a
// negative pid signals the whole group (the CLI plus anything it forked).
// Where the group kill is unavailable (Windows, a missing pid, ESRCH/EPERM)
// this falls back to signalling the direct child only.
/**
 * @param {{pid?:number, kill?:Function}} child
 * @param {NodeJS.Signals} signal
 * @param {(pid:number, signal:string) => void} [killProcess] injectable for tests
 * @param {string} [platform]
 * @returns {boolean} true when some kill attempt was delivered
 */
export function killProcessTree(child, signal, killProcess = process.kill.bind(process), platform = process.platform) {
  const pid = child?.pid;
  if (platform !== "win32" && Number.isInteger(pid) && pid > 0) {
    try {
      killProcess(-pid, signal);
      return true;
    } catch { /* fall back to the direct child below */ }
  }
  try {
    child?.kill?.(signal);
    return true;
  } catch {
    return false;
  }
}
