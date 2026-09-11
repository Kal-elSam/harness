// Minimal ANSI true-color theme for the `kairo start` cockpit, ported from
// gentle-pi's Gentle.json palette (docs/gentle-pi reference, MIT) so the
// cockpit reads like a real TUI instead of plain padded text.

const PALETTE = {
  border: [49, 51, 66],
  accent: [224, 193, 90],
  text: [243, 246, 249],
  muted: [92, 97, 112],
  warning: [222, 186, 135],
  error: [203, 124, 148],
  success: [183, 204, 133],
  info: [127, 180, 202],
  selection: [35, 42, 64]
};

/**
 * @param {string} role - a PALETTE key
 * @param {string} text
 * @returns {string}
 */
function fg(role, text) {
  const rgb = PALETTE[role] ?? PALETTE.text;
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m`;
}

/** @param {string} text */
function bold(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

/**
 * Background-color highlight (e.g. the selected row in a list), like the
 * blue selection bar in a real file tree.
 * @param {string} role
 * @param {string} text
 */
function bg(role, text) {
  const rgb = PALETTE[role] ?? PALETTE.text;
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m`;
}

export const theme = { fg, bold, bg };

/**
 * pi-tui's Editor component requires this shape (EditorTheme). We don't use
 * autocomplete yet, so the selectList sub-theme is only there to satisfy the
 * type contract.
 */
export const editorTheme = {
  // Bright, not the muted "border" gray used for card rules elsewhere — the
  // composer is the one place the user is actively typing, so it needs to
  // read as a distinct, easy-to-find zone rather than blend into the frame.
  borderColor: (text) => fg("success", text),
  selectList: {
    selectedPrefix: (text) => fg("accent", text),
    selectedText: (text) => bold(text),
    description: (text) => fg("muted", text),
    scrollInfo: (text) => fg("muted", text),
    noMatch: (text) => fg("muted", text)
  }
};
