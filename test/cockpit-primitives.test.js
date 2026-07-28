import test from "node:test";
import assert from "node:assert/strict";
import {
  CockpitFooter,
  CockpitKeyHint,
  CockpitNavStrip,
  CockpitSection,
  CockpitShell
} from "../src/global/ink/cockpit/primitives.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

test("CockpitFooter scales bar to terminal columns", () => {
  const narrow = CockpitFooter({ model: { text: "↑↓ Navigate" }, columns: 40 });
  const wide = CockpitFooter({ model: { text: "↑↓ Navigate" }, columns: 100 });
  assert.equal(narrow.props.flexDirection, "column");
  assert.equal(wide.props.width, "100%");
  assert.ok(Array.isArray(narrow.props.children));
  assert.ok(Array.isArray(wide.props.children));
});

test("CockpitNavStrip and Section primitives accept models", () => {
  const nav = {
    title: "NAVIGATION",
    explanation: "Coverage and next action.",
    items: [
      {
        id: "overview",
        label: "Control center",
        marker: "›",
        selected: true,
        current: true,
        focused: true
      },
      {
        id: "runs",
        label: "Runs",
        marker: " ",
        selected: false,
        current: false,
        focused: false
      }
    ]
  };
  const strip = CockpitNavStrip({
    model: nav,
    layoutMode: LAYOUT_MODES.COMPACT,
    focused: true
  });
  assert.equal(strip.props.flexDirection, "column");
  const section = CockpitSection({
    title: "NEXT",
    children: CockpitKeyHint({ keys: "Enter", label: "Activate" })
  });
  assert.equal(section.props.flexDirection, "column");
});

test("CockpitShell is single-panel without system props", () => {
  const shell = CockpitShell({
    topBar: { brand: "KAIRO", status: "ONLINE", projectLabel: "Project: demo" },
    footer: { text: "Esc Exit" },
    layoutMode: LAYOUT_MODES.WIDE,
    nav: {
      explanation: "demo",
      items: [{
        id: "overview",
        label: "Control center",
        marker: "›",
        selected: true,
        current: true,
        focused: true
      }]
    },
    navFocused: true,
    contentFocused: false,
    columns: 120,
    children: null
  });
  assert.equal(shell.props.flexDirection, "column");
  assert.equal(shell.props.system, undefined);
  assert.equal(shell.props.children.length, 4);
});
