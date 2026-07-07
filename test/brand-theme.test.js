import test from "node:test";
import assert from "node:assert/strict";
import { BRAND, WIZARD_COPY } from "../src/global/brand/index.js";
import {
  brandIntroTitle,
  formatAgentDetectCard,
  formatAgentMultiselectHint,
  formatPreviewNote,
  formatResultNote,
  formatSplashNote
} from "../src/global/clack/theme.js";
import { listAdapters } from "../src/global/registry.js";

test("brand intro title matches premium identity", () => {
  assert.equal(brandIntroTitle(), "HARNESS — Local Agent Operating System");
  assert.equal(WIZARD_COPY.introTitle, brandIntroTitle());
  assert.equal(BRAND.tagline, "Local Agent Operating System");
});

test("formatSplashNote snapshot is compact and on-brand", () => {
  const splash = formatSplashNote();
  assert.match(splash, /Coordinates local AI agents/);
  assert.match(splash, /does not install the apps/);
  assert.match(splash, /Managed sections/);
});

test("formatAgentDetectCard uses human labels and status hints", () => {
  const adapters = listAdapters();
  const card = formatAgentDetectCard({
    adapters,
    detected: ["cursor", "codex"]
  });

  assert.match(card, /Cursor/);
  assert.match(card, /Codex/);
  assert.match(card, /OpenCode/);
  assert.match(card, /Claude Code/);
  assert.match(card, /ready/);
  assert.match(card, /not detected/);
  assert.match(card, /2 of 4 agent roots found/);
});

test("formatAgentMultiselectHint distinguishes ready vs managed later", () => {
  assert.equal(formatAgentMultiselectHint("cursor", ["cursor"]), "ready");
  assert.equal(formatAgentMultiselectHint("claude", ["cursor"]), "managed later");
});

test("formatPreviewNote groups sections without managed marker noise", () => {
  const preview = {
    agents: ["cursor"],
    components: ["orchestrator"],
    preflight: {
      changes: [
        { action: "create", target: ".cursor/AGENTS.md", kind: "config" }
      ],
      preserved: []
    }
  };

  const note = formatPreviewNote({ preview, componentCatalog: [{ id: "orchestrator", label: "Orchestrator" }] });
  assert.match(note, /Agents/);
  assert.match(note, /Components/);
  assert.match(note, /Managed writes/);
  assert.match(note, /Preserved content/);
  assert.match(note, /Cursor/);
  assert.match(note, /Orchestrator/);
  assert.match(note, /\.cursor\/AGENTS\.md/);
  assert.doesNotMatch(note, /harness:managed:start/);
});

test("formatResultNote dry-run recommends confirm command", () => {
  const note = formatResultNote({
    stateRoot: "/tmp/.harness",
    agents: ["cursor"],
    components: ["orchestrator"],
    configsCreated: [".cursor/AGENTS.md"],
    configsUpdated: [],
    backups: []
  }, { dryRun: true });

  assert.match(note, /harness setup --confirm/);
  assert.match(note, /Cursor/);
  assert.match(note, /Next steps/);
});
