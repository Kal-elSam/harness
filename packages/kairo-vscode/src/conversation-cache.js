"use strict";

const { runKairoJson } = require("./architect-actions");

function emptyConversation(error) {
  return {
    schema: "kairo.conversation/v1",
    timeline: [],
    capabilities: { architecture: false, planDecision: false, automatedImplementation: false },
    error: error ?? "unavailable"
  };
}

async function fetchConversation({ cwd, run = runKairoJson } = {}) {
  if (!cwd) return emptyConversation("workspace_unbound");
  try { return await run(["conversation", "snapshot", "--cwd", cwd], { cwd }); }
  catch (error) { return emptyConversation(error?.message ?? String(error)); }
}

module.exports = { emptyConversation, fetchConversation };
