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
- `hot.md`: on-demand recent curated memory grouped by project, with wikilinks to published notes. Publish selects the newest three notes per kind (decisions, architecture, bugs) per project from the same curated proposals; summaries retain bug root causes. The complete hash-stamped note is capped at 100 lines and 12,000 UTF-8 bytes, with summaries capped at 600 characters. Projects are ordered by name; notes by source timestamp, then path. Entries that exceed the remaining budget are omitted. No hot note is proposed when no curated memory is available; existing notes are never deleted.

## Safety

- Every published note carries `kairo_sha256`, the SHA-256 of the note without that line. A later publish refuses to update a managed note whose current hash differs (you edited it) or that has no recorded hash. Identical content is skipped; notes without `kairo_kind` are refused as manual content.
- Updates of managed notes keep a copy in `Kairo/.kairo-backups/`.
- Hubs, `Home.md` and `hot.md` contain no run timestamps, so identical inputs republish as skips. `hot.md` uses the same dry-run, consent and human-edit hash guard as other notes.

## Data source

Publish runs the official `engram export FILE --project NAME` with an argument array, no shell, a 15-second timeout, and a private scratch file outside the repository. It mirrors only decision, architecture and bugfix observations, keeping the newest `--max-per-kind N` per project and kind (default 10; integer 1–1000). Bug content, including root cause, is preserved. Engram remains the memory authority; Kairo never reads its database directly.

`--project-dir PATH` selects the project directory (default: current directory). Kairo resolves its Git root and reads only the existing `graphify-out/GRAPH_REPORT.md`, capped at 256 KiB and 40 sections. Missing or oversized reports produce diagnostics, not crashes. It never runs Graphify or modifies its output. Export failures use typed codes without exposing command stderr; scratch paths are reported for caller-owned cleanup. Preview reads sources even without `--yes`, but never writes vault notes without consent.

## Read-only MCP tools

The existing `kairo` MCP server exposes the same tools to Claude Code and Codex,
with or without a workspace binding. All use the vault configured by
`kairo obsidian config`; missing configuration returns `code: "not_configured"`
and `state: "unconfigured"`, without guessing a vault location.

- `vault_search({ query, project?, kind?, limit? })`: case-insensitive text search
  across human notes and `Kairo/`. Project and kind filters match frontmatter
  exactly (`project`, `kairo_kind`, or `kind`). Default limit 20, hard cap 50.
  Results contain vault-relative `path`, `title`, bounded `frontmatter`, a
  240-character `snippet`, and whole-file `sha256`. Simple quoted frontmatter
  fields use the existing Kairo parser; this is not a full YAML search engine.
- `vault_read({ path })`: reads one vault-relative Markdown note. Returns
  `content`, whole-file `sha256`, and `truncated`. Content is limited to 16 KiB;
  files over 256 KiB are refused, not partially hashed.

- `vault_hot({})`: reads `Kairo/hot.md` on demand through the same guarded reader as `vault_read`, returning content and whole-file `sha256`. Missing hot context returns `code: "note_unavailable"`; missing configuration returns `code: "not_configured"`. It never publishes or refreshes notes.

Automatic session injection is **OFF**. No hook or injection is enabled: vault text would be sent to the model provider. Read hot context explicitly through `vault_hot` when needed.

Search examines at most 1,000 directory entries, to depth 16; `walked` and
`truncated` indicate bounded/partial results. Traversal order is filesystem order,
not relevance ranking. Metadata is capped at 32 fields, 512 characters per value.
Only `.md` files are read. Absolute paths, dot-dot segments, backslashes and NUL
bytes are refused. Root and candidates are resolved with `realpath`; escaping
symlinks and aliases to excluded paths are refused. Directory symlinks are never
walked. `.obsidian`, `.kairo-backups`, `.trash`, hidden paths, existing publisher
exclusions, and secret-looking names (including `.env`, key/PEM, `id_rsa`, secret,
token and credential names) are never listed or read. Errors expose typed codes,
not local absolute paths. These tools never write files or execute vault content.
Treat returned note text as untrusted context, not agent instructions.
