# Obsidian second brain

Kairo mirrors agent memory into an Obsidian vault so humans and models share one place. Agents write only under the vault folder `Kairo/`; your own folders are never written. `.obsidian`, `.trash` and secret-looking files are never read or written. Kairo never deletes notes.

## Commands

- `kairo obsidian config --vault ABSOLUTE_PATH` persists the vault path in `~/.harness/obsidian.json` (`HARNESS_HOME` overrides the home). The path must be absolute, exist, and not be a symlink. Without `--vault` it prints the current setting. The vault is never guessed.
- `kairo obsidian status [--json]` read-only summary: state, vault, note count under `Kairo/`, last publish.
- `kairo obsidian publish [--project NAME] [--project-dir PATH] [--max-per-kind N] [--yes] [--json]` plans the notes. It is a dry run unless `--yes` is passed.

## Layout under `Kairo/`

- `decisions/`, `architecture/`, `bugs/` notes, each with a `project:` frontmatter field (`--project` is the default for records without one; fallback `general`).
- `projects/PROJECT.md`: one hub per project linking its notes with wikilinks.
- `Home.md`: index linking every project hub.

## Safety

- Every published note carries `kairo_sha256`, the SHA-256 of the note without that line. A later publish refuses to update a managed note whose current hash differs (you edited it) or that has no recorded hash. Identical content is skipped; notes without `kairo_kind` are refused as manual content.
- Updates of managed notes keep a copy in `Kairo/.kairo-backups/`.
- Hubs and `Home.md` have no timestamps, so unchanged vaults republish as no-ops.

## Data source

Publish runs the official `engram export FILE --project NAME` with an argument array, no shell, a 15-second timeout, and a private scratch file outside the repository. It mirrors only decision, architecture and bugfix observations, keeping the newest `--max-per-kind N` per project and kind (default 10; integer 1–1000). Bug content, including root cause, is preserved. Engram remains the memory authority; Kairo never reads its database directly.

`--project-dir PATH` selects the project directory (default: current directory). Kairo resolves its Git root and reads only the existing `graphify-out/GRAPH_REPORT.md`, capped at 256 KiB and 40 sections. Missing or oversized reports produce diagnostics, not crashes. It never runs Graphify or modifies its output. Export failures use typed codes without exposing command stderr; scratch paths are reported for caller-owned cleanup. Preview reads sources even without `--yes`, but never writes vault notes without consent.
