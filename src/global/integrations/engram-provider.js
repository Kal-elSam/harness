/** Engram provider shell — methods filled by later Milestone 3 PRs. */

const NOT_READY = "Engram provider method is not implemented yet.";

export function createEngramProvider() {
  return {
    id: "engram",
    async inspect() {
      throw new Error(NOT_READY);
    },
    async plan() {
      throw new Error(NOT_READY);
    },
    async apply() {
      throw new Error(NOT_READY);
    },
    async verify() {
      throw new Error(NOT_READY);
    },
    async rollback() {
      throw new Error(NOT_READY);
    }
  };
}
