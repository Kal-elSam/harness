import { formatHelp } from "./format.js";

const ESCAPE_KEYS = [
  { seq: "\u001b[A", action: "up" },
  { seq: "\u001b[B", action: "down" },
  { seq: "\u001b[C", action: "ignore" },
  { seq: "\u001b[D", action: "ignore" }
];

const SINGLE_KEYS = new Map([
  ["\u0003", "cancel"],
  ["q", "cancel"],
  ["Q", "cancel"],
  ["\r", "confirm"],
  ["\n", "confirm"],
  [" ", "toggle"]
]);

export async function runMultiSelect({
  title,
  items,
  initialSelected = null,
  allowEmpty = false,
  help = "↑↓ move · Space toggle · Enter confirm · q cancel",
  io,
  readKeys = null,
  closeOnExit = true
}) {
  const selected = new Set(
    initialSelected ?? items.filter((item) => item.selected).map((item) => item.id)
  );
  let activeIndex = Math.max(0, items.findIndex((item) => selected.has(item.id)));

  const render = () => {
    const lines = [title, ""];
    for (const [index, item] of items.entries()) {
      lines.push(item.render({
        selected: selected.has(item.id),
        active: index === activeIndex
      }));
    }
    lines.push("", formatHelp(help));
    io.clear();
    io.hideCursor();
    io.write(`${lines.join("\n")}\n`);
  };

  const keySource = readKeys ?? createKeyReader(io);

  try {
    while (true) {
      render();
      const key = await keySource.next();

      if (key === "up") {
        activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
        continue;
      }

      if (key === "down") {
        activeIndex = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
        continue;
      }

      if (key === "toggle") {
        const activeId = items[activeIndex].id;
        if (selected.has(activeId)) selected.delete(activeId);
        else selected.add(activeId);
        continue;
      }

      if (key === "confirm") {
        if (!allowEmpty && selected.size === 0) continue;
        return { cancelled: false, selected: [...selected] };
      }

      if (key === "cancel") {
        return { cancelled: true, selected: [...selected] };
      }
    }
  } finally {
    if (closeOnExit) {
      await io.close();
    }
  }
}

function createKeyReader(io) {
  let buffer = "";

  return {
    async next() {
      while (true) {
        const parsed = parseKeyBuffer(buffer);

        if (parsed.pending) {
          buffer += await io.readKey();
          continue;
        }

        buffer = buffer.slice(parsed.consumed);

        if (parsed.action === "ignore") {
          continue;
        }

        return parsed.action;
      }
    }
  };
}

export function parseKeyBuffer(buffer) {
  if (buffer.length === 0) {
    return { action: null, consumed: 0, pending: true };
  }

  const singleAction = SINGLE_KEYS.get(buffer[0]);
  if (singleAction) {
    return { action: singleAction, consumed: 1, pending: false };
  }

  for (const { seq, action } of ESCAPE_KEYS) {
    if (buffer.startsWith(seq)) {
      return { action, consumed: seq.length, pending: false };
    }

    if (seq.startsWith(buffer)) {
      return { action: null, consumed: 0, pending: true };
    }
  }

  if (buffer === "\u001b" || (buffer.startsWith("\u001b[") && buffer.length < 3)) {
    return { action: null, consumed: 0, pending: true };
  }

  if (buffer.startsWith("\u001b[")) {
    return { action: "ignore", consumed: Math.min(buffer.length, 3), pending: false };
  }

  if (buffer[0] === "\u001b") {
    return { action: "ignore", consumed: 1, pending: false };
  }

  return { action: "ignore", consumed: 1, pending: false };
}

export function decodeKey(input) {
  const parsed = parseKeyBuffer(input);
  if (parsed.pending) return "pending";
  return parsed.action ?? "ignore";
}

export function renderConfirmScreen({ title, bodyLines, confirmHelp, io }) {
  io.clear();
  io.hideCursor();
  io.write([
    title,
    "",
    ...bodyLines,
    "",
    formatHelp(confirmHelp)
  ].join("\n") + "\n");
}

export async function promptYesNo({
  title,
  bodyLines,
  help = "Y confirm · n cancel · q quit",
  io,
  readAnswer = null,
  closeOnExit = true
}) {
  renderConfirmScreen({ title, bodyLines, confirmHelp: help, io });

  const answer = readAnswer
    ? await readAnswer()
    : await readLineAnswer(io);

  if (closeOnExit) {
    await io.close();
  }

  const normalized = answer.trim().toLowerCase();
  if (normalized === "q") return "cancel";
  if (normalized === "n" || normalized === "no") return "no";
  return "yes";
}

async function readLineAnswer(io) {
  if (typeof io.readLine === "function") {
    return io.readLine();
  }
  return "yes";
}
