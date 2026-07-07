export class SetupWizardCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "SetupWizardCancelledError";
  }
}
