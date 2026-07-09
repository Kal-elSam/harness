export const CAPABILITY_STATES = {
  DETECTED: "detected",
  AUTHENTICATED: "authenticated",
  AVAILABLE: "available",
  UNKNOWN: "unknown",
  ERROR: "error"
};

export function isCapabilityState(value) {
  return Object.values(CAPABILITY_STATES).includes(value);
}

export function formatCapabilityState(state) {
  switch (state) {
    case CAPABILITY_STATES.DETECTED:
      return "detected";
    case CAPABILITY_STATES.AUTHENTICATED:
      return "authenticated";
    case CAPABILITY_STATES.AVAILABLE:
      return "available";
    case CAPABILITY_STATES.UNKNOWN:
      return "unknown";
    case CAPABILITY_STATES.ERROR:
      return "error";
    default: {
      const _exhaustive = state;
      return String(_exhaustive);
    }
  }
}
