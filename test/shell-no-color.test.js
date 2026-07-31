import test from "node:test";
import assert from "node:assert/strict";
import {
  CockpitBadge,
  CockpitFooter,
  CockpitNavStrip,
  CockpitPanel,
  CockpitShell,
  CockpitTopBar
} from "../src/global/ink/cockpit/primitives.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { hasColorSgr, resolveInkColor } from "../src/global/ink/theme.js";

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

const navModel = {
  explanation: "demo",
  items: [{
    id: "overview",
    label: "Overview",
    marker: ">",
    selected: true,
    current: true,
    focused: true
  }]
};

test("hasColorSgr detects color SGR but allows bold/dim/reset", () => {
  assert.equal(hasColorSgr("plain"), false);
  assert.equal(hasColorSgr("\u001b[1mbold\u001b[0m"), false);
  assert.equal(hasColorSgr("\u001b[2mdim\u001b[0m"), false);
  assert.equal(hasColorSgr("\u001b[36mcyan\u001b[0m"), true);
  assert.equal(hasColorSgr("\u001b[91mbright\u001b[0m"), true);
  assert.equal(hasColorSgr("\u001b[38;5;12m256\u001b[0m"), true);
  assert.equal(hasColorSgr("\u001b[1;36mbold-cyan\u001b[0m"), true);
  assert.equal(resolveInkColor(false, "cyan"), undefined);
  assert.equal(resolveInkColor(true, "cyan"), "cyan");
});

test("shell primitives omit color and borderColor when colorEnabled=false", () => {
  const top = CockpitTopBar({
    model: { brand: "KAIRO", status: "ONLINE", projectLabel: "Project: demo" },
    colorEnabled: false
  });
  const strip = CockpitNavStrip({
    model: navModel,
    layoutMode: LAYOUT_MODES.COMPACT,
    focused: true,
    colorEnabled: false
  });
  const panel = CockpitPanel({ focused: true, width: "100%", colorEnabled: false, children: null });
  const footer = CockpitFooter({ model: { text: "↑↓ · Esc" }, columns: 80, colorEnabled: false });
  const badge = CockpitBadge({ label: "Ready", kind: "ready", colorEnabled: false });
  const shell = CockpitShell({
    topBar: { brand: "KAIRO", status: "ONLINE", projectLabel: "Project: demo" },
    footer: { text: "Esc" },
    layoutMode: LAYOUT_MODES.COMPACT,
    nav: navModel,
    navFocused: true,
    contentFocused: true,
    colorEnabled: false,
    columns: 80,
    children: null
  });

  for (const node of [top, strip, panel, footer, badge, shell]) {
    for (const [key, value] of collectColorProps(node)) {
      assert.equal(value, undefined, `${key} must be undefined under NO_COLOR`);
    }
  }
  assert.equal(panel.props.borderStyle, "single");
  assert.equal(strip.props.borderStyle, "single");
});

test("shell primitives keep color props when colorEnabled=true", () => {
  const strip = CockpitNavStrip({
    model: navModel,
    layoutMode: LAYOUT_MODES.COMPACT,
    focused: true,
    colorEnabled: true
  });
  const panel = CockpitPanel({ focused: false, width: "100%", colorEnabled: true, children: null });
  const footer = CockpitFooter({ model: { text: "Esc" }, columns: 80, colorEnabled: true });
  assert.ok(strip.props.borderColor);
  assert.ok(panel.props.borderColor);
  assert.ok(collectColorProps(footer).some(([, value]) => value != null));
});
