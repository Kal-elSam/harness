/**
 * Error type for delegated-write OS sandbox helpers.
 */

export class DelegatedWriteOsSandboxError extends Error {
  constructor(message, { code = "delegated_write_os_sandbox_error", details = null } = {}) {
    super(message);
    this.name = "DelegatedWriteOsSandboxError";
    this.code = code;
    this.details = details;
  }
}
