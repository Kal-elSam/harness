// Minimal ANSI true-color theme for the `kairo start` cockpit, ported from
// gentle-pi's Gentle.json palette (docs/gentle-pi reference, MIT) so the
// cockpit reads like a real TUI instead of plain padded text.

// Exported so real contrast (WCAG relative luminance) can be verified
// directly against the actual values in use, not a guess — see
// theme.test.js's own regression for the real bug this caught (muted
// measured ~3.40:1 on black, below the 4.5:1 floor for normal text).
export const PALETTE = {
  border: [49, 51, 66],
  accent: [224, 193, 90],
  text: [243, 246, 249],
  // Bumped from [92,97,112] (real measured WCAG contrast on black: ~3.40:1
  // — below the 4.5:1 minimum for normal text, which is why provider
  // names, tags, and hint lines read as illegible in a real screenshot).
  // [118,124,142] measures ~5.04:1, comfortably above the floor while
  // staying visibly muted relative to `text` — still a secondary-info
  // color, just a real, readable one.
  muted: [118, 124, 142],
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

/**
 * Bold + foreground + background combined in ONE ANSI escape with a
 * SINGLE trailing reset — never nest `bold(bg(...))`/`fg(bg(...))`:
 * each of those helpers ends with its own `\x1b[0m`, and an inner reset
 * inside an outer one silently cuts the outer styling short partway
 * through the text. Used for a real, clearly-highlighted selected row —
 * "fondo/acentuación clara únicamente a la fila seleccionada" — without
 * that hazard.
 * @param {string} bgRole
 * @param {string} fgRole
 * @param {string} text
 */
function bgFg(bgRole, fgRole, text) {
  const bgRgb = PALETTE[bgRole] ?? PALETTE.text;
  const fgRgb = PALETTE[fgRole] ?? PALETTE.text;
  return `\x1b[1m\x1b[38;2;${fgRgb[0]};${fgRgb[1]};${fgRgb[2]}m\x1b[48;2;${bgRgb[0]};${bgRgb[1]};${bgRgb[2]}m${text}\x1b[0m`;
}

export const theme = { fg, bold, bg, bgFg };

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
    // A real background highlight on the selected row only (never the
    // whole panel — see project-overlay.js's own Box, which applies no
    // background of its own), bold + bright text for clear legibility
    // against it.
    selectedText: (text) => bgFg("selection", "text", text),
    description: (text) => fg("muted", text),
    scrollInfo: (text) => fg("muted", text),
    noMatch: (text) => fg("muted", text)
  }
};
