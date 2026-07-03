import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { backupFileBeforeChange } from "./backups.js";
import { buildManagedBody } from "./managed-body.js";
import { hasManagedSection, removeManagedSection, upsertManagedSection } from "./managed-section.js";

export function createManagedConfigAdapter({ id, label, rootDir, configFile }) {
  const assets = {
    rootDir,
    configFile,
    managedTargets: [configFile]
  };

  return {
    id,
    label,
    assets,

    detect(context) {
      return existsSync(join(context.homeDir, rootDir));
    },

    plan(context) {
      const configPath = join(context.homeDir, configFile);
      const exists = existsSync(configPath);
      const current = exists ? readFileSync(configPath, "utf8") : "";
      const body = buildManagedBody(context, { id, assets });
      const { changed } = upsertManagedSection(current, body);

      let action = "unchanged";
      if (changed) action = exists ? "update" : "create";

      return {
        adapterId: id,
        configFile,
        configPath,
        action,
        exists,
        backupNeeded: exists && changed
      };
    },

    async apply(context, plan) {
      if (plan.action === "unchanged") {
        return { configFile, action: "unchanged", backupPath: null };
      }

      const current = plan.exists ? await readFile(plan.configPath, "utf8") : "";
      const body = buildManagedBody(context, { id, assets });
      const { content: next } = upsertManagedSection(current, body);
      let backupPath = null;

      if (plan.backupNeeded) {
        backupPath = await backupFileBeforeChange({
          backupsDir: context.paths.backupsDir,
          homeDir: context.homeDir,
          filePath: plan.configPath,
          timestamp: context.timestamp,
          dryRun: context.dryRun
        });
      }

      if (!context.dryRun) {
        await mkdir(dirname(plan.configPath), { recursive: true });
        await writeFile(plan.configPath, next, "utf8");
      }

      return { configFile, action: plan.action, backupPath };
    },

    async doctor(context, stateEntry) {
      const installed = Boolean(stateEntry);
      const detected = this.detect(context);
      const isRelevant = detected || installed;

      if (!isRelevant) {
        return {
          name: `agent:${id}`,
          status: "info",
          detail: "Not detected on this machine."
        };
      }

      const configPath = join(context.homeDir, configFile);
      if (!existsSync(configPath)) {
        return {
          name: `agent:${id}`,
          status: installed ? "missing" : "warning",
          detail: `Config not found: ~/${configFile}`
        };
      }

      const content = await readFile(configPath, "utf8");
      const managed = hasManagedSection(content);

      return {
        name: `agent:${id}`,
        status: managed ? "ok" : "warning",
        detail: managed
          ? `Managed section present in ~/${configFile}`
          : `No managed section in ~/${configFile}. Run "harness install".`
      };
    },

    async uninstall(context, stateEntry) {
      const configPath = join(context.homeDir, configFile);
      if (!existsSync(configPath)) {
        return { configFile, cleaned: false, backupPath: null };
      }

      const content = await readFile(configPath, "utf8");
      const { content: cleaned, removed } = removeManagedSection(content);
      if (!removed) {
        return { configFile, cleaned: false, backupPath: null };
      }

      const backupPath = await backupFileBeforeChange({
        backupsDir: context.paths.backupsDir,
        homeDir: context.homeDir,
        filePath: configPath,
        timestamp: context.timestamp,
        dryRun: context.dryRun
      });

      if (!context.dryRun) {
        await writeFile(configPath, cleaned, "utf8");
      }

      return { configFile, cleaned: true, backupPath };
    }
  };
}
