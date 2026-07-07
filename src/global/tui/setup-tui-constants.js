export const SETUP_TUI_TOTAL_STEPS = 6;

export class SetupTuiCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "SetupTuiCancelledError";
  }
}
