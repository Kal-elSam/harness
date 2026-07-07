import { stdin as input, stdout as output } from "node:process";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  clear: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h"
};

export function canUseSetupTui({
  interactive = Boolean(input.isTTY && output.isTTY),
  term = process.env.TERM ?? "",
  columns = output.columns ?? 80
} = {}) {
  if (!interactive) return false;
  if (term === "dumb") return false;
  if (columns > 0 && columns < 60) return false;
  return true;
}

export function createTerminalIo({
  inputStream = input,
  outputStream = output,
  columns = outputStream.columns ?? 80
} = {}) {
  let rawModeEnabled = false;

  return {
    inputStream,
    outputStream,
    columns,
    write(text) {
      outputStream.write(text);
    },
    clear() {
      outputStream.write(ANSI.clear);
    },
    hideCursor() {
      outputStream.write(ANSI.hideCursor);
    },
    showCursor() {
      outputStream.write(ANSI.showCursor);
    },
    async readKey() {
      if (!inputStream.isTTY) {
        throw new Error("readKey requires a TTY input stream.");
      }

      if (!rawModeEnabled && typeof inputStream.setRawMode === "function") {
        inputStream.setRawMode(true);
        rawModeEnabled = true;
      }

      return new Promise((resolve, reject) => {
        const onData = (chunk) => {
          cleanup();
          resolve(chunk.toString("utf8"));
        };

        const onError = (error) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          inputStream.off("data", onData);
          inputStream.off("error", onError);
        };

        inputStream.on("data", onData);
        inputStream.on("error", onError);
      });
    },
    async readLine() {
      if (!inputStream.isTTY) return "";

      if (rawModeEnabled && typeof inputStream.setRawMode === "function") {
        inputStream.setRawMode(false);
        rawModeEnabled = false;
      }

      this.showCursor();

      return new Promise((resolve) => {
        let answer = "";

        const onData = (chunk) => {
          const text = chunk.toString("utf8");
          for (const char of text) {
            if (char === "\r" || char === "\n") {
              outputStream.write("\n");
              cleanup();
              resolve(answer);
              return;
            }

            if (char === "\u0003") {
              cleanup();
              resolve("q");
              return;
            }

            answer += char;
            outputStream.write(char);
          }
        };

        const cleanup = () => {
          inputStream.off("data", onData);
        };

        inputStream.on("data", onData);
      });
    },
    async close() {
      if (rawModeEnabled && typeof inputStream.setRawMode === "function") {
        inputStream.setRawMode(false);
        rawModeEnabled = false;
      }
      this.showCursor();
    }
  };
}

export function paint(text, style) {
  const code = ANSI[style];
  if (!code) return text;
  return `${code}${text}${ANSI.reset}`;
}

export function truncate(text, width) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

export { ANSI };
