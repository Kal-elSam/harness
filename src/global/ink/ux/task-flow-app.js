import React, { useEffect, useReducer } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { COCKPIT_COLORS, resolveGlyphs } from "../theme.js";
import { resolveTerminalCapabilities } from "../terminal-capabilities.js";
import { ActionList, Callout, Confirm, Details, KeyBar, Receipt, Stepper } from "./semantic.js";
import {
  FOCUS, SCREENS, createTaskFlowState, keyHintsFor, modelForState, reduceTaskFlow, resolvePrimaryPresentation
} from "./task-flow.js";

export function TaskFlowApp({ columns: cols, rows: rowCount, onExit } = {}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(
    reduceTaskFlow,
    createTaskFlowState({ columns: cols ?? stdout?.columns ?? 80, rows: rowCount ?? stdout?.rows ?? 24 })
  );
  const caps = resolveTerminalCapabilities({
    columns: state.columns, rows: state.rows, env: process.env, isTTY: true
  });
  const model = modelForState(state);
  const primary = resolvePrimaryPresentation(model, state, caps.unicode);
  const detailsMark = state.focus === FOCUS.DETAILS ? resolveGlyphs(caps.unicode).focus : " ";
  const accent = caps.color ? COCKPIT_COLORS.primary : undefined;

  useEffect(() => {
    if (!stdout) return undefined;
    const onResize = () => dispatch({ type: "resize", columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on("resize", onResize);
    return () => stdout.off("resize", onResize);
  }, [stdout]);

  useEffect(() => {
    if (!state.exited) return;
    onExit?.({ reason: "escape" });
    exit();
  }, [state.exited, exit, onExit]);

  useInput((input, key) => {
    if (key.upArrow) dispatch({ type: "up" });
    else if (key.downArrow) dispatch({ type: "down" });
    else if (key.return) dispatch({ type: "enter" });
    else if (key.escape) dispatch({ type: "escape" });
    else if (input === " ") dispatch({ type: "space" });
    else if (input === "/") dispatch({ type: "slash" });
  });

  return React.createElement(Box, { flexDirection: "column", width: state.columns },
    React.createElement(Text, { bold: true, color: accent }, `Kairo · ${model.title} · ${state.layout}`),
    React.createElement(Callout, { ...model.callout, colorEnabled: caps.color }),
    state.screen === SCREENS.SETUP
      ? React.createElement(Stepper, {
        steps: model.steps, currentIndex: model.stepIndex, colorEnabled: caps.color, unicode: caps.unicode
      })
      : null,
    primary.mode === "confirm"
      ? React.createElement(Confirm, {
        summary: primary.summary, primaryLabel: primary.label,
        focused: state.focus === FOCUS.PRIMARY, colorEnabled: caps.color, mark: primary.mark
      })
      : React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, {
          bold: state.focus === FOCUS.PRIMARY,
          color: state.focus === FOCUS.PRIMARY ? accent : undefined
        }, `${primary.mark} ${primary.label}`),
        primary.detail
          ? React.createElement(Text, { color: caps.color ? COCKPIT_COLORS.muted : undefined }, primary.detail)
          : null
      ),
    model.receipt ? React.createElement(Receipt, { ...model.receipt, colorEnabled: caps.color }) : null,
    (model.secondary || model.metrics)
      ? React.createElement(ActionList, {
        items: model.secondary ?? model.metrics,
        selectedIndex: state.listIndex,
        focused: state.focus === FOCUS.LIST,
        colorEnabled: caps.color,
        unicode: caps.unicode
      })
      : null,
    React.createElement(Details, {
      open: state.detailsOpen, summary: "Details", lines: model.details,
      colorEnabled: caps.color, focused: state.focus === FOCUS.DETAILS, mark: detailsMark
    }),
    React.createElement(KeyBar, { hints: keyHintsFor(state), colorEnabled: caps.color, columns: state.columns })
  );
}
