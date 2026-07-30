import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS, statusColor } from "../theme.js";

export function CockpitBadge({ label, kind = "ready", colorEnabled = true }) {
  return React.createElement(Text, {
    color: statusColor(kind, { colorEnabled })
  }, label);
}

export function CockpitEmptyState({ title, message, hint }) {
  return React.createElement(Box, { flexDirection: "column", marginY: 1 },
    title && React.createElement(Text, { bold: true, color: COCKPIT_COLORS.secondary }, title),
    message && React.createElement(Text, null, message),
    hint && React.createElement(Text, { color: COCKPIT_COLORS.muted }, hint)
  );
}

export function CockpitPanel({ title, focused = false, width, children }) {
  return React.createElement(Box, {
    flexDirection: "column",
    width,
    borderStyle: "single",
    borderColor: focused ? COCKPIT_COLORS.primary : COCKPIT_COLORS.muted,
    paddingX: 1,
    flexGrow: 1
  },
    title && React.createElement(Text, {
      bold: true,
      color: focused ? COCKPIT_COLORS.primary : COCKPIT_COLORS.secondary
    }, title),
    children
  );
}

export function CockpitSection({ title, children }) {
  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    title && React.createElement(Text, {
      bold: true,
      color: COCKPIT_COLORS.secondary
    }, title),
    children
  );
}

export function CockpitKeyHint({ keys, label, colorEnabled = true }) {
  return React.createElement(Text, {
    color: colorEnabled ? COCKPIT_COLORS.muted : undefined
  }, `${keys} ${label}`);
}

export function CockpitTopBar({ model, colorEnabled = true }) {
  return React.createElement(Box, { justifyContent: "space-between", width: "100%" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, `╭─ ${model.brand} ─ ${model.status}`),
    React.createElement(Text, {
      color: colorEnabled ? COCKPIT_COLORS.muted : undefined
    }, `${model.projectLabel} ─╮`)
  );
}

/** Vertical nav list (legacy / tests). Prefer CockpitNavStrip in the shell. */
export function CockpitNav({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    model.items.map((item) => {
      const suffix = item.current && !item.selected ? " (open)" : "";
      const color = item.focused
        ? (colorEnabled ? COCKPIT_COLORS.primary : undefined)
        : item.selected
          ? (colorEnabled ? COCKPIT_COLORS.secondary : undefined)
          : item.current
            ? (colorEnabled ? COCKPIT_COLORS.muted : undefined)
            : undefined;
      return React.createElement(Text, {
        key: item.id,
        bold: item.focused || item.selected,
        color
      }, `${item.marker} ${item.label}${suffix}`);
    }),
    model.explanation && React.createElement(Text, {
      color: COCKPIT_COLORS.muted
    }, model.explanation)
  );
}

function stripLabel(item, { compact }) {
  if (!compact) return item.label;
  return item.label.split(/[&·]/)[0].trim().split(/\s+/)[0];
}

/** Horizontal navigation strip under the top bar. */
export function CockpitNavStrip({
  model,
  colorEnabled = true,
  layoutMode = "compact",
  focused = false
}) {
  const compact = layoutMode !== "wide";
  const parts = model.items.map((item) => {
    const label = stripLabel(item, { compact });
    const suffix = item.current && !item.selected ? "*" : "";
    const color = item.focused
      ? (colorEnabled ? COCKPIT_COLORS.primary : undefined)
      : item.selected
        ? (colorEnabled ? COCKPIT_COLORS.secondary : undefined)
        : item.current
          ? (colorEnabled ? COCKPIT_COLORS.muted : undefined)
          : (colorEnabled ? COCKPIT_COLORS.muted : undefined);
    return React.createElement(Text, {
      key: item.id,
      bold: item.focused || item.selected,
      color
    }, `${item.marker}${label}${suffix}`);
  });

  const joined = [];
  parts.forEach((node, index) => {
    if (index > 0) {
      joined.push(React.createElement(Text, {
        key: `sep-${index}`,
        color: colorEnabled ? COCKPIT_COLORS.muted : undefined
      }, " · "));
    }
    joined.push(node);
  });

  return React.createElement(Box, {
    flexDirection: "column",
    width: "100%",
    borderStyle: "single",
    borderColor: focused ? COCKPIT_COLORS.primary : COCKPIT_COLORS.muted,
    paddingX: 1
  },
    React.createElement(Box, { flexDirection: "row", flexWrap: "wrap" }, ...joined),
    model.explanation && React.createElement(Text, {
      color: COCKPIT_COLORS.muted
    }, model.explanation)
  );
}

/** Kept for model tests; no longer rendered in the shell. */
export function CockpitSystemStrip({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    model.rows.map((row) =>
      React.createElement(Text, { key: row.key },
        React.createElement(Text, { color: COCKPIT_COLORS.muted }, `${row.key.padEnd(7)}`),
        React.createElement(CockpitBadge, {
          label: row.value,
          kind: row.kind,
          colorEnabled
        })
      )
    )
  );
}

export function CockpitFooter({ model, columns = 80 }) {
  const width = Math.max(24, Math.min(Number(columns) || 80, 120));
  const bar = Math.max(20, width - 2);
  return React.createElement(Box, { flexDirection: "column", width: "100%" },
    React.createElement(Text, { color: COCKPIT_COLORS.muted },
      `├${"─".repeat(bar)}┤`
    ),
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, `│ ${model.text}`),
    React.createElement(Text, { color: COCKPIT_COLORS.muted },
      `╰${"─".repeat(bar)}╯`
    )
  );
}

/**
 * Responsive single-panel shell: TopBar → NavStrip → Main → Footer.
 * SYSTEM side column removed (diagnostics via Enter/detail in later slices).
 */
export function CockpitShell({
  topBar,
  footer,
  layoutMode,
  nav,
  navFocused,
  contentFocused,
  colorEnabled = true,
  columns = 80,
  children
}) {
  return React.createElement(Box, { flexDirection: "column", width: "100%" },
    React.createElement(CockpitTopBar, { model: topBar, colorEnabled }),
    nav && React.createElement(CockpitNavStrip, {
      model: nav,
      colorEnabled,
      layoutMode,
      focused: navFocused
    }),
    React.createElement(CockpitPanel, {
      title: undefined,
      focused: contentFocused,
      width: "100%"
    }, children),
    React.createElement(CockpitFooter, { model: footer, columns })
  );
}
