import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeProjectTeam,
  approveProjectTeam,
  buildAnalystPickerNotice,
  buildAnalystExclusionCauses,
  curateAnalystCatalogForPicker,
  pickDefaultAnalyst,
  preflightProjectTeam,
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
    async preflightProject({ cwd, mode = "full" } = {}) {
      calls.push(["preflightProject", cwd, mode]);
      return {
        profile: mode === "catalog" ? null : { root: cwd, roleRequirements: [{ role: "Architect" }] },
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
  assert.deepEqual(calls[0], ["preflightProject", "/project", "full"]);
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

test("preflightProjectTeam returns the real analyst catalog without persisting or picking anything", async () => {
  const calls = [];
  const catalog = {
    recommendedModel: { candidateKey: "codex::gpt-5" },
    models: [catalogEntry({ recommendationTags: ["quality"] })]
  };
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({ analystCatalog: catalog, calls })
  });
  assert.deepEqual(calls, [["preflightProject", "/project", "catalog"]], "picker preflight uses catalog mode — never analysis or approval");
  assert.deepEqual(result.analystCatalog, catalog);
  assert.equal(result.projectRoot, "/project");
  assert.equal(result.profile, null, "catalog mode skips project profile until analyze");
  assert.deepEqual(result.candidates, { scoredAll: [], eligibility: {} });
});

test("curateAnalystCatalogForPicker ranks by fit tags, not preferred adapters; dedupes; drops unscored", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "codex::astra" },
    models: [
      catalogEntry({
        candidateKey: "codex::astra",
        adapterId: "codex",
        modelId: "gpt-6-astra",
        displayName: "GPT-6-Astra",
        evidenceStatus: "scored",
        recommendationTags: ["quality"],
        available: true
      }),
      catalogEntry({
        candidateKey: "cursor::opus-1",
        adapterId: "cursor",
        modelId: "opus-high",
        displayName: "Claude Opus 5.5",
        evidenceStatus: "scored",
        available: true
      }),
      catalogEntry({
        candidateKey: "cursor::opus-2",
        adapterId: "cursor",
        modelId: "opus-max",
        displayName: "Claude Opus 5.5",
        evidenceStatus: "scored",
        available: true
      }),
      catalogEntry({
        candidateKey: "cursor::unscored",
        adapterId: "cursor",
        modelId: "mystery",
        displayName: "Mystery",
        evidenceStatus: "unscored",
        available: true
      }),
      catalogEntry({
        candidateKey: "codex::blocked",
        adapterId: "codex",
        modelId: "old",
        displayName: "Old Codex",
        evidenceStatus: "scored",
        available: false
      })
    ]
  });
  assert.equal(curated.models.length, 2);
  assert.equal(curated.models[0].displayName, "GPT-6-Astra");
  assert.equal(curated.models[0].adapterId, "codex");
  assert.equal(curated.models[1].displayName, "Claude Opus 5.5");
  assert.equal(curated.models[1].adapterId, "cursor");
  assert.equal(curated.recommendedModel.candidateKey, "codex::astra");
});

test("curateAnalystCatalogForPicker ranks eligible Claude above Codex by quality tag, not brand", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "claude::opus" },
    models: [
      catalogEntry({
        candidateKey: "codex::gpt",
        adapterId: "codex",
        modelId: "gpt",
        displayName: "GPT",
        evidenceStatus: "scored",
        recommendationTags: [],
        available: true
      }),
      catalogEntry({
        candidateKey: "claude::opus",
        adapterId: "claude",
        modelId: "opus",
        displayName: "Claude Opus",
        evidenceStatus: "scored",
        recommendationTags: ["quality"],
        available: true
      })
    ]
  });
  assert.equal(curated.models[0].adapterId, "claude");
  assert.equal(curated.models[1].adapterId, "codex");
  assert.equal(curated.recommendedModel.candidateKey, "claude::opus");
});

test("curateAnalystCatalogForPicker nulls recommendedModel when it does not survive the filter", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "claude::down", recommendationTags: ["quality"] },
    models: [
      catalogEntry({
        candidateKey: "claude::down",
        adapterId: "claude",
        modelId: "down",
        displayName: "Claude Down",
        evidenceStatus: "scored",
        recommendationTags: ["quality"],
        available: false
      }),
      catalogEntry({
        candidateKey: "codex::gpt",
        adapterId: "codex",
        modelId: "gpt",
        displayName: "GPT",
        evidenceStatus: "scored",
        recommendationTags: [],
        available: true
      })
    ]
  });
  assert.equal(curated.recommendedModel, null);
  assert.equal(curated.models.length, 1);
  assert.equal(curated.models[0].adapterId, "codex");
});

