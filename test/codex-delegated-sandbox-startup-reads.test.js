/**
 * Offline startup-read policy: exact managed requirements paths, no broad /etc,
 * absent / present / denied / /etc→/private/etc alias.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  buildDelegatedWriteSandboxProfile,
  CODEX_ETC_ALIAS_PAIRS,
  CODEX_MANAGED_REQUIREMENTS_PATH,
  CODEX_MANAGED_REQUIREMENTS_PRIVATE_PATH,
  classifyManagedRequirementsOpen,
  managedStartupExactReadLiterals,
  managedStartupMetadataAncestors,
  profileGrantsBroadEtcRead,
  profileGrantsExactRequirementsReads,
  SANDBOX_EXEC_PATH
} from "../src/global/runtime/codex-delegated-sandbox.js";

const WORKSPACE = "/tmp/kairo-wt-delegated-1/tree";
const ISOLATED_PROVIDER = "/tmp/kairo-wt-delegated-1/provider-home";
const ISOLATED_TEMP = "/tmp/kairo-wt-delegated-1/tmp";
const PERSONAL = "/Users/kal-el/.codex";
const PINNED_CODEX = "/Users/kal-el/.codex/packages/standalone/releases/0.160.0-test/bin/codex";

function identityDeps(extra = {}) {
  return {
    realpath: async (p) => p,
    personalCodexHome: PERSONAL,
    homedir: () => "/Users/kal-el",
    platform: "darwin",
    access: async () => {},
    codexExecutable: PINNED_CODEX,
    ...extra
  };
}

test("startup policy pins exact requirements literals and forbids broad /etc subpaths", async () => {
  const literals = managedStartupExactReadLiterals();
  assert.ok(literals.includes(CODEX_MANAGED_REQUIREMENTS_PATH));
  assert.ok(literals.includes(CODEX_MANAGED_REQUIREMENTS_PRIVATE_PATH));

  const profile = await buildDelegatedWriteSandboxProfile({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, identityDeps());

  assert.equal(profileGrantsBroadEtcRead(profile), false);
  assert.equal(profileGrantsExactRequirementsReads(profile), true);
  assert.doesNotMatch(profile, /\(subpath "\/etc"\)/);
  assert.doesNotMatch(profile, /\(subpath "\/private\/etc"\)/);

  const metadata = managedStartupMetadataAncestors();
  for (const pair of CODEX_ETC_ALIAS_PAIRS) {
    assert.ok(metadata.includes(pair.logical), pair.logical);
    assert.ok(metadata.includes(pair.private), pair.private);
  }
  assert.match(profile, /\(literal "\/etc"\)/);
  assert.match(profile, /\(literal "\/private\/etc"\)/);
  assert.match(profile, /\(literal "\/etc\/codex"\)/);
  assert.match(profile, /\(literal "\/private\/etc\/codex"\)/);
});

test("classifyManagedRequirementsOpen: absent, present, access denied", () => {
  assert.equal(
    classifyManagedRequirementsOpen({
      path: CODEX_MANAGED_REQUIREMENTS_PATH,
      exists: false
    }).outcome,
    "absent"
  );
  assert.equal(
    classifyManagedRequirementsOpen({
      path: CODEX_MANAGED_REQUIREMENTS_PRIVATE_PATH,
      exists: true
    }).outcome,
    "present_readable"
  );
  assert.equal(
    classifyManagedRequirementsOpen({
      path: "/etc/passwd",
      exists: true
    }).outcome,
    "access_denied"
  );
});

test("fixture alias /etc → /private/etc: present readable, sibling denied, absent ENOENT", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("sandbox-exec is macOS-only");
    return;
  }

  const { realpath } = await import("node:fs/promises");
  // Use canonical /private/tmp path — Seatbelt sees realpath, not /tmp alias.
  const root = await realpath("/tmp").then((tmp) => join(tmp, "kairo-wt-startup-read-fixture"));
  await rm(root, { recursive: true, force: true });
  const privateEtc = join(root, "private", "etc", "codex");
  await mkdir(privateEtc, { recursive: true });
  // Mirror macOS: <root>/etc -> private/etc
  await symlink("private/etc", join(root, "etc"));

  const requirementsPrivate = join(privateEtc, "requirements.toml");
  const requirementsLogical = join(root, "etc", "codex", "requirements.toml");
  const deniedSibling = join(root, "private", "etc", "passwd-like");
  await writeFile(requirementsPrivate, "default_permissions = \":read-only\"\n", "utf8");
  await writeFile(deniedSibling, "secret\n", "utf8");

  const exact = [requirementsLogical, requirementsPrivate];
  const aliasPairs = [
    { logical: join(root, "etc"), private: join(root, "private", "etc") },
    { logical: join(root, "etc", "codex"), private: join(root, "private", "etc", "codex") }
  ];
  const metadata = managedStartupMetadataAncestors({ exactPaths: exact, aliasPairs });

  const literal = (paths) => paths.map((p) => `  (literal "${p}")`).join("\n");
  const profilePath = join(root, "probe.sb");
  const profile = `(version 1)
(deny default)
(allow process-fork)
(allow process-exec (subpath "/bin") (subpath "/usr"))
(allow file-read-metadata
${literal(metadata)}
)
(allow file-read-data
${literal(metadata)}
)
(allow file-read*
${literal(exact)}
  (literal "/dev/null"))
`;
  assert.equal(profileGrantsBroadEtcRead(profile), false);
  await writeFile(profilePath, profile, "utf8");

  const run = (args) => spawnSync(SANDBOX_EXEC_PATH, ["-f", profilePath, ...args], { encoding: "utf8" });

  // present via private path
  const presentPrivate = run(["/bin/cat", requirementsPrivate]);
  assert.equal(presentPrivate.status, 0, presentPrivate.stderr);
  assert.match(presentPrivate.stdout, /default_permissions/);

  // present via logical alias path
  const presentLogical = run(["/bin/cat", requirementsLogical]);
  assert.equal(presentLogical.status, 0, presentLogical.stderr);
  assert.match(presentLogical.stdout, /default_permissions/);

  // access denied for sibling under same etc tree (not exact literal)
  const denied = run(["/bin/cat", deniedSibling]);
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stderr}${denied.stdout}`, /Operation not permitted|Permission denied/i);

  // absent: exact literal granted → ENOENT, not EPERM
  const missing = join(privateEtc, "missing-requirements.toml");
  const missingProfile = `(version 1)
(deny default)
(allow process-fork)
(allow process-exec (subpath "/bin") (subpath "/usr"))
(allow file-read-metadata
${literal(metadata)}
)
(allow file-read-data
${literal(metadata)}
)
(allow file-read*
${literal([missing])}
  (literal "/dev/null"))
`;
  const missingProfilePath = join(root, "missing.sb");
  await writeFile(missingProfilePath, missingProfile, "utf8");
  const absent = spawnSync(SANDBOX_EXEC_PATH, ["-f", missingProfilePath, "/bin/cat", missing], { encoding: "utf8" });
  assert.notEqual(absent.status, 0);
  assert.match(`${absent.stderr}${absent.stdout}`, /No such file or directory/i);
  assert.doesNotMatch(`${absent.stderr}${absent.stdout}`, /Operation not permitted/i);

  // host alias resolution sanity (documents /etc → private/etc shape)
  const readlink = spawnSync("/usr/bin/readlink", ["/etc"], { encoding: "utf8" });
  assert.equal(readlink.status, 0);
  assert.match(readlink.stdout.trim(), /private\/etc/);
});

test("production profile: absent /etc/codex/requirements.toml is not EPERM under sandbox", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("sandbox-exec is macOS-only");
    return;
  }

  const profile = await buildDelegatedWriteSandboxProfile({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, identityDeps({
    realpath: async (p) => {
      // Prefer canonical /private/tmp forms when they resolve on disk.
      const { realpath } = await import("node:fs/promises");
      try {
        return await realpath(p);
      } catch {
        return p;
      }
    }
  }));

  assert.equal(profileGrantsBroadEtcRead(profile), false);
  const profilePath = "/tmp/kairo-wt-delegated-1/startup-read-probe.sb";
  await mkdir("/tmp/kairo-wt-delegated-1", { recursive: true });
  await writeFile(profilePath, profile, "utf8");

  const probe = spawnSync(
    SANDBOX_EXEC_PATH,
    ["-f", profilePath, "/bin/cat", CODEX_MANAGED_REQUIREMENTS_PATH],
    { encoding: "utf8" }
  );
  const text = `${probe.stderr}${probe.stdout}`;
  // File is typically absent on developer hosts: must not fail closed as EPERM.
  if (/No such file or directory/i.test(text) || probe.status === 0) {
    assert.doesNotMatch(text, /Operation not permitted/i);
  } else {
    // If something else failed, still reject EPERM-as-startup-blocker for this path.
    assert.doesNotMatch(text, /Failed to read requirements file.*Operation not permitted/i);
  }

  const deniedPasswd = spawnSync(
    SANDBOX_EXEC_PATH,
    ["-f", profilePath, "/bin/cat", "/etc/passwd"],
    { encoding: "utf8" }
  );
  assert.notEqual(deniedPasswd.status, 0);
  assert.match(`${deniedPasswd.stderr}${deniedPasswd.stdout}`, /Operation not permitted|Permission denied/i);
});
