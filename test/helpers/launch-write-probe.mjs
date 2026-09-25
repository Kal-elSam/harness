// Child-process probe for test/host-launch.test.js. It patches node:fs and
// node:fs/promises write entry points BEFORE the launcher module is
// imported and syncs the builtin ESM named exports, so writes made through
// direct named imports (not only through the injectable fsImpl) are
// recorded.
//
// Coverage: every path-taking API that creates, changes, or removes a file
// system entry (both paths for two-path APIs such as rename, copyFile, cp,
// symlink, and link), plus `open`/`openSync`/`fs/promises.open` with a
// write flag and `createWriteStream`. Descriptor-based writes
// (write/writev/ftruncate/fchmod and FileHandle methods) need a descriptor
// opened for writing first, so they are covered through the recorded open.
// Descriptors inherited from the parent (stdout/stderr) are not files the
// launcher chooses and are out of scope.
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const PROBE_ARGS = ["cwd", "extensionDir", "harnessHome", "entryPath", "resultPath"];

// `node --test` runs every file under test/, helpers included. Without
// probe arguments there is nothing to check, so exit before patching fs.
const args = process.argv.slice(2);
if (args.length < PROBE_ARGS.length) process.exit(0);
const [cwd, extensionDir, harnessHome, entryPath, resultPath] = args;

// Base names; each one is wrapped as fs.<name>, fs.<name>Sync, and
// fs/promises.<name> when that variant exists.
const ONE_PATH_APIS = [
  "writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink",
  "truncate", "chmod", "lchmod", "chown", "lchown", "utimes", "lutimes"
];
const TWO_PATH_APIS = ["rename", "copyFile", "cp", "symlink", "link"];
const OPEN_APIS = ["open"];

// Captured before patching so the probe's own result write is not recorded.
const writeResult = fs.writeFileSync;
const writes = [];

function record(op, paths) {
  for (const path of paths) writes.push({ op, path: String(path) });
}

function wrap(target, name, label, pathsOf) {
  const original = target[name];
  if (typeof original !== "function") return;
  target[name] = function recordedWrite(...callArgs) {
    const paths = pathsOf(callArgs);
    if (paths.length > 0) record(`${label}${name}`, paths);
    return original.apply(this, callArgs);
  };
}

function isWriteFlag(flags) {
  if (flags === undefined || flags === null) return false;
  if (typeof flags === "number") {
    return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
  }
  return /[wa+]/.test(String(flags));
}

function eachVariant(base, pathsOf) {
  wrap(fs, base, "fs.", pathsOf);
  wrap(fs, `${base}Sync`, "fs.", pathsOf);
  wrap(fsPromises, base, "fs/promises.", pathsOf);
}

for (const base of ONE_PATH_APIS) eachVariant(base, ([path]) => [path]);
for (const base of TWO_PATH_APIS) eachVariant(base, ([from, to]) => [from, to]);
for (const base of OPEN_APIS) eachVariant(base, ([path, flags]) => (isWriteFlag(flags) ? [path] : []));
wrap(fs, "createWriteStream", "fs.", ([path]) => [path]);
syncBuiltinESMExports();

const { launchGentleShell } = await import("../../src/global/host/launch-gentle-shell.js");

// The parent test builds the fixture package, so its setup writes are not recorded.
await launchGentleShell({
  cwd,
  extensionDir,
  statImpl: () => ({ isDirectory: () => true }),
  env: { HARNESS_HOME: harnessHome, PATH: process.env.PATH },
  nodeVersion: "22.19.0",
  execPath: "/fake/node/bin/node",
  resolveEntryImpl: () => entryPath,
  spawnImpl: () => ({ status: 0 })
});

// Results go to a dedicated file so launcher console output cannot corrupt them.
writeResult(resultPath, JSON.stringify(writes), "utf8");
