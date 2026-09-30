import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeProjectTeam,
  approveProjectTeam,
  buildAnalystPickerNotice,
  buildAnalystExclusionCauses,
  curateAnalystCatalogForPicker,
  MIN_RECOMMENDATION_CONFIDENCE,
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
    accessVerified: true,
    fit: 0.5,
    confidence: 0.7,
    evidence: { reasoning: 0.7, coding: 0.6, coverage: 1 },
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
  calls = [],
  verifyAnalystAccess = undefined
} = {}) {
  return () => ({
    ...(verifyAnalystAccess
      ? {
          async verifyAnalystAccess(args) {
            calls.push(["verifyAnalystAccess", args]);
            if (verifyAnalystAccess instanceof Error) throw verifyAnalystAccess;
            return verifyAnalystAccess;
          }
        }
      : {}),
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

test("pickDefaultAnalyst returns null (no blind first-available fallback) when the recommendation is unavailable", () => {
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
  assert.equal(analyst, null);
});

test("pickDefaultAnalyst returns null when there is no recommendation, even with available models", () => {
  assert.equal(
    pickDefaultAnalyst({ recommendedModel: null, models: [catalogEntry({ recommendationTags: ["quality"] })] }),
    null
  );
  assert.equal(pickDefaultAnalyst({ models: [catalogEntry()] }), null);
});

test("pickDefaultAnalyst returns null when the recommendation is below the confidence floor", () => {
  const low = MIN_RECOMMENDATION_CONFIDENCE - 0.01;
  assert.equal(
    pickDefaultAnalyst({
      recommendedModel: { candidateKey: "codex::gpt-5" },
      models: [catalogEntry({ confidence: low })]
    }),
    null
  );
  assert.equal(
    pickDefaultAnalyst({
      recommendedModel: { candidateKey: "codex::gpt-5", confidence: low },
      models: [catalogEntry({ confidence: undefined })]
    }),
    null
  );
});

test("pickDefaultAnalyst still picks an explicit recommendation at or above the confidence floor", () => {
  const analyst = pickDefaultAnalyst({
    recommendedModel: { candidateKey: "codex::gpt-5" },
    models: [catalogEntry({ confidence: MIN_RECOMMENDATION_CONFIDENCE, recommendationTags: ["quality"] })]
  });
  assert.equal(analyst?.model.modelId, "gpt-5");
  assert.equal(analyst?.selectionSource, "recommended");
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
      analystCatalog: { recommendedModel: { candidateKey: "codex::gpt-5" }, models: [catalogEntry()] },
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

test("analyzeProjectTeam returns analyst_selection_required without calling the analyzer when nothing qualifies", async () => {
  for (const analystCatalog of [
    { recommendedModel: null, models: [catalogEntry()] },
    {
      recommendedModel: { candidateKey: "codex::gpt-5" },
      models: [catalogEntry({ confidence: MIN_RECOMMENDATION_CONFIDENCE - 0.1 })]
    }
  ]) {
    const calls = [];
    const result = await analyzeProjectTeam({
      cwd: "/project",
      createConversationService: fakeService({ analystCatalog, calls })
    });
    assert.equal(result.status, "analyst_selection_required");
    assert.match(result.message, /open the analyst picker/i);
    assert.equal(result.state, undefined, "no strategy summary is invented");
    assert.deepEqual(
      calls.map(([name]) => name),
      ["preflightProject"],
      "analyzer (runBootstrapAnalysis) must not be called and no strategy is mutated"
    );
  }
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
        analystCatalog: { recommendedModel: { candidateKey: "codex::gpt-5" }, models: [catalogEntry()] },
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
  assert.deepEqual(result.analystCatalog.recommendedModel, catalog.recommendedModel);
  assert.deepEqual(result.analystCatalog.models.map((m) => m.candidateKey), ["codex::gpt-5"]);
  assert.deepEqual(result.analystCatalog.alternatives, []);
  assert.equal(result.projectRoot, "/project");
  assert.equal(result.profile, null, "catalog mode skips project profile until analyze");
  assert.deepEqual(result.candidates, { scoredAll: [], eligibility: {} });
});

test("curateAnalystCatalogForPicker ranks by numeric fit, not tags or brand; keeps same-name rows by candidateKey; unscored go to manual alternatives", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "codex::astra", confidence: 0.8 },
    models: [
      catalogEntry({ candidateKey: "cursor::opus-1", adapterId: "cursor", modelId: "opus-high", displayName: "Claude Opus 5.5", fit: 0.5, confidence: 0.7 }),
      catalogEntry({ candidateKey: "cursor::opus-2", adapterId: "cursor", modelId: "opus-max", displayName: "Claude Opus 5.5", fit: 0.4, confidence: 0.7 }),
      catalogEntry({ candidateKey: "cursor::unscored", adapterId: "cursor", modelId: "mystery", displayName: "Mystery", evidenceStatus: "unscored", fit: null, confidence: 0.25, evidence: { reasoning: null, coding: null, coverage: null } }),
      catalogEntry({ candidateKey: "codex::astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6-Astra", recommendationTags: ["quality"], fit: 0.6, confidence: 0.8 }),
      catalogEntry({ candidateKey: "codex::blocked", adapterId: "codex", modelId: "old", displayName: "Old Codex", fit: 0.9, confidence: 0.9, available: false })
    ]
  });
  assert.deepEqual(curated.models.map((m) => m.displayName), ["GPT-6-Astra", "Claude Opus 5.5", "Claude Opus 5.5"]);
  assert.deepEqual(curated.models.map((m) => m.candidateKey), ["codex::astra", "cursor::opus-1", "cursor::opus-2"]);
  assert.deepEqual(curated.alternatives.map((m) => m.displayName), ["Mystery"]);
  assert.equal(curated.recommendedModel.candidateKey, "codex::astra");
});

test("curateAnalystCatalogForPicker orders a tagged low-fit model below a higher-fit untagged one (tags are not the primary key)", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      catalogEntry({ candidateKey: "codex::tagged", modelId: "tagged", displayName: "Tagged", recommendationTags: ["quality", "efficient"], fit: 0.2, confidence: 0.6 }),
      catalogEntry({ candidateKey: "codex::plain", modelId: "plain", displayName: "Plain", fit: 0.7, confidence: 0.6 })
    ]
  });
  assert.deepEqual(curated.models.map((m) => m.displayName), ["Plain", "Tagged"]);
});

