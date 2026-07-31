import test from "node:test";
import assert from "node:assert/strict";
import { ActionList, Callout, Details, KeyBar, Stepper } from "../src/global/ink/ux/semantic.js";
import {
  FOCUS, SCREENS, SETUP_STEPS, createTaskFlowState, focusMarkFor, keyHintsFor,
  modelForState, reduceTaskFlow, resolveLayout, resolvePrimaryPresentation
} from "../src/global/ink/ux/task-flow.js";
test("flow + render focus contracts", () => {
  assert.equal(resolveLayout(80, 24), "compact");
  assert.equal(resolveLayout(120, 40), "wide");
  assert.equal(resolveLayout(60, 20), "minimal");
  let s = createTaskFlowState();
  assert.match(modelForState(s).primary.label, /start setup/i);
  assert.equal(focusMarkFor(s, false), ">");
  s = reduceTaskFlow(s, { type: "down" });
  assert.equal(s.focus, FOCUS.LIST);
  assert.equal(focusMarkFor(s, false), " ");
  assert.equal(resolvePrimaryPresentation(modelForState(s), s, false).mark, " ");
  s = reduceTaskFlow(s, { type: "enter" });
  assert.equal(s.screen, SCREENS.OVERVIEW);

  s = reduceTaskFlow(createTaskFlowState(), { type: "enter" });
  assert.equal(s.screen, SCREENS.SETUP);
  s = createTaskFlowState({ screen: SCREENS.SETUP, setupStep: 3 });
  const confirm = resolvePrimaryPresentation(modelForState(s), s, false);
  assert.equal(confirm.mode, "confirm");
  assert.equal(confirm.label, "Confirm (no write)");
  s = reduceTaskFlow(s, { type: "enter" });
  assert.equal(modelForState(s).receipt?.title, "Receipt");
  assert.equal(reduceTaskFlow(s, { type: "enter" }).screen, SCREENS.OVERVIEW);
  assert.equal(reduceTaskFlow(createTaskFlowState({ screen: SCREENS.SETUP }), { type: "escape" }).screen, SCREENS.HOME);

  s = reduceTaskFlow(createTaskFlowState(), { type: "space" });
  assert.equal(s.focus, FOCUS.DETAILS);
  assert.equal(focusMarkFor(s, false), " ");
  assert.match(String(Details({ open: true, focused: true, mark: ">", lines: ["id"] }).props.children[0].props.children), /^> Details/);
  s = reduceTaskFlow(s, { type: "escape" });
  assert.equal(reduceTaskFlow(s, { type: "escape" }).exited, true);
  s = reduceTaskFlow(createTaskFlowState({ screen: SCREENS.OVERVIEW }), { type: "slash" });
  assert.equal(s.screen, SCREENS.HOME);
  assert.equal(reduceTaskFlow(s, { type: "resize", columns: 120, rows: 40 }).layout, "wide");
  assert.ok(keyHintsFor(s).some((h) => h.keys === "Enter"));

  const marks = Stepper({ steps: SETUP_STEPS, currentIndex: 1, unicode: false })
    .props.children.map((c) => String(c.props.children).trim()[0]);
  assert.deepEqual(marks, ["+", "*", "-", "-", "-"]);
  assert.ok(!marks.includes(">") && !marks.includes("x"));
  assert.equal(ActionList({ items: [{ id: "a", label: "One" }], unicode: false }).props.flexDirection, "column");
  assert.equal(Callout({ tone: "warn", title: "Needs attention" }).props.flexDirection, "column");
  assert.equal(KeyBar({ hints: [{ keys: "Esc", label: "Exit" }], columns: 80 }).props.width, 80);
});
