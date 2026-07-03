import test from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_END,
  SECTION_START,
  hasManagedSection,
  removeManagedSection,
  upsertManagedSection
} from "../src/global/managed-section.js";

test("adds a managed section to an empty file", () => {
  const { content, hadSection } = upsertManagedSection("", "body line");

  assert.equal(hadSection, false);
  assert.ok(content.startsWith(SECTION_START));
  assert.ok(content.includes("body line"));
  assert.ok(content.trimEnd().endsWith(SECTION_END));
});

test("preserves user content around the managed section", () => {
  const user = "# My config\n\nuser rules here\n";
  const { content } = upsertManagedSection(user, "managed body");

  assert.ok(content.startsWith("# My config"));
  assert.ok(content.includes("user rules here"));
  assert.ok(content.includes("managed body"));
});

test("replaces only the managed section on re-run", () => {
  const first = upsertManagedSection("before\n", "v1").content;
  const withTail = `${first}\nafter\n`;
  const second = upsertManagedSection(withTail, "v2");

  assert.equal(second.hadSection, true);
  assert.ok(second.content.includes("before"));
  assert.ok(second.content.includes("after"));
  assert.ok(second.content.includes("v2"));
  assert.ok(!second.content.includes("v1"));
});

test("is idempotent when the body does not change", () => {
  const first = upsertManagedSection("user\n", "same body");
  const second = upsertManagedSection(first.content, "same body");

  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("removes the managed section and keeps user content", () => {
  const withSection = upsertManagedSection("keep me\n", "managed").content;
  const { content, removed } = removeManagedSection(`${withSection}\nand me\n`);

  assert.equal(removed, true);
  assert.ok(!hasManagedSection(content));
  assert.ok(content.includes("keep me"));
  assert.ok(content.includes("and me"));
});

test("remove is a no-op without a managed section", () => {
  const { content, removed } = removeManagedSection("plain\n");

  assert.equal(removed, false);
  assert.equal(content, "plain\n");
});
