export const SECTION_START = "<!-- harness:managed:start -->";
export const SECTION_END = "<!-- harness:managed:end -->";

export function hasManagedSection(content) {
  const start = content.indexOf(SECTION_START);
  const end = content.indexOf(SECTION_END);
  return start !== -1 && end !== -1 && end > start;
}

export function extractManagedBody(content) {
  if (!hasManagedSection(content)) return null;

  const start = content.indexOf(SECTION_START) + SECTION_START.length;
  const end = content.indexOf(SECTION_END);

  return content.slice(start, end).replace(/^\n/, "").replace(/\n$/, "");
}

export function buildManagedBlock(body) {
  return `${SECTION_START}\n${body.replace(/\s+$/, "")}\n${SECTION_END}\n`;
}

export function upsertManagedSection(content, body) {
  const block = buildManagedBlock(body);

  if (!hasManagedSection(content)) {
    if (content.trim() === "") {
      return { content: block, changed: block !== content, hadSection: false };
    }

    const next = `${content.replace(/\s+$/, "")}\n\n${block}`;
    return { content: next, changed: true, hadSection: false };
  }

  const start = content.indexOf(SECTION_START);
  const end = blockEndIndex(content);
  const next = content.slice(0, start) + block + content.slice(end);

  return { content: next, changed: next !== content, hadSection: true };
}

export function removeManagedSection(content) {
  if (!hasManagedSection(content)) {
    return { content, removed: false };
  }

  const start = content.indexOf(SECTION_START);
  const end = blockEndIndex(content);
  const before = content.slice(0, start).replace(/\s+$/, "");
  const after = content.slice(end).replace(/^\s+/, "");

  if (!before && !after) return { content: "", removed: true };
  if (!before) return { content: after, removed: true };
  if (!after) return { content: `${before}\n`, removed: true };

  return { content: `${before}\n\n${after}`, removed: true };
}

export function userOwnedContent(content) {
  if (!hasManagedSection(content)) return content;

  const start = content.indexOf(SECTION_START);
  const end = blockEndIndex(content);
  const before = content.slice(0, start);
  const after = content.slice(end);

  return `${before}${after}`;
}

function blockEndIndex(content) {
  const end = content.indexOf(SECTION_END) + SECTION_END.length;
  return content[end] === "\n" ? end + 1 : end;
}
