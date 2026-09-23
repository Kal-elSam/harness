// Content hashes that identify what a Jev shadow report was produced with.
// Reports store them so a run is never compared with — or simulated under —
// a different local router than the one that produced its `local` tiers.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// classifyEffort/classifyTask and every keyword list live in this one file.
export const ROUTER_PATH = path.resolve(HERE, "../../src/global/intelligence/execution-router.js");

/** @param {string} file */
export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
