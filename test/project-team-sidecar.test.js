import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeProjectTeam,
  approveProjectTeam,
  pickDefaultAnalyst,
  summarizeProjectStrategy
} from "../src/global/host/project-team-sidecar.js";

function catalogEntry(overrides = {}) {
  return {
    candidateKey: "codex::gpt-5",
    adapterId: "codex",
    modelId: "gpt-5",
    displayName: "GPT-5",
    evidenceStatus: "scored",
    entitlement: null,
    entitlementReason: null,
    available: true,
    recommendationTags: [],
    ...overrides
  };
}

function suggestedStrategy(overrides = {}) {
  return {
    status: "suggested",
    projectRoot: "/project",
    bootstrapAnalyst: {
      model: { adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5" },
      selectionSource: "recommended"
    },
    orchestrator: { adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5" },
    activeRoles: ["Architect", "Builder"],
    projectTeam: [
      { role: "Architect", model: { adapterId: "codex", modelId: "gpt-5" } },
      { role: "Builder", model: { adapterId: "claude", modelId: "sonnet" } }
    ],
    ...overrides
  };
}

/**
 * @param {object} [options]
 */
function fakeService({
  analystCatalog,
  analysisResult = suggestedStrategy(),
  approveResult = { ...suggestedStrategy(), status: "active" },
  unverifiedClaudeNotice = null,
  calls = []
} = {}) {
  return () => ({
    async preflightProject({ cwd }) {
      calls.push(["preflightProject", cwd]);
      return {
        profile: { root: cwd, roleRequirements: [{ role: "Architect" }] },
        candidates: { scoredAll: [], eligibility: {} },
        analystCatalog,
        projectRoot: cwd,
        unverifiedClaudeNotice
      };
    },
    async runBootstrapAnalysis(args) {
      calls.push(["runBootstrapAnalysis", args]);
      if (analysisResult instanceof Error) throw analysisResult;
      return analysisResult;
    },
    async approveProjectStrategy({ cwd }) {
      calls.push(["approveProjectStrategy", cwd]);
      if (approveResult instanceof Error) throw approveResult;
      return approveResult;
    }
  });
}

test("pickDefaultAnalyst takes the catalog's own recommended model", () => {
  const analyst = pickDefaultAnalyst({
    recommendedModel: { candidateKey: "claude::sonnet" },
    models: [
      catalogEntry(),
      catalogEntry({
        candidateKey: "claude::sonnet",
        adapterId: "claude",
        modelId: "sonnet",
        displayName: "Sonnet",
        recommendationTags: ["quality"]
      })
    ]
  });
  assert.deepEqual(analyst.model, {
    adapterId: "claude",
    modelId: "sonnet",
    displayName: "Sonnet"
  });
  assert.equal(analyst.selectionSource, "recommended");
  assert.equal(analyst.choice, "quality");
  assert.deepEqual(analyst.recommendationTags, ["quality"]);
});

test("pickDefaultAnalyst skips an unavailable recommendation for the first available entry", () => {
  const analyst = pickDefaultAnalyst({
    recommendedModel: { candidateKey: "claude::sonnet" },
    models: [
      catalogEntry({
        candidateKey: "claude::sonnet",
        adapterId: "claude",
        modelId: "sonnet",
        available: false,
        recommendationTags: ["quality"]
      }),
      catalogEntry({ recommendationTags: ["efficient"] })
    ]
  });
  assert.equal(analyst.model.adapterId, "codex");
  assert.equal(analyst.selectionSource, "manual");
  assert.equal(analyst.choice, "efficient");
});

test("pickDefaultAnalyst returns null instead of inventing a model", () => {
  assert.equal(pickDefaultAnalyst({ models: [] }), null);
  assert.equal(pickDefaultAnalyst(null), null);
  assert.equal(
    pickDefaultAnalyst({ models: [catalogEntry({ available: false })] }),
    null
  );
});

test("summarizeProjectStrategy reports state, team rows and the analyst used", () => {
  const summary = summarizeProjectStrategy(suggestedStrategy());
  assert.equal(summary.state, "suggested");
  assert.equal(summary.teamRows, 2);
  assert.deepEqual(summary.roles, ["Architect", "Builder"]);
  assert.equal(summary.analyst, "codex · GPT-5");
  assert.equal(summary.projectRoot, "/project");
});

test("analyzeProjectTeam runs preflight then analysis with the default analyst", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({
      analystCatalog: {
        recommendedModel: { candidateKey: "codex::gpt-5" },
        models: [catalogEntry({ recommendationTags: ["quality"] })]
      },
      calls
    })
  });
  assert.deepEqual(calls[0], ["preflightProject", "/project"]);
  const [, analysisArgs] = calls[1];
  assert.equal(analysisArgs.cwd, "/project");
  assert.equal(analysisArgs.analyst.model.modelId, "gpt-5");
  assert.equal(analysisArgs.analyst.selectionSource, "recommended");
  assert.ok(analysisArgs.profile, "analysis must reuse the preflight profile");
  assert.ok(analysisArgs.candidates, "analysis must reuse the preflight candidates");
  assert.equal(result.state, "suggested");
  assert.equal(result.teamRows, 2);
  assert.equal(result.analyst, "codex · GPT-5");
});

