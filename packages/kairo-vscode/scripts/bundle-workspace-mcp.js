"use strict";

const { mkdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { dirname, resolve } = require("node:path");

const ESBUILD = "esbuild@0.25.9";
const entry = resolve(__dirname, "../../../src/global/mcp/workspace-mcp-entry.js");
const outfile = resolve(__dirname, "../dist/kairo-workspace.cjs");

mkdirSync(dirname(outfile), { recursive: true });
const result = spawnSync(
  "npx",
  [
    "--yes", ESBUILD, entry,
    "--bundle", "--platform=node", "--format=cjs",
    `--outfile=${outfile}`, "--legal-comments=none", "--log-level=warning"
  ],
  { stdio: "inherit", cwd: resolve(__dirname, "../../..") }
);
process.exit(result.status === 0 ? 0 : 1);
