import claudeCode from "./claude-code.js";
import codex from "./codex.js";
import opencode from "./opencode.js";
import cursor from "./cursor.js";
import gemini from "./gemini.js";
import kimi from "./kimi.js";
import pi from "./pi.js";

const HOSTS = Object.freeze([claudeCode, codex, opencode, cursor, gemini, kimi, pi]);
export const HOST_IDS = Object.freeze(HOSTS.map((host) => host.id));

export function listHosts() { return [...HOSTS]; }

export function getHost(id) {
  const host = HOSTS.find((candidate) => candidate.id === id);
  if (!host) throw new Error(`Unknown host "${id}". Use ${HOST_IDS.join(", ")}, or all.`);
  return host;
}
