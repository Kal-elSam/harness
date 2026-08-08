import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOpenCodeFleet,
  buildFleetReport,
  formatFleetText
} from "../src/global/observability/fleet-probe.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "opencode-fleet.json");

test("parseOpenCodeFleet reads gentle-orchestrator + sdd minions, hides zen variants", async () => {
  const config = JSON.parse(await readFile(fixturePath, "utf8"));
  const fleet = parseOpenCodeFleet(config);

  assert.equal(fleet.platform, "opencode");
  assert.equal(fleet.orchestrator.id, "gentle-orchestrator");
  assert.equal(fleet.orchestrator.model, "opencode-go/deepseek-v4-pro");
  assert.equal(fleet.orchestrator.modelShort, "deepseek-v4-pro");
  assert.equal(fleet.orchestrator.opaque, false);

  const ids = fleet.minions.map((m) => m.id);
  assert.deepEqual(ids, ["sdd-apply", "sdd-explore", "sdd-verify"]);
  assert.equal(fleet.minions.find((m) => m.id === "sdd-apply").role, "executor");
  assert.equal(fleet.minions.find((m) => m.id === "sdd-explore").modelShort, "qwen3.5-plus");
  assert.ok(!ids.includes("sdd-apply-zen"));
  assert.ok(!ids.includes("build"));
});

test("parseOpenCodeFleet includeVariants keeps zen profiles", async () => {
  const config = JSON.parse(await readFile(fixturePath, "utf8"));
  const fleet = parseOpenCodeFleet(config, { includeVariants: true });
  assert.ok(fleet.minions.some((m) => m.id === "sdd-apply-zen"));
});

test("buildFleetReport always adds cursor opaque when ~/.cursor exists", async () => {
  const report = await buildFleetReport({
    homeDir: "/tmp/kairo-fleet-home",
    includeActivity: false,
    exists: async (path) => path.endsWith("/.cursor") || path.endsWith("opencode.json"),
    read: async () => readFile(fixturePath, "utf8"),
    gentleAvailable: () => true,
    buildCursor: async () => ({
      platform: "cursor",
      orchestrator: { id: "auto", model: null, opaque: true },
      minions: [],
      opaque: true,
      writable: false,
      source: "stub"
    }),
    buildClaude: async () => null,
    buildCodex: async () => null
  });

  assert.equal(report.ok, true);
  assert.equal(report.kind, "declared+activity");
  assert.equal(report.orchestratorAuthority, "gentle-ai");
  assert.ok(report.fleets.some((f) => f.platform === "opencode"));
  const cursor = report.fleets.find((f) => f.platform === "cursor");
  assert.ok(cursor);
  assert.equal(cursor.orchestrator.id, "auto");
  assert.equal(cursor.orchestrator.opaque, true);
  assert.equal(cursor.minions.length, 0);
});

test("formatFleetText includes opaque cursor line", async () => {
  const text = formatFleetText({
    orchestratorAuthority: "gentle-ai",
    note: "Declared config topology — not live token usage.",
    fleets: [
      {
        platform: "opencode",
        orchestrator: { id: "gentle-orchestrator", modelShort: "deepseek-v4-pro", opaque: false },
        minions: [{ id: "sdd-apply", modelShort: "deepseek-v4-pro", role: "executor" }]
      },
      {
        platform: "cursor",
        orchestrator: { id: "auto", opaque: true },
        minions: [],
        note: "IDE-managed"
      }
    ],
    activity: { available: true, activeCount: 0, agents: [] }
  });
  assert.match(text, /opencode · gentle-orchestrator · deepseek-v4-pro/);
  assert.match(text, /1 minions/);
  assert.match(text, /cursor · auto · opaque/);
  assert.match(text, /Working floor · quiet/);
});

test("formatFleetText verbose lists minions", () => {
  const text = formatFleetText({
    fleets: [{
      platform: "opencode",
      orchestrator: { id: "gentle-orchestrator", modelShort: "deepseek-v4-pro", opaque: false },
      minions: [{ id: "sdd-apply", modelShort: "deepseek-v4-pro", role: "executor" }]
    }],
    activity: { available: true, agents: [{ id: "sdd-apply", state: "active", modelShort: "x" }] }
  }, { verbose: true });
  assert.match(text, /sdd-apply · deepseek-v4-pro · executor/);
  assert.match(text, /Working floor · 1 live/);
  assert.match(text, /● sdd-apply/);
});
