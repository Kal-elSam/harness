/**
 * Deep-space cockpit theme. Status always has a text label — never color alone.
 */

export const COCKPIT_COLORS = {
  primary: "cyan",
  secondary: "magenta",
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  border: "cyan"
};

export const STATUS_LABELS = {
  ready: "Ready",
  warn: "Warn",
  error: "Error",
  offline: "Offline",
  local: "Local",
  online: "ONLINE",
  loading: "Loading",
  needs_setup: "Needs setup",
  needs_attention: "Needs attention",
  limited: "Limited"
};

export const COCKPIT_GLYPHS = {
  focus: "›",
  focusAscii: ">",
  bullet: "·",
  bulletAscii: "-",
  more: "…",
  moreAscii: "..."
};

export function resolveGlyphs(unicode = true) {
  if (unicode) {
    return {
      focus: COCKPIT_GLYPHS.focus,
      bullet: COCKPIT_GLYPHS.bullet,
      more: COCKPIT_GLYPHS.more
    };
  }
  return {
    focus: COCKPIT_GLYPHS.focusAscii,
    bullet: COCKPIT_GLYPHS.bulletAscii,
    more: COCKPIT_GLYPHS.moreAscii
  };
}

export function statusColor(kind, { colorEnabled = true } = {}) {
  if (!colorEnabled) return undefined;
  switch (kind) {
    case "ready":
    case "success":
    case "online":
      return COCKPIT_COLORS.success;
    case "warn":
    case "warning":
    case "needs_setup":
    case "limited":
      return COCKPIT_COLORS.warning;
    case "error":
    case "danger":
    case "needs_attention":
      return COCKPIT_COLORS.danger;
    case "offline":
    case "muted":
      return COCKPIT_COLORS.muted;
    default:
      return COCKPIT_COLORS.primary;
  }
}

export function formatStatusBadge(kind, label = STATUS_LABELS[kind] ?? String(kind)) {
  return label;
}