test("curateAnalystCatalogForPicker keeps scored cursor models when no preferred adapter is available", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      catalogEntry({
        candidateKey: "cursor::opus-1",
        adapterId: "cursor",
        modelId: "opus-high",
        displayName: "Claude Opus 5.5",
        evidenceStatus: "scored",
        available: true
      }),
      catalogEntry({
        candidateKey: "cursor::opus-2",
        adapterId: "cursor",
        modelId: "opus-max",
        displayName: "Claude Opus 5.5",
        evidenceStatus: "scored",
        available: true
      }),
      catalogEntry({
        candidateKey: "cursor::terra",
        adapterId: "cursor",
        modelId: "terra",
        displayName: "GPT-5.6 Terra",
        evidenceStatus: "scored",
        available: true
      })
    ]
  });
  assert.equal(curated.models.length, 2);
  assert.deepEqual(
    curated.models.map((m) => m.displayName).sort(),
    ["Claude Opus 5.5", "GPT-5.6 Terra"]
  );
});

test("buildAnalystPickerNotice names providers with zero usable picker rows without inventing funds", () => {
  const raw = {
    recommendedModel: null,
    models: [
      catalogEntry({
        candidateKey: "codex::gpt",
        adapterId: "codex",
        modelId: "gpt",
        displayName: "GPT",
        evidenceStatus: "scored",
        available: true
      }),
      catalogEntry({
        candidateKey: "claude::opus",
        adapterId: "claude",
        modelId: "opus",
        displayName: "Claude Opus",
        evidenceStatus: "unscored",
        available: true
      })
    ]
  };
  const curated = curateAnalystCatalogForPicker(raw);
  assert.equal(curated.models.length, 1);
  assert.equal(curated.models[0].adapterId, "codex");
  const notice = buildAnalystPickerNotice(raw, curated, null);
  assert.equal(notice, "Claude: sin benchmark (solo selección manual)");
  assert.ok(!/funds|crédito|billing|quota/i.test(notice));
});

test("buildAnalystPickerNotice joins multiple absences and uses unverifiedClaudeNotice as a Claude signal", () => {
  const notice = buildAnalystPickerNotice(
    { models: [] },
    { models: [] },
    "2 Claude models are unverified"
  );
  assert.equal(notice, "Claude: acceso sin verificar");
});

test("preflightProjectTeam surfaces the unverified Claude notice, honestly, without picking a fallback model", async () => {
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({
      analystCatalog: { recommendedModel: null, models: [] },
      unverifiedClaudeNotice: "2 Claude models are unverified"
    })
  });
  assert.equal(result.unverifiedClaudeNotice, "2 Claude models are unverified");
  assert.equal(result.pickerNotice, "Claude: acceso sin verificar");
  assert.deepEqual(result.analystCatalog, { recommendedModel: null, models: [] });
});

test("preflightProjectTeam returns pickerNotice when a raw provider is filtered out", async () => {
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({
      analystCatalog: {
        recommendedModel: { candidateKey: "codex::gpt-5" },
        models: [
          catalogEntry({ recommendationTags: ["quality"] }),
          catalogEntry({
            candidateKey: "claude::x",
            adapterId: "claude",
            modelId: "x",
            displayName: "Claude X",
            evidenceStatus: "unscored",
            available: true
          })
        ]
      }
    })
  });
  assert.equal(result.pickerNotice, "Claude: sin benchmark (solo selección manual)");
  assert.equal(result.analystCatalog.models.length, 1);
  assert.equal(result.analystCatalog.models[0].adapterId, "codex");
});

test("preflightProjectTeam requires a cwd", async () => {
  await assert.rejects(preflightProjectTeam({}), /requires a project directory/i);
});

test("analyzeProjectTeam uses a human-picked analyst when its adapterId/modelId matches a currently available catalog entry", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/project",
    analyst: {
      model: { adapterId: "claude", modelId: "sonnet", displayName: "stale label" },
      selectionSource: "manual",
      recommendationTags: [],
      choice: null
    },
    createConversationService: fakeService({
      analystCatalog: {
        recommendedModel: { candidateKey: "codex::gpt-5" },
        models: [
          catalogEntry({ recommendationTags: ["quality"] }),
          catalogEntry({
            candidateKey: "claude::sonnet",
            adapterId: "claude",
            modelId: "sonnet",
            displayName: "Claude Sonnet",
            recommendationTags: ["efficient"]
          })
        ]
      },
      calls
    })
  });
  const [, analysisArgs] = calls[1];
  // Re-validated against the FRESH catalog, not a stale caller-supplied label.
  assert.equal(analysisArgs.analyst.model.displayName, "Claude Sonnet");
  assert.equal(analysisArgs.analyst.model.adapterId, "claude");
  assert.equal(analysisArgs.analyst.selectionSource, "manual");
  assert.equal(analysisArgs.analyst.choice, "efficient");
  assert.equal(result.state, "suggested");
});

