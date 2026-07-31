import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS, resolveInkColor, statusColor } from "../theme.js";

export function CockpitBadge({ label, kind = "ready", colorEnabled = true }) {
  return React.createElement(Text, {
    color: statusColor(kind, { colorEnabled })
  }, label);
}

export function CockpitEmptyState({ title, message, hint, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column", marginY: 1 },
    title && React.createElement(Text, {
      bold: true,
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.brand)
    }, title),
    message && React.createElement(Text, null, message),
    hint && React.createElement(Text, {
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
    }, hint)
  );
}

/** Content region — no border; focus is conveyed by interactive children. */
export function CockpitPanel({ title, focused = false, width, children, colorEnabled = true }) {
  return React.createElement(Box, {
    flexDirection: "column",
    width,
    paddingX: 0,
    marginY: 1,
    flexGrow: 1
  },
    title && React.createElement(Text, {
      bold: true,
      color: resolveInkColor(
        colorEnabled,
        focused ? COCKPIT_COLORS.interactive : COCKPIT_COLORS.brand
      )
    }, title),
    children
  );
}

export function CockpitSection({ title, children, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    title && React.createElement(Text, {
      bold: true,
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.brand)
    }, title),
    children
  );
}

export function CockpitKeyHint({ keys, label, colorEnabled = true }) {
  return React.createElement(Text, {
    color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
  }, `${keys} ${label}`);
}

/** Compact header: brand · status · project — no box-drawing. */
export function CockpitTopBar({ model, colorEnabled = true }) {
  const statusKind = String(model.status ?? "").toUpperCase() === "ONLINE"
    ? "online"
    : "muted";
  return React.createElement(Box, { justifyContent: "space-between", width: "100%" },
    React.createElement(Box, null,
      React.createElement(Text, {
        bold: true,
        color: resolveInkColor(colorEnabled, COCKPIT_COLORS.brand)
      }, model.brand),
      React.createElement(Text, {
        color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
      }, " · "),
      React.createElement(CockpitBadge, {
        label: model.status,
        kind: statusKind,
        colorEnabled
      })
    ),
    React.createElement(Text, {
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
    }, model.projectLabel)
  );
}

/** Vertical nav list (legacy / tests). Prefer CockpitNavStrip in the shell. */
export function CockpitNav({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    model.items.map((item) => {
      const suffix = item.current && !item.selected ? " (open)" : "";
      const color = item.focused
        ? resolveInkColor(colorEnabled, COCKPIT_COLORS.interactive)
        : item.selected
          ? resolveInkColor(colorEnabled, COCKPIT_COLORS.brand)
          : item.current
            ? resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
            : undefined;
      return React.createElement(Text, {
        key: item.id,
        bold: item.focused || item.selected,
        color
      }, `${item.marker} ${item.label}${suffix}`);
    }),
    model.explanation && React.createElement(Text, {
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
    }, model.explanation)
  );
}

function stripLabel(item, { compact }) {
  if (!compact) return item.label;
  return item.label.split(/[&·]/)[0].trim().split(/\s+/)[0];
}

/** Segmented horizontal nav — no border; active segment uses interactive. */
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
    const active = item.focused || item.selected;
    const color = item.focused || (focused && item.selected)
      ? resolveInkColor(colorEnabled, COCKPIT_COLORS.interactive)
      : item.selected
        ? resolveInkColor(colorEnabled, COCKPIT_COLORS.interactive)
        : resolveInkColor(colorEnabled, COCKPIT_COLORS.muted);
    const text = focused && item.selected
      ? `[${label}]${suffix}`
      : `${item.marker}${label}${suffix}`;
    return React.createElement(Text, {
      key: item.id,
      bold: active,
      color
    }, text);
  });

  const joined = [];
  parts.forEach((node, index) => {
    if (index > 0) {
      joined.push(React.createElement(Text, {
        key: `sep-${index}`,
        color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
      }, " · "));
    }
    joined.push(node);
  });

  return React.createElement(Box, {
    flexDirection: "column",
    width: "100%",
    marginTop: 0,
    marginBottom: 0
  },
    React.createElement(Box, { flexDirection: "row", flexWrap: "wrap" }, ...joined),
    model.explanation && React.createElement(Text, {
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
    }, model.explanation)
  );
}

/** Kept for model tests; no longer rendered in the shell. */
export function CockpitSystemStrip({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    model.rows.map((row) =>
      React.createElement(Text, { key: row.key },
        React.createElement(Text, {
          color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
        }, `${row.key.padEnd(7)}`),
        React.createElement(CockpitBadge, {
          label: row.value,
          kind: row.kind,
          colorEnabled
        })
      )
    )
  );
}

/** Single-line shortcut bar — no framed box. */
export function CockpitFooter({ model, columns = 80, colorEnabled = true }) {
  const width = Math.max(24, Math.min(Number(columns) || 80, 120));
  return React.createElement(Box, { width: "100%", marginTop: 1 },
    React.createElement(Text, {
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.muted)
    }, String(model.text ?? "").slice(0, width))
  );
}

/**
 * Responsive single-panel shell: TopBar → NavStrip → Main → Footer.
 * No nested borders — hierarchy via type and spacing.
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
      width: "100%",
      colorEnabled
    }, children),
    React.createElement(CockpitFooter, { model: footer, columns, colorEnabled })
  );
}
