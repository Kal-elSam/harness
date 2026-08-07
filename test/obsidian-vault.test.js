import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KAIRO_VAULT_SUBDIR,
  normalizeVaultPath,
  isAllowedKairoNoteName,
  resolveKairoNotePath,
  assertInsideKairoRoot,
  inspectObsidianVault
} from "../src/global/observability/obsidian-vault.js";

async function withVault(fn) {
  const root = await mkdtemp(join(tmpdir(), "kairo-obsidian-"));
  try {
    await mkdir(join(root, KAIRO_VAULT_SUBDIR, "projects"), { recursive: true });
    await writeFile(join(root, KAIRO_VAULT_SUBDIR, "projects", "alpha.md"), "# Alpha\n", "utf8");
    await writeFile(join(root, KAIRO_VAULT_SUBDIR, "readme.md"), "# Hub\n", "utf8");
    await mkdir(join(root, ".obsidian"), { recursive: true });
    await writeFile(join(root, ".obsidian", "app.json"), "{}", "utf8");
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("normalizeVaultPath requires absolute paths", () => {
  assert.equal(normalizeVaultPath("").ok, false);
  assert.equal(normalizeVaultPath("relative/vault").ok, false);
  assert.equal(normalizeVaultPath("/tmp/vault").ok, true);
});

test("note name guards reject secrets and non-markdown", () => {
  assert.equal(isAllowedKairoNoteName("ok.md"), true);
  assert.equal(isAllowedKairoNoteName(".env.md"), false);
  assert.equal(isAllowedKairoNoteName("secrets.md"), false);
  assert.equal(isAllowedKairoNoteName("note.txt"), false);
});

test("resolveKairoNotePath blocks traversal and excluded segments", () => {
  const root = "/tmp/vault/Kairo";
  assert.equal(resolveKairoNotePath(root, "../escape.md").ok, false);
  assert.equal(resolveKairoNotePath(root, ".obsidian/x.md").ok, false);
  assert.equal(resolveKairoNotePath(root, "projects/alpha.md").ok, true);
});

test("inspect: available notes under Kairo/; never lists .obsidian", async () => {
  await withVault(async (vault) => {
    const out = await inspectObsidianVault({ vaultPath: vault });
    assert.equal(out.state, "available");
    assert.equal(out.vaultPath, await realpath(vault));
    assert.ok(out.notes.some((n) => n.relativePath === "readme.md"));
    assert.ok(out.notes.some((n) => n.relativePath === "projects/alpha.md"));
    assert.ok(!JSON.stringify(out).includes(".obsidian"));
  });
});

test("inspect: missing vault / missing Kairo/ / relative path", async () => {
  const missing = await inspectObsidianVault({ vaultPath: join(tmpdir(), "no-such-vault-xyz") });
  assert.equal(missing.state, "missing");

  const root = await mkdtemp(join(tmpdir(), "kairo-obsidian-empty-"));
  try {
    const partial = await inspectObsidianVault({ vaultPath: root });
    assert.equal(partial.state, "partial");
    assert.match(partial.diagnostics[0] ?? "", /Kairo\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const bad = await inspectObsidianVault({ vaultPath: "not/absolute" });
  assert.equal(bad.state, "unavailable");
});

test("inspect: excludes attachments and secret filenames; refuses escaping symlink", async () => {
  await withVault(async (vault) => {
    await mkdir(join(vault, KAIRO_VAULT_SUBDIR, "attachments"), { recursive: true });
    await writeFile(join(vault, KAIRO_VAULT_SUBDIR, "attachments", "x.md"), "nope", "utf8");
    await writeFile(join(vault, KAIRO_VAULT_SUBDIR, "token.md"), "secret", "utf8");

    const outside = await mkdtemp(join(tmpdir(), "kairo-obsidian-out-"));
    try {
      await writeFile(join(outside, "leak.md"), "leak", "utf8");
      await symlink(outside, join(vault, KAIRO_VAULT_SUBDIR, "escape-link"));

      const out = await inspectObsidianVault({ vaultPath: vault });
      assert.equal(out.state, "available");
      assert.ok(!out.notes.some((n) => /attachments|token|leak|escape/i.test(n.relativePath)));
      assert.ok(out.diagnostics.some((d) => /symlink|unsafe/i.test(d)));

      const escaped = await assertInsideKairoRoot(
        join(vault, KAIRO_VAULT_SUBDIR, "escape-link", "leak.md"),
        join(vault, KAIRO_VAULT_SUBDIR)
      );
      assert.equal(escaped.ok, false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("inspect: vault root symlink refused; Kairo/ symlink refused", async () => {
  const real = await mkdtemp(join(tmpdir(), "kairo-obsidian-real-"));
  const parent = await mkdtemp(join(tmpdir(), "kairo-obsidian-parent-"));
  try {
    await mkdir(join(real, KAIRO_VAULT_SUBDIR), { recursive: true });
    const linkVault = join(parent, "linked-vault");
    await symlink(real, linkVault);
    const vaultSym = await inspectObsidianVault({ vaultPath: linkVault });
    assert.equal(vaultSym.state, "error");
    assert.match(vaultSym.error ?? "", /symlink/);

    const vault = await mkdtemp(join(tmpdir(), "kairo-obsidian-ksym-"));
    const target = await mkdtemp(join(tmpdir(), "kairo-obsidian-ktgt-"));
    try {
      await symlink(target, join(vault, KAIRO_VAULT_SUBDIR));
      const kairoSym = await inspectObsidianVault({ vaultPath: vault });
      assert.equal(kairoSym.state, "error");
      assert.match(kairoSym.error ?? "", /symlink/);
    } finally {
      await rm(vault, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  } finally {
    await rm(real, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});
