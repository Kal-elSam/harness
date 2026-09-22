import { createContextBundle } from "./contracts.js";

const SOURCE_KEYS = [
  ["pi", "pi"],
  ["engram", "engram"],
  ["codegraph", "codegraph"],
  ["gentleAi", "gentle-ai"],
  ["kairo", "kairo"]
];

export function assembleContextBundle({
  pi = null,
  engram = null,
  codegraph = null,
  gentleAi = null,
  kairo = null,
  budgetTokens = 0
} = {}) {
  const inputs = { pi, engram, codegraph, gentleAi, kairo };
  const sources = [];
  for (const [key, owner] of SOURCE_KEYS) {
    const value = inputs[key];
    if (value == null) continue;
    sources.push({ owner, refs: value.refs ?? [] });
  }
  return createContextBundle({ sources, budgetTokens });
}

export function degradeCapabilities({
  engram = true,
  codegraph = true,
  mcp = true,
  gentleAi = true,
  hermes = true
} = {}) {
  return {
    conversation: true,
    routing: true,
    memory: engram === true,
    graph: codegraph === true,
    mcp: mcp === true,
    methodology: gentleAi === true,
    hermes: hermes === true,
    inventsOddSddReview: false
  };
}
