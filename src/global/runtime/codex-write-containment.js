import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const TIMEOUT_MS = 15_000;
const receipts = new WeakMap();
const WRITE_PROBE = `try {
  require('node:fs').writeFileSync(process.argv[1], 'canary', { flag: 'wx' });
  console.log('kairo-write-ok');
} catch (error) {
  if (!['EPERM', 'EACCES', 'EROFS'].includes(error.code)) process.exit(1);
  console.log('kairo-write-denied:' + error.code);
}`;

function refuse(message) {
  const error = new Error(`Codex verified-write containment unavailable: ${message}`);
  error.code = "isolation_unavailable";
  throw error;
}

// TOML basic strings share JSON's quote/backslash escapes. Reject controls,
// DEL and unpaired surrogates rather than emitting unsupported TOML escapes.
function tomlPath(path) {
  if (typeof path !== "string" || !isAbsolute(path)
    || /[\x00-\x1f\x7f]/u.test(path) || /[\ud800-\udfff]/u.test(path)) {
    refuse("profile paths must be absolute and safely TOML-escapable");
  }
  return JSON.stringify(path);
}

/** The single profile builder shared by exec and the no-model sandbox canary. */
export function buildCodexWriteProfile(cwd, { realpathSync: rp = realpathSync } = {}) {
  let root;
  try { root = rp(cwd); } catch { refuse("cwd cannot be canonicalized"); }
  const key = tomlPath(root);
  return Object.freeze({
    root, name: "kairo_cwd",
    configArgs: Object.freeze(["-c", `permissions.kairo_cwd.filesystem={":root"="read",${key}="write"}`])
  });
}

function within(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Unpersisted, single-use, cwd/posture-bound evidence; JSON copies cannot admit. */
export function consumeCodexWriteEvidence(evidence, cwd) {
  const record = evidence && typeof evidence === "object" && receipts.get(evidence);
  if (!record) return false;
  receipts.delete(evidence);
  try {
    return Date.now() - record.at <= TIMEOUT_MS
      && buildCodexWriteProfile(cwd).root === record.root;
  } catch { return false; }
}

/** No model calls. Every command must finish normally with a known probe marker. */
export async function verifyCodexWriteSandbox({ cwd, ...deps } = {}) {
  if ((deps.platform ?? process.platform) !== "darwin") refuse("requires macOS codex sandbox");
  const profile = buildCodexWriteProfile(cwd, deps);
  const rp = deps.realpathSync ?? realpathSync;
  const remove = deps.rm ?? rm;
  const hasFile = deps.exists ?? exists;
  const run = deps.run ?? ((command, args, options) => spawnSync(command, args, {
    ...options, encoding: "utf8", maxBuffer: 64 * 1024
  }));
  const deadline = Date.now() + TIMEOUT_MS;
  // User config can only add grants to the canary, never to exec (which ignores it).
  // Denying outside writes with user config loaded also proves the stricter exec posture.
  const base = ["sandbox", "-C", profile.root, "-P", profile.name,
    ...profile.configArgs, "--"];
  const paths = [];
  let outsideDir;
  async function invoke(args) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) refuse("canary timed out");
    const result = await run("codex", [...base, ...args], { cwd: profile.root, timeout });
    if (Date.now() > deadline || result?.error || result?.signal || result?.status !== 0
      || typeof result.stdout !== "string") refuse("canary failed, timed out, or returned unknown output");
    return result.stdout.trim();
  }
  try {
    // Set up a genuine non-temp outside directory, never reuse existing files.
    const home = rp(deps.homeDir ?? homedir());
    if (within(profile.root, home)) refuse("home lies within cwd; cannot probe outside writes");
    outsideDir = await (deps.mkdtemp ?? mkdtemp)(join(home, ".kairo-write-canary-"));
    outsideDir = rp(outsideDir);
    const nonce = randomBytes(12).toString("hex");
    paths.push(join(profile.root, `.kairo-write-canary-${nonce}`), join(outsideDir, "probe"),
      join(rp(deps.tempDir ?? tmpdir()), `.kairo-write-canary-${nonce}`),
      join(rp("/tmp"), `.kairo-write-canary-slash-${nonce}`));
    if (paths.slice(1).some((path) => within(profile.root, path))) refuse("outside probe lies within cwd");
    for (const [index, path] of paths.entries()) {
      const marker = await invoke([process.execPath, "-e", WRITE_PROBE, path]);
      const leaked = await hasFile(path);
      // The allowed write must really create a file; injectable fs supports offline proof.
      if (index === 0) {
        if (marker !== "kairo-write-ok" || !leaked) refuse("in-cwd write control failed");
      } else if (!/^kairo-write-denied:(EPERM|EACCES|EROFS)$/.test(marker) || leaked) {
        refuse("outside write was allowed, leaked, or returned unknown output");
      }
    }
    if (await invoke(["/bin/echo", "kairo-control-ok"]) !== "kairo-control-ok") refuse("echo control failed");
  } finally {
    const cleanup = await Promise.allSettled(paths.map((path) => remove(path, { force: true })));
    if (outsideDir) cleanup.push(...await Promise.allSettled([remove(outsideDir, { recursive: true, force: true })]));
    if (cleanup.some((result) => result.status === "rejected")) refuse("probe cleanup failed");
  }
  const evidence = Object.freeze({ verified: true, mechanism: "codex-cwd-profile", root: profile.root });
  receipts.set(evidence, { root: profile.root, at: Date.now() });
  return evidence;
}
