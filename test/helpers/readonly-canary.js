// Shared helpers for the no-model read-only write canaries. Every canary runs
// inside a throwaway git repo under the real temp dir; nothing here touches
// the project, ~/.harness, ~/.claude or ~/.codex.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTempGitRepo() {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "kairo-canary-")));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.js"), "export const x = 1;\n");
  writeFileSync(join(root, "README.md"), "# canary\n");
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q", ".");
  git("add", ".");
  git("-c", "user.name=canary", "-c", "user.email=canary@example.invalid", "commit", "-qm", "init");
  return root;
}

/** Deterministic path -> hash map of the whole tree, including .git. */
export function snapshotTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      const rel = full.slice(root.length + 1);
      if (stat.isDirectory()) { out[`${rel}/`] = "dir"; walk(full); }
      else if (stat.isSymbolicLink()) out[rel] = `link:${readlinkSync(full)}`;
      else out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

/** Source of a node script that attempts every kind of repository write and prints errno codes. */
export const WRITE_PROBE = `
const fs = require("fs"), path = require("path");
const root = process.argv[1];
const out = {};
const attempt = (name, fn) => { try { fn(); out[name] = "OK"; } catch (e) { out[name] = e.code || String(e); } };
attempt("write-source", () => fs.writeFileSync(path.join(root, "src", "main.js"), "pwned"));
attempt("append-source", () => fs.appendFileSync(path.join(root, "README.md"), "pwned"));
attempt("create-new-file", () => fs.writeFileSync(path.join(root, "new-file.txt"), "x"));
attempt("create-dir", () => fs.mkdirSync(path.join(root, "newdir")));
attempt("git-new-file", () => fs.writeFileSync(path.join(root, ".git", "kairo-canary"), "x"));
attempt("git-head-modify", () => fs.appendFileSync(path.join(root, ".git", "HEAD"), "x"));
attempt("git-object-dir", () => fs.mkdirSync(path.join(root, ".git", "objects", "zz")));
attempt("rename-source", () => fs.renameSync(path.join(root, "README.md"), path.join(root, "README.old")));
attempt("delete-source", () => fs.unlinkSync(path.join(root, "src", "main.js")));
attempt("read-source", () => fs.readFileSync(path.join(root, "README.md")));
console.log(JSON.stringify(out));
`;

export const EXPECTED_DENIED = Object.freeze([
  "write-source", "append-source", "create-new-file", "create-dir",
  "git-new-file", "git-head-modify", "git-object-dir", "rename-source", "delete-source"
]);

export function parseProbe(stdout) {
  const line = String(stdout).trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}