test("curateAnalystCatalogForPicker breaks fit ties by confidence, then by name", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      catalogEntry({ candidateKey: "a::b", modelId: "b", displayName: "Bravo", fit: 0.5, confidence: 0.5 }),
      catalogEntry({ candidateKey: "a::a", modelId: "a", displayName: "Alpha", fit: 0.5, confidence: 0.5 }),
      catalogEntry({ candidateKey: "a::c", modelId: "c", displayName: "Charlie", fit: 0.5, confidence: 0.9 })
    ]
  });
  assert.deepEqual(curated.models.map((m) => m.displayName), ["Charlie", "Alpha", "Bravo"]);
});

test("curateAnalystCatalogForPicker puts available unscored models (unknown fit) in the manual view, uncapped", () => {
  const models = Array.from({ length: 20 }, (_, i) => catalogEntry({
    candidateKey: `x::m${i}`, modelId: `m${i}`, displayName: `Model ${String(i).padStart(2, "0")}`,
    evidenceStatus: "unscored", fit: null, confidence: 0.25, evidence: { reasoning: null, coding: null, coverage: null }
  }));
  models.push(catalogEntry({ candidateKey: "x::scored", modelId: "scored", displayName: "Scored", fit: 0.3, confidence: 0.6 }));
  const curated = curateAnalystCatalogForPicker({ recommendedModel: null, models });
  assert.deepEqual(curated.models.map((m) => m.displayName), ["Scored"]);
  assert.equal(curated.alternatives.length, 20, "no cap");
  assert.ok(curated.alternatives.every((m) => m.evidenceStatus === "unscored"));
});

