import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INITIAL_EXPERIENCE,
  hasConfiguredGlobalState,
  resolveInitialExperience
} from "../src/global/initial-experience.js";

test("new user: interactive implicit entry without state opens onboarding", () => {
  assert.equal(
    resolveInitialExperience({
      interactive: true,
      isImplicitCommand: true,
      hasGlobalState: false
    }),
    INITIAL_EXPERIENCE.ONBOARDING
  );
});

test("configured user: interactive implicit entry with state opens dashboard", () => {
  assert.equal(
    resolveInitialExperience({
      interactive: true,
      isImplicitCommand: true,
      hasGlobalState: true
    }),
    INITIAL_EXPERIENCE.DASHBOARD
  );
});

test("non-interactive entry does not select onboarding or dashboard", () => {
  assert.equal(
    resolveInitialExperience({
      interactive: false,
      isImplicitCommand: true,
      hasGlobalState: false
    }),
    null
  );
});

test("explicit command keeps resolver neutral", () => {
  assert.equal(
    resolveInitialExperience({
      interactive: true,
      isImplicitCommand: false,
      hasGlobalState: false
    }),
    null
  );
});

test("hasConfiguredGlobalState is true only when state.json exists", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-initial-state-"));
  assert.equal(hasConfiguredGlobalState(homeDir), false);

  await mkdir(join(homeDir, ".harness"), { recursive: true });
  assert.equal(hasConfiguredGlobalState(homeDir), false);

  await writeFile(join(homeDir, ".harness", "state.json"), "{}\n", "utf8");
  assert.equal(hasConfiguredGlobalState(homeDir), true);

  await writeFile(join(homeDir, ".harness", "profile.json"), "{}\n", "utf8");
  // profile alone never counts as configured
  const homeWithoutState = await mkdtemp(join(tmpdir(), "kairo-initial-profile-"));
  await mkdir(join(homeWithoutState, ".harness"), { recursive: true });
  await writeFile(join(homeWithoutState, ".harness", "profile.json"), "{}\n", "utf8");
  assert.equal(hasConfiguredGlobalState(homeWithoutState), false);
});
