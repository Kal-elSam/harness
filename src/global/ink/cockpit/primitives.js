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

export function CockpitNav({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    model.items.map((item) =>
      React.createElement(Text, {
        key: item.id,
        bold: item.focused || item.selected,
        color: item.focused
          ? (colorEnabled ? COCKPIT_COLORS.primary : undefined)
          : item.selected
            ? (colorEnabled ? COCKPIT_COLORS.secondary : undefined)
            : undefined
      }, `${item.marker} ${item.label}`)
    )
  );
}

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

export function CockpitFooter({ model }) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { color: COCKPIT_COLORS.muted },
      `├${"─".repeat(62)}┤`
    ),
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, `│ ${model.text}`),
    React.createElement(Text, { color: COCKPIT_COLORS.muted },
      `╰${"─".repeat(62)}╯`
    )
  );
}

export function CockpitShell({
  topBar,
  footer,
  layoutMode,
  nav,
  system,
  navFocused,
  contentFocused,
  systemFocused,
  colorEnabled = true,
  children
}) {
  const showNav = layoutMode === "wide" || layoutMode === "compact";
  const showSystem = layoutMode === "wide";

  return React.createElement(Box, { flexDirection: "column", width: "100%" },
    React.createElement(CockpitTopBar, { model: topBar, colorEnabled }),
    layoutMode === "minimal" && nav && React.createElement(Box, { marginY: 0 },
      React.createElement(Text, { color: COCKPIT_COLORS.muted }, "Nav: "),
      React.createElement(CockpitNav, { model: nav, colorEnabled })
    ),
    React.createElement(Box, { flexDirection: "row", width: "100%" },
      showNav && React.createElement(CockpitPanel, {
        title: nav?.title ?? "NAVIGATION",
        focused: navFocused,
        width: 22
      }, React.createElement(CockpitNav, { model: nav, colorEnabled })),
      React.createElement(CockpitPanel, {
        title: undefined,
        focused: contentFocused,
        width: showSystem ? 48 : showNav ? 56 : "100%"
      }, children),
      showSystem && React.createElement(CockpitPanel, {
        title: system?.title ?? "SYSTEM",
        focused: systemFocused,
        width: 20
      }, React.createElement(CockpitSystemStrip, { model: system, colorEnabled }))
    ),
    React.createElement(CockpitFooter, { model: footer })
  );
}
