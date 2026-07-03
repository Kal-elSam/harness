const ATTRIBUTION_PATTERN = /co-authored-by/i;

export function assertCleanReleaseMessage(message) {
  if (ATTRIBUTION_PATTERN.test(message)) {
    throw new Error("Release commit message must not contain Co-authored-by or AI attribution.");
  }
}

export function assertCleanReleaseMessages(messages) {
  for (const message of messages) {
    assertCleanReleaseMessage(message);
  }
}

export function parseAttributionGuardArgs(argv) {
  const args = [...argv];
  let range = null;

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--range") {
      range = args[++index];
      continue;
    }

    if (arg.startsWith("--range=")) {
      range = arg.slice("--range=".length);
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  if (range !== null && range.trim() === "") {
    throw new Error("Missing value for --range.");
  }

  return { range };
}

export function readCommitMessages({ range = null, runGit }) {
  if (range) {
    const output = runGit(`git log ${range} --format=%B%x1E`).trim();
    if (!output) return [];

    return output
      .split("\x1E")
      .filter((message) => message.length > 0);
  }

  return [runGit("git log -1 --format=%B")];
}

export function runAttributionGuard({ range = null, runGit }) {
  const messages = readCommitMessages({ range, runGit });
  assertCleanReleaseMessages(messages);
  return { checked: messages.length, range };
}