test("curateAnalystCatalogForPicker drops the recommended star when its confidence is insufficient; the row stays selectable in the manual view", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "codex::thin" },
    models: [catalogEntry({ candidateKey: "codex::thin", modelId: "thin", displayName: "Thin", recommendationTags: ["quality"], fit: 0.1, confidence: 0.4 })]
  });
  assert.equal(curated.models.length, 0, "confidence below the floor does not qualify for the main view");
  assert.equal(curated.alternatives.length, 1);
  assert.equal(curated.recommendedModel, null);
});

test("curateAnalystCatalogForPicker ranks eligible Claude above Codex by fit, not brand", () => {
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
        fit: 0.3, confidence: 0.6,
        available: true
      }),
      catalogEntry({
        candidateKey: "claude::opus",
        adapterId: "claude",
        modelId: "opus",
        displayName: "Claude Opus",
        evidenceStatus: "scored",
        recommendationTags: ["quality"],
        fit: 0.6, confidence: 0.7,
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
  assert.equal(curated.models.length, 3, "candidateKey identity: both Opus variants stay");
  assert.deepEqual(
    curated.models.map((m) => m.displayName).sort(),
    ["Claude Opus 5.5", "Claude Opus 5.5", "GPT-5.6 Terra"]
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
  assert.equal(curated.models.length, 2, "an available unscored model is selectable, so Claude is present");
  const notice = buildAnalystPickerNotice(raw, curated, null);
  assert.equal(notice, null);
  const absent = buildAnalystPickerNotice({ models: [], exclusions: [{ adapterId: "claude", modelId: "x", cause: "access_unknown" }] }, { models: [] }, null);
  assert.ok(!/funds|crédito|billing|quota/i.test(absent));
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
  assert.deepEqual(result.analystCatalog, { recommendedModel: null, models: [], alternatives: [] });
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
            evidenceStatus: "scored",
            available: false,
            cause: "quota_exhausted"
          })
        ]
      }
    })
  });
  assert.equal(result.pickerNotice, "Claude: cuota agotada");
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
      catalogEntry({ candidateKey: "cursor::u", adapterId: "cursor", modelId: "u", displayName: "U", evidenceStatus: "unscored", available: true, cause: "unscored" })
    ],
    exclusions: [{ candidateKey: "claude::c", adapterId: "claude", modelId: "c", cause: "access_unknown", reason: "Access has not been verified" }]
  };
  const causes = buildAnalystExclusionCauses(raw, curateAnalystCatalogForPicker(raw), null);
  assert.deepEqual(causes, [
    { adapterId: "claude", provider: "Claude", cause: "quota_exhausted", models: 1, reason: null },
    { adapterId: "claude", provider: "Claude", cause: "access_unknown", models: 1, reason: "Access has not been verified" }
  ]);
  assert.ok(!causes.some((row) => row.adapterId === "cursor"), "an available unscored model is selectable, so it is no exclusion");
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

// ---- T20: unverified-access models are selectable, never automatic, revalidated on selection ----

function unverifiedEntry(overrides = {}) {
  return catalogEntry({
    candidateKey: "claude::opus-unv",
    adapterId: "claude",
    modelId: "opus-unv",
    displayName: "Claude Opus Unverified",
    entitlement: "unverified",
    available: false,
    selectable: true,
    accessVerified: false,
    cause: "access_unknown",
    fit: 0.9,
    confidence: 0.9,
    recommendationTags: [],
    ...overrides
  });
}

