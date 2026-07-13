const KAIRO_LOGO = [
  "██╗  ██╗ █████╗ ██╗██████╗  ██████╗ ",
  "██║ ██╔╝██╔══██╗██║██╔══██╗██╔═══██╗",
  "█████╔╝ ███████║██║██████╔╝██║   ██║",
  "██╔═██╗ ██╔══██║██║██╔══██╗██║   ██║",
  "██║  ██╗██║  ██║██║██║  ██║╚██████╔╝",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ "
];

const COMPACT_LOGO = [
  " _  __ ___ _ __  ",
  "| |/ /|_ _| '_ \\ ",
  "| ' <  | || |_) |",
  "|_|\\_\\|___| .__/ ",
  "          |_|    "
];

export const BRAND = {
  name: "KAIRO RUNTIME",
  displayName: "Kairo Runtime",
  tagline: "Local Agent Operating System",
  splashLine: "Coordinates local AI agents — does not install the apps themselves.",
  asciiLogo: KAIRO_LOGO,
  compactLogo: COMPACT_LOGO,
  splashHint: "Press Enter to continue",
  wizardCancelMessage: "Setup cancelled."
};

export const AGENT_LABELS = {
  cursor: "Cursor",
  codex: "Codex",
  opencode: "OpenCode",
  claude: "Claude Code"
};

export const AGENT_SYMBOLS = {
  cursor: "◆",
  codex: "◆",
  opencode: "◆",
  claude: "◆"
};

export const TOKENS = {
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  accent: "cyan"
};

export const AGENT_HINTS = {
  ready: "ready",
  notDetected: "not detected",
  managedLater: "managed later"
};

export const WIZARD_COPY = {
  introTitle: `${BRAND.displayName} — ${BRAND.tagline}`,
  splashTitle: "Welcome",
  detectTitle: "Your agents",
  agentsPrompt: `Which agents should ${BRAND.displayName} manage?`,
  componentsPrompt: "Which components should be installed?",
  previewTitle: "Plan preview",
  confirmDryRun: "Preview only — no files will be written. Continue?",
  confirmApply: "Apply this plan? Backups run before config writes when needed.",
  resultDryRunTitle: "Dry run complete",
  resultSuccessTitle: "Setup complete",
  outroDryRun: "Nothing was written.",
  outroSuccess: "Your local agent OS is ready.",
  coreOnlyLabel: "Core only (no components)"
};

/** First-run framing reused by onboarding → setup. */
export const ONBOARDING_COPY = {
  welcomeTitle: `Welcome to ${BRAND.displayName}`,
  purpose:
    `${BRAND.displayName} detects, configures, and coordinates the local agents you already use.`,
  safety:
    "Diagnosis is read-only. Nothing is modified until you confirm a plan.",
  continueHint: "Press Enter to diagnose and configure · Esc to exit"
};

export function getAgentLabel(agentId) {
  return AGENT_LABELS[agentId] ?? agentId;
}

export function getAgentSymbol(agentId) {
  return AGENT_SYMBOLS[agentId] ?? "•";
}

export function commandHeader(label) {
  return `${BRAND.displayName} ${label}`;
}

export {
  formatCliCommand,
  formatSuggestedCliCommand,
  PACKAGE_NAME,
  PREFERRED_CLI,
  resolveSuggestedInvocation
} from "./cli.js";
