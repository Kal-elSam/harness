/**
 * Minimal ANSI-aware text width helpers formerly imported from pi-tui.
 * Used by slash/ops formatters that still live under cockpit/ after U7
 * product-UI retirement — not a TUI framework.
 */

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** @param {string} text */
export function stripTerminalSequences(text) {
  return String(text ?? "").replace(ANSI_RE, "");
}

/** @param {string} text */
export function visibleWidth(text) {
  const plain = stripTerminalSequences(text);
  let width = 0;
  for (const char of plain) {
    // Treat common CJK / fullwidth as 2 columns; everything else as 1.
    const code = char.codePointAt(0) ?? 0;
    width += code > 0xff && code < 0x10000 ? 2 : 1;
  }
  return width;
}

/**
 * @param {string} text
 * @param {number} maxWidth
 * @param {string} [ellipsis]
 */
export function truncateToWidth(text, maxWidth, ellipsis = "…") {
  const raw = String(text ?? "");
  if (maxWidth <= 0) return "";
  if (visibleWidth(raw) <= maxWidth) return raw;
  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) return ellipsis.slice(0, maxWidth);
  let out = "";
  let width = 0;
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "\x1b") {
      const m = raw.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = raw.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = cp > 0xff && cp < 0x10000 ? 2 : 1;
    if (width + cw + ellipsisWidth > maxWidth) break;
    out += ch;
    width += cw;
    i += ch.length;
  }
  return `${out}${ellipsis}`;
}

/**
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
export function wrapTextWithAnsi(text, maxWidth) {
  const raw = String(text ?? "");
  if (maxWidth <= 0) return [raw];
  const words = raw.split(/(\s+)/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word === "") continue;
    const candidate = current + word;
    if (current && visibleWidth(candidate) > maxWidth) {
      lines.push(current.replace(/\s+$/, ""));
      current = word.replace(/^\s+/, "");
      while (visibleWidth(current) > maxWidth) {
        // Hard-split an oversized token.
        let chunk = "";
        let width = 0;
        let i = 0;
        while (i < current.length) {
          if (current[i] === "\x1b") {
            const m = current.slice(i).match(/^\x1b\[[0-9;]*m/);
            if (m) {
              chunk += m[0];
              i += m[0].length;
              continue;
            }
          }
          const cp = current.codePointAt(i);
          const ch = String.fromCodePoint(cp);
          const cw = cp > 0xff && cp < 0x10000 ? 2 : 1;
          if (chunk && width + cw > maxWidth) break;
          chunk += ch;
          width += cw;
          i += ch.length;
        }
        lines.push(chunk);
        current = current.slice(i);
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Stub key tokens used by retired cockpit input handlers still covered by adapter tests. */
export const Key = Object.freeze({
  up: "up",
  down: "down",
  enter: "enter",
  escape: "escape"
});

/**
 * Minimal key matcher for ANSI CSI sequences and ctrl+c.
 * @param {string} data
 * @param {string} key
 */
export function matchesKey(data, key) {
  if (key === "ctrl+c") return data === "\x03";
  if (key === Key.up || key === "up") return data === "\x1b[A";
  if (key === Key.down || key === "down") return data === "\x1b[B";
  if (key === Key.enter || key === "enter") return data === "\r" || data === "\n";
  if (key === Key.escape || key === "escape") return data === "\x1b";
  return false;
}