test("T20 curate: unverified-access rows are kept but ranked after every verified row, sorted by fit within their own group", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      unverifiedEntry({ candidateKey: "claude::unv-low", modelId: "unv-low", displayName: "Unv Low", fit: 0.2 }),
      catalogEntry({ candidateKey: "codex::weak", modelId: "weak", displayName: "Weak Verified", fit: 0.1, confidence: 0.5 }),
      unverifiedEntry({ candidateKey: "claude::unv-high", modelId: "unv-high", displayName: "Unv High", fit: 0.95 }),
      catalogEntry({ candidateKey: "codex::strong", modelId: "strong", displayName: "Strong Verified", fit: 0.5, confidence: 0.6 })
    ]
  });
  assert.deepEqual(curated.models.map((m) => m.displayName), ["Strong Verified", "Weak Verified"]);
  assert.deepEqual(curated.alternatives.map((m) => m.displayName), ["Unv High", "Unv Low"], "unverified access lives in the manual view only");
  assert.equal(curated.alternatives[0].accessVerified, false);
});

test("T20 curate: a non-selectable, non-available row is still dropped; same display name keeps both rows; no cap", () => {
  const dropped = curateAnalystCatalogForPicker({
    models: [unverifiedEntry({ selectable: false, cause: "quota_exhausted" })]
  });
  assert.equal(dropped.models.length + dropped.alternatives.length, 0);
  const deduped = curateAnalystCatalogForPicker({
    models: [unverifiedEntry({ displayName: "Same Name", fit: 0.99 }), catalogEntry({ displayName: "Same Name", fit: 0.1 })]
  });
  assert.equal(deduped.models.length + deduped.alternatives.length, 2, "no display-name dedupe: identity is candidateKey");
  const many = curateAnalystCatalogForPicker({
    models: Array.from({ length: 30 }, (_, i) => unverifiedEntry({ candidateKey: `claude::m${i}`, modelId: `m${i}`, displayName: `M${i}` }))
  });
  assert.equal(many.alternatives.length, 30);
});

test("T20 curate: the star never lands on an unverified-access row, even if the catalog points at it", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "claude::opus-unv" },
    models: [unverifiedEntry({ recommendationTags: ["quality"] }), catalogEntry()]
  });
  assert.equal(curated.recommendedModel, null);
  assert.equal(curated.models.length, 1);
  assert.equal(curated.alternatives.length, 1);
});

test("T20 pickDefaultAnalyst: never returns an unverified-access model, even recommended, tagged, selectable and 'available'", () => {
  for (const extra of [{}, { available: true }, { recommendationTags: ["quality"], available: true }]) {
    assert.equal(
      pickDefaultAnalyst({
        recommendedModel: { candidateKey: "claude::opus-unv", recommendationTags: ["quality"] },
        models: [unverifiedEntry(extra)]
      }),
      null
    );
  }
});

test("T20 causes: a selectable unverified-access row is no longer an exclusion; a provider with zero selectable rows keeps its notice", () => {
  const raw = {
    models: [unverifiedEntry(), catalogEntry()],
    exclusions: [{ candidateKey: "cursor::x", adapterId: "cursor", modelId: "x", cause: "access_unknown", reason: null }]
  };
  const curated = curateAnalystCatalogForPicker(raw);
  assert.ok(curated.alternatives.some((m) => m.adapterId === "claude"));
  const causes = buildAnalystExclusionCauses(raw, curated, "1 Claude models are unverified");
  assert.deepEqual(causes.map((c) => c.adapterId), ["cursor"], "claude is selectable now; only the provider with zero rows is listed");
  assert.equal(buildAnalystPickerNotice(raw, curated, "1 Claude models are unverified"), "Cursor: acceso sin verificar");
});

const UNVERIFIED_CATALOG = {
  recommendedModel: { candidateKey: "codex::gpt-5" },
  models: [catalogEntry({ recommendationTags: ["quality"] }), unverifiedEntry()]
};
const PICK_UNVERIFIED = {
  model: { adapterId: "claude", modelId: "opus-unv", displayName: "stale" },
  selectionSource: "manual",
  recommendationTags: [],
  choice: null,
  accessCheckConfirmed: true
};

