/**
 * Live semantic Usage panel — renderer only; model lives in cockpit-usage.js.
 * ActionList never owns focus.
 */
import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS } from "../theme.js";
import { LAYOUT_MODES } from "../layout.js";
import { adaptUsageModel } from "../cockpit-usage.js";
import { ActionList, Callout } from "./semantic.js";

export function SemanticUsagePanel({
  snapshot = null,
  dashboard = null,
  layoutMode = LAYOUT_MODES.COMPACT,
  colorEnabled = true,
  unicode = true
}) {
  const model = adaptUsageModel({ snapshot, dashboard, layoutMode });
  const muted = colorEnabled ? COCKPIT_COLORS.muted : undefined;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true, color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, model.title),
    React.createElement(Callout, {
      tone: model.callout.tone,
      title: model.callout.title,
      body: model.callout.body || undefined,
      colorEnabled,
      compact: true
    }),
    React.createElement(Text, { bold: true }, "Measured"),
    React.createElement(Text, null, `  ${model.measured}`),
    React.createElement(Text, { bold: true }, "Configured limits"),
    React.createElement(Text, null, `  ${model.configured}`),
    React.createElement(Text, { bold: true }, "Run usage"),
    model.runs.length === 0
      ? React.createElement(Text, null, "  No auditable run tokenUsage yet.")
      : React.createElement(ActionList, {
        items: model.runs,
        selectedIndex: -1,
        focused: false,
        colorEnabled,
        unicode
      }),
    model.moreLine
      ? React.createElement(Text, { color: muted }, model.moreLine)
      : null,
    React.createElement(Text, { color: muted }, model.footnote)
  );
}
