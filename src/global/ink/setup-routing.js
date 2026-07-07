import { canUseSetupInk } from "./terminal.js";

const BARE_SETUP_FLAGS = [
  "interactive",
  "dryRun",
  "yes",
  "confirm",
  "json",
  "agents",
  "components",
  "noDefaultComponents"
];

function isBareInteractiveSetup({
  interactive,
  yes = false,
  confirm = false,
  json = false,
  agents = null,
  components = null,
  noDefaultComponents = false
} = {}) {
  if (!interactive || json) return false;
  if (yes || confirm) return false;
  if (agents != null || components != null || noDefaultComponents) return false;
  return true;
}

export function shouldUseSetupInk({
  interactive,
  simple = false,
  inkCapable = canUseSetupInk({ interactive }),
  ...flags
} = {}) {
  if (simple) return false;
  if (!isBareInteractiveSetup({ interactive, ...flags })) return false;
  return inkCapable;
}

export function shouldUseClackWizard({
  interactive,
  simple = false,
  inkCapable = canUseSetupInk({ interactive }),
  ...flags
} = {}) {
  if (!isBareInteractiveSetup({ interactive, ...flags })) return false;
  if (!simple && inkCapable) return false;
  return true;
}

export { BARE_SETUP_FLAGS, isBareInteractiveSetup };
