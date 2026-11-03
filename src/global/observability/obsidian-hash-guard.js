import { hashBuffer } from "../../hash.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const HASH_LINE = /^kairo_sha256:\s*"([0-9a-f]{64})"\s*$/;

/** Split a note into frontmatter lines (minus the hash line), the recorded hash and the body. */
function parse(markdown) {
  const text = String(markdown ?? "");
  const m = text.match(FRONTMATTER);
  if (!m) return null;
  let recorded = null;
  const lines = [];
  for (const line of m[1].split(/\r?\n/)) {
    const h = line.match(HASH_LINE);
    if (h) recorded = h[1];
    else lines.push(line);
  }
  return { lines, recorded, rest: text.slice(m[0].length) };
}

const render = (lines, rest) => `---\n${lines.join("\n")}\n---\n${rest}`;

/**
 * Note content with the `kairo_sha256` line removed. This is exactly what the
 * recorded hash covers, so any edit to the note (frontmatter or body) changes it.
 */
function canonical(markdown) {
  const parsed = parse(markdown);
  return parsed ? render(parsed.lines, parsed.rest) : String(markdown ?? "");
}

/** Add (or refresh) `kairo_sha256` so a later publish can detect manual edits. Idempotent. */
export function stampKairoHash(markdown) {
  const parsed = parse(markdown);
  if (!parsed) return markdown;
  const base = render(parsed.lines, parsed.rest);
  const hash = hashBuffer(Buffer.from(base, "utf8"));
  return render([...parsed.lines, `kairo_sha256: "${hash}"`], parsed.rest);
}

/** `ok` = unchanged since stamp; `modified` = edited; `unrecorded` = never stamped. */
export function verifyKairoHash(markdown) {
  const parsed = parse(markdown);
  if (!parsed || !parsed.recorded) return { state: "unrecorded", recorded: null };
  const current = hashBuffer(Buffer.from(canonical(markdown), "utf8"));
  return { state: current === parsed.recorded ? "ok" : "modified", recorded: parsed.recorded, current };
}