test("analyzeProjectTeam surfaces the preflight's unverified Claude notice", async () => {
  const result = await analyzeProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({
      analystCatalog: { recommendedModel: null, models: [catalogEntry()] },
      unverifiedClaudeNotice: "2 Claude models are unverified"
    })
  });
  assert.equal(result.notice, "2 Claude models are unverified");
});

test("analyzeProjectTeam fails closed when no analyst is available", async () => {
  await assert.rejects(
    analyzeProjectTeam({
      cwd: "/project",
      createConversationService: fakeService({
        analystCatalog: { recommendedModel: null, models: [] }
      })
    }),
    /no ask-capable analyst/i
  );
});

test("analyzeProjectTeam fails closed when every catalog entry is unavailable", async () => {
  await assert.rejects(
    analyzeProjectTeam({
      cwd: "/project",
      createConversationService: fakeService({
        analystCatalog: {
          recommendedModel: null,
          models: [catalogEntry({ available: false })]
        }
      })
    }),
    /not available right now/i
  );
});

test("analyzeProjectTeam propagates a real analysis failure verbatim", async () => {
  await assert.rejects(
    analyzeProjectTeam({
      cwd: "/project",
      createConversationService: fakeService({
        analystCatalog: { recommendedModel: null, models: [catalogEntry()] },
        analysisResult: new Error("Bootstrap Analyst did not answer: timeout")
      })
    }),
    /Bootstrap Analyst did not answer: timeout/
  );
});

test("analyzeProjectTeam requires a cwd", async () => {
  await assert.rejects(analyzeProjectTeam({}), /requires a project directory/i);
});

test("approveProjectTeam returns the active strategy summary", async () => {
  const calls = [];
  const result = await approveProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({ analystCatalog: null, calls })
  });
  assert.deepEqual(calls[0], ["approveProjectStrategy", "/project"]);
  assert.equal(result.state, "active");
  assert.equal(result.teamRows, 2);
  assert.deepEqual(result.roles, ["Architect", "Builder"]);
});

test("approveProjectTeam propagates the service's own no-strategy error", async () => {
  await assert.rejects(
    approveProjectTeam({
      cwd: "/project",
      createConversationService: fakeService({
        analystCatalog: null,
        approveResult: new Error("No suggested project strategy yet")
      })
    }),
    /No suggested project strategy yet/
  );
});

test("approveProjectTeam requires a cwd", async () => {
  await assert.rejects(approveProjectTeam({}), /requires a project directory/i);
});
