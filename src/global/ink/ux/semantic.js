/** Semantic Ink primitives — structured models, not string-array panels. */
import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS, statusColor, resolveGlyphs } from "../theme.js";

const mute = (on) => (on ? COCKPIT_COLORS.muted : undefined);

export function ActionList({ items = [], selectedIndex = 0, focused = true, colorEnabled = true, unicode = true }) {
  const g = resolveGlyphs(unicode);
  return React.createElement(Box, { flexDirection: "column" },
    ...items.map((item, i) => {
      const sel = i === selectedIndex;
      return React.createElement(Text, {
        key: item.id ?? String(i),
        bold: sel,
        color: sel && focused && colorEnabled ? COCKPIT_COLORS.primary : undefined
      }, `${sel && focused ? g.focus : " "} ${item.label}${item.hint ? `  ${item.hint}` : ""}`);
    })
  );
}

export function Stepper({ steps = [], currentIndex = 0, colorEnabled = true, unicode = true }) {
  // Progress marks: not focus `>` and not failure-looking `x`.
  const done = unicode ? "✓" : "+";
  const current = unicode ? "●" : "*";
  const idle = unicode ? "·" : "-";
  return React.createElement(Box, { flexDirection: "column" },
    ...steps.map((step, i) => {
      const isDone = i < currentIndex;
      const cur = i === currentIndex;
      const color = isDone
        ? (colorEnabled ? COCKPIT_COLORS.success : undefined)
        : cur ? (colorEnabled ? COCKPIT_COLORS.primary : undefined) : mute(colorEnabled);
      return React.createElement(Text, {
        key: step.id ?? String(i), bold: cur, color
      }, `${isDone ? done : cur ? current : idle} ${i + 1}. ${step.label}`);
    })
  );
}

export function Callout({ tone = "info", title, body, colorEnabled = true, compact = false }) {
  const kind = tone === "danger" ? "danger" : tone === "warn" ? "warn" : "ready";
  return React.createElement(Box, {
    flexDirection: "column",
    marginY: compact ? 0 : 1
  },
    React.createElement(Text, { bold: true, color: statusColor(kind, { colorEnabled }) }, title),
    body ? React.createElement(Text, null, body) : null
  );
}

export function Confirm({ summary, primaryLabel = "Confirm", focused = true, colorEnabled = true, mark = " " }) {
  return React.createElement(Box, { flexDirection: "column" },
    summary ? React.createElement(Text, null, summary) : null,
    React.createElement(Text, {
      bold: focused,
      color: focused && colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, `${mark} ${primaryLabel}`)
  );
}

export function Receipt({ title = "Receipt", lines = [], colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true, color: colorEnabled ? COCKPIT_COLORS.success : undefined }, title),
    ...lines.map((line, i) => React.createElement(Text, { key: `r${i}`, color: mute(colorEnabled) }, line))
  );
}

export function Details({ open = false, summary = "Details", lines = [], colorEnabled = true, focused = false, mark = " " }) {
  const color = focused && colorEnabled ? COCKPIT_COLORS.primary : mute(colorEnabled);
  if (!open) return React.createElement(Text, { bold: focused, color }, `${mark} ${summary} · Space`);
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true, color }, `${mark} ${summary}`),
    ...lines.map((line, i) => React.createElement(Text, { key: `d${i}`, color: mute(colorEnabled) }, line))
  );
}

export function KeyBar({ hints = [], colorEnabled = true, columns = 80 }) {
  const width = Math.max(24, Math.min(Number(columns) || 80, 120));
  return React.createElement(Box, { width },
    React.createElement(Text, { color: mute(colorEnabled) },
      hints.map((h) => `${h.keys} ${h.label}`).join(" · "))
  );
}
