#!/usr/bin/env node

import { basename } from "node:path";
import { runCli } from "@kal-elsam/kairo-runtime/src/cli.js";

const MIGRATION_WARNING =
  "@kal-elsam/harness has moved to @kal-elsam/kairo-runtime. Prefer: npx @kal-elsam/kairo-runtime\n";

console.error(MIGRATION_WARNING);

const cliName = basename(process.argv[1] ?? "harness");

runCli(process.argv.slice(2)).catch((error) => {
  console.error(`${cliName}: ${error.message}`);
  process.exitCode = 1;
});
