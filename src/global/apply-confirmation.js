import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function isInteractiveTerminal(interactive = null) {
  if (interactive != null) return interactive;
  return Boolean(input.isTTY && output.isTTY);
}

export function shouldPromptApplyConfirmation({
  applying = true,
  dryRun = false,
  json = false,
  confirm = false,
  interactive = null
}) {
  if (!applying || dryRun || json || confirm) return false;
  return isInteractiveTerminal(interactive);
}

export function assertExplicitApplyConsent({
  applying = true,
  dryRun = false,
  json = false,
  yes = false,
  confirm = false,
  noPreflight = false,
  interactive = null,
  command
}) {
  if (!applying || dryRun || json) return;
  if (isInteractiveTerminal(interactive)) return;
  if (yes || confirm || noPreflight) return;

  throw new Error(
    `Non-interactive ${command} requires --yes, --confirm, or --no-preflight before applying managed changes.`
  );
}

export async function promptApplyConfirmation({
  command,
  createPrompt = createReadlinePrompt,
  question = null
}) {
  const prompt = createPrompt();

  try {
    const answer = (await prompt(
      question ?? `Apply managed changes for ${command}? [Y/n]: `
    )).trim().toLowerCase();

    return !(answer === "n" || answer === "no");
  } finally {
    await prompt.close?.();
  }
}

export function createReadlinePrompt() {
  const rl = readline.createInterface({ input, output });
  const prompt = (question) => rl.question(question);
  prompt.close = async () => rl.close();
  return prompt;
}
