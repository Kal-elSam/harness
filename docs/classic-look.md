# Terminal look (typography)

Kairo's interactive UI is a **ratatui** app that draws cells inside your terminal.
It cannot change the host typeface: glyphs, size and line height come from the
**terminal profile** you already use.

## What Kairo controls

Kairo defaults to a **CRT / Matrix phosphor-green** skin, shared by every
Ratatui surface through `crates/kairo-ui/src/theme.rs`.

| Role | Color |
|---|---|
| Work surface | `#000000` (true black) |
| Sidebar / usage bands | `#00140A` / `#001F10` |
| Primary text | `#33FF66` |
| Accent / focused border | `#00FF41` |
| Secondary text | `#2ECC71` |
| Selection / editor cursor | Black ink on `#00FF41` |
| Error / warning | `#99FF99` / `#66EE55` |

Borders and selection markers use ASCII chrome. Focused borders brighten;
selected rows use reverse video, while the composer highlights only its cursor
cell. Errors use the brightest phosphor shade, warnings a separate green shade;
existing error labels, warning copy, and blocked-state markers remain visible.
Chat, code, and provider payload text are not rewritten by the skin.

The existing skin opt-out also applies to Ratatui: start with
`KAIRO_PROTOTYPE_THEME=0 kairo` (also `false`, `off`, or `no`) to restore the
previous graphite palette and standard borders. The choice is process-local;
no settings are written. Unset or other values keep CRT enabled.

## What your terminal controls

- **Font:** any monospace font works. Terminus and Iosevka Term read well at small
  sizes; a classic bitmap-style font such as IBM VGA 8x16 also works if you like
  that look.
- **Size and line height:** 14-18 px with line height 1.0-1.1 keeps the layout tidy.
- **Cursor:** block cursor, no blink, matches the editor cursor Kairo draws.
- **Background:** a dark profile close to `#000000` blends with the work surface.
  A fully different background still works because Kairo paints its own surfaces.

Kairo does not bundle or install fonts, and it does not change terminal profiles.
Select the font in the terminal app (for example Warp: Settings, Appearance, Font).

## Not part of the product

The owned-window renderer (`KAIRO_UI_SURFACE=window`) and bundled fonts remain
outside the product line. The CRT skin runs in the existing terminal renderer;
it does not add scanlines, curvature, or a separate window.
