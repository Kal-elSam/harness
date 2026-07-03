import test from "node:test";
import assert from "node:assert/strict";
import { assertCleanReleaseMessage } from "../scripts/check-release-commit.mjs";

test("accepts a clean release commit message", () => {
  assert.doesNotThrow(() => assertCleanReleaseMessage("chore: release 0.4.1\n"));
});

test("rejects Co-authored-by trailers", () => {
  assert.throws(
    () => assertCleanReleaseMessage("chore: release 0.4.1\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n"),
    /Co-authored-by/
  );
});

test("rejects Co-authored-by case-insensitively", () => {
  assert.throws(
    () => assertCleanReleaseMessage("chore: release 0.4.1\n\nco-authored-by: bot\n"),
    /Co-authored-by/
  );
});
