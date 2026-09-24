// Child-process probe for test/host-launch.test.js. It patches every
// node:fs write API BEFORE the launcher module is imported and syncs the
// builtin ESM named exports, so writes made through direct named imports
// (not only through the injectable fsImpl) are recorded. It prints the
// recorded write targets as JSON on stdout.
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

// `node --test` runs every file under test/, helpers included. Without
// probe arguments there is nothing to check, so exit before patching fs.
if (process.argv.length < 6) process.exit(0);

const SYNC_WRITE_APIS = [
  "writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "renameSync",
  "copyFileSync", "cpSync", "symlinkSync", "linkSync", "rmSync", "rmdirSync",
  "unlinkSync", "truncateSync", "chmodSync", "utimesSync", "openSync"
];
const CALLBACK_WRITE_APIS = [
  "writeFile", "appendFile", "mkdir", "mkdtemp", "rename", "copyFile", "cp",
  "symlink", "link", "rm", "rmdir", "unlink", "truncate", "chmod", "utimes"
];
const PROMISE_WRITE_APIS = [
  "writeFile", "appendFile", "mkdir", "mkdtemp", "rename", "copyFile", "cp",
  "symlink", "link", "rm", "rmdir", "unlink", "truncate", "chmod", "utimes"
];

const writes = [];

function wrap(target, name, label) {
  const original = target[name];
  if (typeof original !== "function") return;
  target[name] = function recordedWrite(path, ...rest) {
    if (name === "openSync" && !isWriteFlag(rest[0])) {
      return original.call(this, path, ...rest);
    }
    writes.push({ op: `${label}${name}`, path: String(path) });
    return original.call(this, path, ...rest);
  };
}

function isWriteFlag(flags) {
  if (flags === undefined) return false;
  if (typeof flags === "number") return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0;
  return /[wa+]/.test(String(flags));
}

for (const name of SYNC_WRITE_APIS) wrap(fs, name, "fs.");
for (const name of CALLBACK_WRITE_APIS) wrap(fs, name, "fs.");
for (const name of PROMISE_WRITE_APIS) wrap(fsPromises, name, "fs/promises.");
syncBuiltinESMExports();

const { launchGentleShell } = await import("../../src/global/host/launch-gentle-shell.js");

// The parent test builds the fixture package, so its setup writes are not recorded.
const [cwd, extensionDir, harnessHome, entryPath] = process.argv.slice(2);

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

process.stdout.write(JSON.stringify(writes));
