#!/usr/bin/env node

import { basename } from "node:path";
import { runCli } from "../src/cli.js";

const cliName = basename(process.argv[1] ?? "kairo-runtime");

runCli(process.argv.slice(2)).catch((error) => {
  console.error(`${cliName}: ${error.message}`);
  process.exitCode = 1;
});