test("T20 analyze: confirming an unverified-access analyst runs the on-demand access check BEFORE the provider analysis, then proceeds when it passes", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/project",
    analyst: PICK_UNVERIFIED,
    createConversationService: fakeService({
      analystCatalog: UNVERIFIED_CATALOG, calls, verifyAnalystAccess: { status: "allowed", reason: null }
    })
  });
  assert.deepEqual(calls.map(([name]) => name), ["preflightProject", "verifyAnalystAccess", "runBootstrapAnalysis"]);
  assert.deepEqual(calls[1][1], { cwd: "/project", model: { adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified" } });
  const analyst = calls[2][1].analyst;
  assert.equal(analyst.model.modelId, "opus-unv");
  assert.equal(analyst.selectionSource, "manual");
  assert.deepEqual(Object.keys(analyst).sort(), ["choice", "model", "recommendationTags", "selectionSource"], "no catalog-only fields leak into the persisted analyst");
  assert.equal(result.state, "suggested");
});

test("T20 analyze: a failed, denied or undecidable access check returns an honest analyst_access_unverified result with no analysis, no strategy write and no substitution", async () => {
  const cases = [
    { verify: { status: "unverified", reason: "claude entitlement probe timed out after 30000ms" }, accessStatus: "unverified", reason: /timed out/ },
    { verify: { status: "denied", reason: "credits_required" }, accessStatus: "denied", reason: /credits_required/ },
    { verify: new Error("spawn EACCES"), accessStatus: "unverified", reason: /EACCES/ },
    { verify: undefined, accessStatus: "unverified", reason: /no on-demand access check/i }
  ];
  for (const { verify, accessStatus, reason } of cases) {
    const calls = [];
    const result = await analyzeProjectTeam({
      cwd: "/project",
      analyst: PICK_UNVERIFIED,
      createConversationService: fakeService({ analystCatalog: UNVERIFIED_CATALOG, calls, verifyAnalystAccess: verify })
    });
    assert.equal(result.status, "analyst_access_unverified");
    assert.equal(result.accessStatus, accessStatus);
    assert.match(result.reason, reason);
    assert.match(result.message, reason);
    assert.deepEqual(result.analyst, { adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified" });
    assert.ok(!/quota|funds|credits? (?:exhausted|run out)/i.test(result.message.replace(/credits_required/g, "")), "never claims missing quota");
    assert.ok(!calls.some(([name]) => name === "runBootstrapAnalysis"), "no provider analysis, no strategy mutation");
    assert.ok(!calls.some(([name]) => name === "approveProjectStrategy"));
    assert.equal(result.state, undefined);
  }
});

test("T20 analyze: a verified analyst is not re-checked, and an unverified one on an ineligible provider stays refused", async () => {
  const calls = [];
  await analyzeProjectTeam({
    cwd: "/project",
    analyst: { model: { adapterId: "codex", modelId: "gpt-5" } },
    createConversationService: fakeService({ analystCatalog: UNVERIFIED_CATALOG, calls, verifyAnalystAccess: { status: "allowed" } })
  });
  assert.ok(!calls.some(([name]) => name === "verifyAnalystAccess"));
  await assert.rejects(
    analyzeProjectTeam({
      cwd: "/project",
      analyst: PICK_UNVERIFIED,
      createConversationService: fakeService({
        analystCatalog: { models: [unverifiedEntry({ selectable: false, cause: "quota_exhausted" })] },
        verifyAnalystAccess: { status: "allowed" }
      })
    }),
    /not an available analyst/i
  );
});

test("T20 analyze: with no analyst requested, an unverified-access model is never chosen by default", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/project",
    createConversationService: fakeService({
      analystCatalog: { recommendedModel: { candidateKey: "claude::opus-unv" }, models: [unverifiedEntry({ recommendationTags: ["quality"] })] },
      calls,
      verifyAnalystAccess: { status: "allowed" }
    })
  });
  assert.equal(result.status, "analyst_selection_required");
  assert.deepEqual(calls.map(([name]) => name), ["preflightProject"]);
});
