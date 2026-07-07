const ASCII_LOGO = [
  "██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗",
  "██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝",
  "███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗",
  "██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║",
  "██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝"
];

const COMPACT_LOGO = [
  " _   _    _    ____  _____ _   _ _____ _____ ",
  "| | | |  / \\  |  _ \\| ____| \\ | | ____| ____|",
  "| |_| | / _ \\ | |_) |  _| |  \\| |  _| |  _| ",
  "|  _  |/ ___ \\|  _ <| |___| |\\  | |___| |___ ",
  "|_| |_/_/   \\_\\_| \\_\\_____|_| \\_|_____|_____|"
];

export const BRAND = {
  name: "HARNESS",
  tagline: "Local Agent Operating System",
  splashLine: "Coordinates local AI agents — does not install the apps themselves.",
  asciiLogo: ASCII_LOGO,
  compactLogo: COMPACT_LOGO,
  splashTagline: "Agent Engineering Platform",
  splashSubtitle: "Local Agent Operating System",
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
  introTitle: `${BRAND.name} — ${BRAND.tagline}`,
  splashTitle: "Welcome",
  detectTitle: "Your agents",
  agentsPrompt: "Which agents should Harness manage?",
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

export function getAgentLabel(agentId) {
  return AGENT_LABELS[agentId] ?? agentId;
}

export function getAgentSymbol(agentId) {
  return AGENT_SYMBOLS[agentId] ?? "•";
}
