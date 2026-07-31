import test from "node:test";
import assert from "node:assert/strict";
import { canUseSetupInk } from "../src/global/ink/terminal.js";
import {
  shouldUseClackWizard,
  shouldUseSetupInk
} from "../src/global/ink/setup-routing.js";
import {
  INITIAL_SETUP_STEP,
  SETUP_STEPS,
  formatInkDetectPanel,
  formatInkHeaderLines,
  formatInkPreviewLines,
  formatInkSelectList,
  formatInkSplashLines,
  shouldStartPreviewLoad,
  shouldUseCompactSplashLogo,
  toggleComponentSelection,
  toggleSelection,
  transitionFromSplash
} from "../src/global/ink/setup-state.js";
import { listAdapters } from "../src/global/registry.js";

test("shouldUseSetupInk routes bare TTY setup when ink is capable", () => {
  assert.equal(shouldUseSetupInk({ interactive: true, inkCapable: true }), true);
  assert.equal(shouldUseSetupInk({ interactive: true, simple: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupInk({ interactive: false, inkCapable: true }), false);
  assert.equal(shouldUseSetupInk({ interactive: true, yes: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupInk({ interactive: true, agents: ["cursor"], inkCapable: true }), false);
  assert.equal(shouldUseSetupInk({ interactive: true, json: true, inkCapable: true }), false);
});

test("shouldUseClackWizard routes simple mode and ink fallback", () => {
  assert.equal(shouldUseClackWizard({ interactive: true, inkCapable: true }), false);
  assert.equal(shouldUseClackWizard({ interactive: true, simple: true, inkCapable: true }), true);
  assert.equal(shouldUseClackWizard({ interactive: true, inkCapable: false }), true);
  assert.equal(shouldUseClackWizard({ interactive: true, confirm: true, inkCapable: false }), false);
});

test("canUseSetupInk rejects dumb terminals", () => {
  assert.equal(canUseSetupInk({ interactive: false }), false);
  assert.equal(canUseSetupInk({ interactive: true, term: "dumb" }), false);
  assert.equal(canUseSetupInk({ interactive: true, term: "xterm-256color", columns: 80 }), true);
});

test("formatInkHeaderLines snapshot", () => {
  const lines = formatInkHeaderLines();
  assert.deepEqual(lines[0], "KAIRO RUNTIME");
  assert.match(lines[1], /Local Agent Operating System/);
});

test("formatInkDetectPanel uses human agent labels", () => {
  const panel = formatInkDetectPanel({
    adapters: listAdapters(),
    detected: ["cursor", "codex"]
  });
  assert.match(panel, /Cursor · ready/);
  assert.match(panel, /Claude Code · not detected/);
});

test("formatInkSelectList snapshot", () => {
  const lines = formatInkSelectList({
    options: [
      { id: "cursor", label: "Cursor", hint: "ready" },
      { id: "codex", label: "Codex", hint: "managed later" }
    ],
    selected: ["cursor"],
    activeIndex: 1
  });
  assert.match(lines[0], /\[x\] Cursor/);
  assert.match(lines[1], /› \[ \] Codex/);
});

test("toggle helpers handle component none option", () => {
  assert.deepEqual(toggleSelection(["cursor"], "codex"), ["cursor", "codex"]);
  assert.deepEqual(toggleComponentSelection(["orchestrator"], "__none__"), ["__none__"]);
  assert.deepEqual(toggleComponentSelection(["__none__"], "orchestrator"), ["orchestrator"]);
});

test("formatInkPreviewLines groups plan sections", () => {
  const note = formatInkPreviewLines({
    preview: {
      agents: ["cursor"],
      components: ["orchestrator"],
      preflight: {
        changes: [{ action: "create", target: ".cursor/AGENTS.md" }],
        preserved: []
      }
    },
    componentCatalog: [{ id: "orchestrator", label: "Orchestrator" }]
  });

  assert.match(note.join("\n"), /Managed writes/);
  assert.match(note.join("\n"), /Orchestrator/);
  assert.doesNotMatch(note.join("\n"), /harness:managed/);
});

test("SETUP_STEPS starts with splash", () => {
  assert.equal(SETUP_STEPS.SPLASH, "splash");
  assert.equal(INITIAL_SETUP_STEP, SETUP_STEPS.SPLASH);
});

test("formatInkSplashLines full logo snapshot", () => {
  const lines = formatInkSplashLines({ compact: false });
  assert.match(lines.join("\n"), /██╗  ██╗ █████╗ ██╗██████╗/);
  assert.match(lines.join("\n"), /KAIRO RUNTIME/);
  assert.match(lines.join("\n"), /Local Agent Operating System/);
  assert.match(lines.join("\n"), /Press Enter to continue/);
  assert.doesNotMatch(lines.join("\n"), /Agent Engineering Platform/);
});

test("formatInkSplashLines onboarding includes purpose and safety", () => {
  const text = formatInkSplashLines({ compact: true, onboarding: true }).join("\n");
  assert.match(text, /detects, configures, and coordinates/i);
  assert.match(text, /Diagnosis is read-only/i);
  assert.match(text, /Esc to exit/);
});

test("formatInkSplashLines compact logo snapshot", () => {
  const lines = formatInkSplashLines({ compact: true });
  assert.match(lines.join("\n"), / _  __ ___ _ __/);
  assert.doesNotMatch(lines.join("\n"), /██╗  ██╗ █████╗ ██╗██████╗/);
  assert.match(lines.join("\n"), /KAIRO RUNTIME/);
});

test("shouldUseCompactSplashLogo picks compact layout for narrow terminals", () => {
  assert.equal(shouldUseCompactSplashLogo(80), false);
  assert.equal(shouldUseCompactSplashLogo(35), true);
});

test("transitionFromSplash enter advances to detect", () => {
  const result = transitionFromSplash({ enter: true });
  assert.equal(result.kind, "advance");
  assert.equal(result.step, SETUP_STEPS.DETECT);
});

test("transitionFromSplash escape cancels", () => {
  const result = transitionFromSplash({ escape: true });
  assert.equal(result.kind, "cancel");
});

test("shouldStartPreviewLoad only on preview step without result", () => {
  assert.equal(
    shouldStartPreviewLoad({ step: SETUP_STEPS.PREVIEW, preview: null, previewError: null }),
    true
  );
  assert.equal(
    shouldStartPreviewLoad({ step: SETUP_STEPS.PREVIEW, preview: { agents: [] }, previewError: null }),
    false
  );
  assert.equal(
    shouldStartPreviewLoad({ step: SETUP_STEPS.PREVIEW, preview: null, previewError: "failed" }),
    false
  );
  assert.equal(
    shouldStartPreviewLoad({ step: SETUP_STEPS.AGENTS, preview: null, previewError: null }),
    false
  );
});

test("splash routing skipped for simple, non-TTY, and yes modes", () => {
  assert.equal(shouldUseSetupInk({ interactive: true, simple: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupInk({ interactive: false, inkCapable: true }), false);
  assert.equal(shouldUseSetupInk({ interactive: true, yes: true, inkCapable: true }), false);
});

test("preview window caps by layout with remainder; keys stay unique for blanks", async () => {
  const {
    setupPreviewLineLimit,
    windowSetupLines,
    setupLineKey
  } = await import("../src/global/ink/setup-state.js");
  assert.equal(setupPreviewLineLimit("compact"), 8);
  assert.equal(setupPreviewLineLimit("wide"), 12);
  assert.equal(setupPreviewLineLimit("minimal"), 5);

  const many = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? "" : `line-${i}`));
  const capped = windowSetupLines(many, 8);
  assert.equal(capped.length, 9);
  assert.equal(capped.at(-1), "… 12 more");
  const keys = many.map((line, i) => setupLineKey(i, line));
  assert.equal(new Set(keys).size, keys.length);
});

test("Setup chrome omits color props under colorEnabled=false", async () => {
  const { SetupHeader, SetupSplash } = await import("../src/global/ink/setup-app.js");
  const { CockpitPanel } = await import("../src/global/ink/cockpit/primitives.js");

  function collectColorProps(node, into = []) {
    if (!node || typeof node !== "object") return into;
    if (node.props) {
      if ("color" in node.props) into.push(["color", node.props.color]);
      if ("borderColor" in node.props) into.push(["borderColor", node.props.borderColor]);
      const { children } = node.props;
      if (Array.isArray(children)) children.forEach((child) => collectColorProps(child, into));
      else if (children) collectColorProps(children, into);
    }
    return into;
  }

  const header = SetupHeader({ colorEnabled: false });
  const splash = SetupSplash({ compact: true, colorEnabled: false });
  const panel = CockpitPanel({
    title: "Preview", focused: true, width: "100%", colorEnabled: false, children: null
  });
  for (const node of [header, splash, panel]) {
    for (const [key, value] of collectColorProps(node)) {
      assert.equal(value, undefined, `${key} must be undefined under NO_COLOR`);
    }
  }
});
