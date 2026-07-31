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

/** Ink `color` / `borderColor` prop — undefined when color is disabled. */
export function resolveInkColor(colorEnabled, color) {
  return colorEnabled ? color : undefined;
}

/**
 * Detect ANSI color SGR in a string.
 * Bold (1), dim (2), and reset (0) alone are not color.
 */
export function hasColorSgr(text) {
  const re = /\u001b\[([0-9;]*)m/g;
  let match;
  while ((match = re.exec(String(text ?? ""))) !== null) {
    const params = match[1].length === 0
      ? []
      : match[1].split(";").map((part) => Number(part));
    for (let i = 0; i < params.length; i += 1) {
      const code = params[i];
      if (!Number.isFinite(code)) continue;
      if (code === 38 || code === 48) return true;
      if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) return true;
      if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) return true;
    }
  }
  return false;
}

export function formatStatusBadge(kind, label = STATUS_LABELS[kind] ?? String(kind)) {
  return label;
}