test("analyzeProjectTeam fails closed when the requested analyst is not in the fresh catalog at all", async () => {
  await assert.rejects(
    analyzeProjectTeam({
      cwd: "/project",
      analyst: { model: { adapterId: "cursor", modelId: "nope" } },
      createConversationService: fakeService({
        analystCatalog: { recommendedModel: null, models: [catalogEntry()] }
      })
    }),
    /not an available analyst/i
  );
});

test("analyzeProjectTeam fails closed when the requested analyst exists but is no longer available", async () => {
  await assert.rejects(
    analyzeProjectTeam({
      cwd: "/project",
      analyst: { model: { adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5" } },
      createConversationService: fakeService({
        analystCatalog: { recommendedModel: null, models: [catalogEntry({ available: false })] }
      })
    }),
    /GPT-5 is not an available analyst/i
  );
});

test("buildAnalystPickerNotice states the verifiable cause per provider, without calling unscored or unverified access 'unavailable'", () => {
  const raw = {
    recommendedModel: null,
    models: [
      catalogEntry({ candidateKey: "codex::gpt", adapterId: "codex", modelId: "gpt", displayName: "GPT", evidenceStatus: "scored", available: true }),
      catalogEntry({ candidateKey: "claude::opus", adapterId: "claude", modelId: "opus", displayName: "Claude Opus", evidenceStatus: "scored", available: false, cause: "quota_exhausted" }),
      catalogEntry({ candidateKey: "cursor::x", adapterId: "cursor", modelId: "x", displayName: "X", evidenceStatus: "scored", available: false, cause: "unavailable_verified" })
    ],
    exclusions: [
      { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm", cause: "access_unknown", reason: "Access has not been verified" }
    ]
  };
  const curated = curateAnalystCatalogForPicker(raw);
  const notice = buildAnalystPickerNotice(raw, curated, null);
  assert.equal(
    notice,
    "Claude: cuota agotada · Cursor: no disponible para análisis ahora · OpenCode Go: acceso sin verificar"
  );
});

test("buildAnalystExclusionCauses lists one machine-readable row per provider and cause for providers with no usable picker rows", () => {
  const raw = {
    models: [
      catalogEntry({ candidateKey: "codex::gpt", adapterId: "codex", modelId: "gpt", displayName: "GPT", evidenceStatus: "scored", available: true }),
      catalogEntry({ candidateKey: "claude::a", adapterId: "claude", modelId: "a", displayName: "A", evidenceStatus: "scored", available: false, cause: "quota_exhausted" }),
      catalogEntry({ candidateKey: "claude::b", adapterId: "claude", modelId: "b", displayName: "B", evidenceStatus: "unscored", available: true, cause: "unscored" })
    ],
    exclusions: [{ candidateKey: "claude::c", adapterId: "claude", modelId: "c", cause: "access_unknown", reason: "Access has not been verified" }]
  };
  const causes = buildAnalystExclusionCauses(raw, curateAnalystCatalogForPicker(raw), null);
  assert.deepEqual(causes, [
    { adapterId: "claude", provider: "Claude", cause: "quota_exhausted", models: 1, reason: null },
    { adapterId: "claude", provider: "Claude", cause: "access_unknown", models: 1, reason: "Access has not been verified" },
    { adapterId: "claude", provider: "Claude", cause: "unscored", models: 1, reason: null }
  ]);
});

test("preflightProjectTeam adds an additive exclusionCauses field next to the existing fields", async () => {
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({
      analystCatalog: {
        recommendedModel: null,
        models: [catalogEntry({ candidateKey: "claude::x", adapterId: "claude", modelId: "x", displayName: "Claude X", evidenceStatus: "scored", available: false, cause: "quota_exhausted" })]
      }
    })
  });
  assert.equal(result.pickerNotice, "Claude: cuota agotada");
  assert.deepEqual(result.exclusionCauses, [{ adapterId: "claude", provider: "Claude", cause: "quota_exhausted", models: 1, reason: null }]);
  assert.ok("unverifiedClaudeNotice" in result && "projectRoot" in result);
});
