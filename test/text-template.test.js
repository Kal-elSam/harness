import test from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "../src/text-template.js";

test("renders project placeholders", () => {
  const output = renderTemplate("[PROJECT_NAME] uses [PACKAGE_MANAGER] and [TEST_COMMAND].", {
    name: "demo",
    packageManager: "pnpm",
    commands: {
      test: "pnpm test"
    }
  });

  assert.equal(output, "demo uses pnpm and pnpm test.");
});
