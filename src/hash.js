import { createHash } from "node:crypto";

export function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
