# Terminal look (typography)

Kairo's interactive UI is a **ratatui** app that draws cells inside your terminal.
It cannot change the host typeface: glyphs, size and line height come from the
**terminal profile** you already use.

## What Kairo controls

Kairo paints its own sober graphite-green palette with RGB colors (see `tone` in
`crates/kairo-ui/src/surfaces.rs`):

| Role | Color |
|---|---|
| Work surface | `#090F0E` |
| Primary text | `#E8F5EF` |
| Accent (brand, focus, selection) | `#5EE6A8` |
| Error | `#DC5A5A` |
| Warning / tool | `#E0B45C` |
| User message | `#8EC8FF` |

Semantic colors stay distinct: red for errors, amber for notices, blue for user
messages. The accent green is reserved for brand, focus and selection.

## What your terminal controls

- **Font:** any monospace font works. Terminus and Iosevka Term read well at small
  sizes; a classic bitmap-style font such as IBM VGA 8x16 also works if you like
  that look.
- **Size and line height:** 14-18 px with line height 1.0-1.1 keeps the layout tidy.
- **Cursor:** block cursor, no blink, matches the editor cursor Kairo draws.
- **Background:** a dark profile close to `#090F0E` blends with the work surface.
  A fully different background still works because Kairo paints its own surfaces.

Kairo does not bundle or install fonts, and it does not change terminal profiles.
Select the font in the terminal app (for example Warp: Settings, Appearance, Font).

## Not part of the product

An alternative CRT phosphor palette, an owned-window renderer
(`KAIRO_UI_SURFACE=window`) and bundled fonts were evaluated and are preserved
outside the product line. They are not available in this build.
