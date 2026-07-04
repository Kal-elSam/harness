import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashBuffer } from "../hash.js";
import { buildManagedBody } from "./managed-body.js";
import { hasManagedSection, upsertManagedSection } from "./managed-section.js";
import { resolveComponent } from "./component-registry.js";
import { resolveComponentTemplateDir } from "./component-paths.js";
import { listAdapters } from "./registry.js";

export async function detectGlobalDrift({ homeDir, paths, state, packageRoot, workspaceRoot = null, context }) {
  if (!state) {
    return [{
      name: "~/.harness/state.json",
      status: "missing",
      category: "state",
      detail: 'Not found. Run "harness install" first.'
    }];
  }

  const checks = [
    stateMetadataCheck(state),
    ...await componentAssetDrift({ paths, state, packageRoot, workspaceRoot, context }),
    ...await managedSectionDrift({ homeDir, state, context }),
    ...await componentSectionDrift({ homeDir, state, workspaceRoot, context }),
    ...await adapterConfigDrift({ homeDir, state, context })
  ];

  return checks;
}

export function hasRepairableDrift(checks) {
  return checks.some((check) => check.status === "missing" || check.status === "stale");
}

export function driftChecksToDoctor(checks) {
  return checks;
}

function stateMetadataCheck(state) {
  return {
    name: "~/.harness/state.json",
    status: "ok",
    category: "state",
    detail: `cliVersion=${state.cliVersion ?? "unknown"}, adapters=${state.adapters?.length ?? 0}, components=${state.components?.length ?? 0}`
  };
}

async function componentAssetDrift({ paths, state, packageRoot, workspaceRoot, context }) {
  const checks = [];
  const installedComponents = context.components;

  for (const component of installedComponents) {
    const templateDir = resolveComponentTemplateDir(component, { packageRoot, workspaceRoot });
    if (!existsSync(templateDir)) continue;

    for (const assetFile of component.assetFiles) {
      const relativePath = `components/${component.id}/${assetFile}`;
      const templatePath = join(templateDir, assetFile);
      const destinationPath = join(paths.root, relativePath);
      const templateContent = await readFile(templatePath);
      const expectedHash = hashBuffer(templateContent);

      if (!existsSync(destinationPath)) {
        checks.push({
          name: `~/.harness/${relativePath}`,
          status: "missing",
          category: "component_asset",
          componentId: component.id,
          detail: "Component asset missing on disk."
        });
        continue;
      }

      const diskContent = await readFile(destinationPath);
      const diskHash = hashBuffer(diskContent);
      const trackedHash = state.coreFiles?.[relativePath];

      if (diskHash !== expectedHash) {
        checks.push({
          name: `~/.harness/${relativePath}`,
          status: "stale",
          category: "component_asset",
          componentId: component.id,
          detail: `Asset hash drift (disk ${diskHash.slice(0, 8)} vs template ${expectedHash.slice(0, 8)}).`
        });
      } else if (trackedHash && trackedHash !== expectedHash) {
        checks.push({
          name: `~/.harness/${relativePath}`,
          status: "stale",
          category: "component_asset",
          componentId: component.id,
          detail: "State hash drift. Run harness sync to refresh metadata."
        });
      } else {
        checks.push({
          name: `~/.harness/${relativePath}`,
          status: "ok",
          category: "component_asset",
          componentId: component.id,
          detail: `hash=${expectedHash.slice(0, 8)}`
        });
      }
    }
  }

  return checks;
}

async function managedSectionDrift({ homeDir, state, context }) {
  const checks = [];
  const installedAdapterIds = new Set(state.adapters?.map((entry) => entry.id) ?? []);

  for (const adapter of listAdapters()) {
    if (!installedAdapterIds.has(adapter.id)) continue;

    const configFile = adapter.assets.configFile;
    const configPath = join(homeDir, configFile);
    const checkName = `managed-section:${configFile}`;

    if (!existsSync(configPath)) {
      checks.push({
        name: checkName,
        status: "missing",
        category: "managed_section",
        adapterId: adapter.id,
        configFile,
        detail: `Installed adapter config missing: ~/${configFile}`
      });
      continue;
    }

    const content = await readFile(configPath, "utf8");
    const expectedBody = buildManagedBody(context, { id: adapter.id, assets: adapter.assets });
    const sectionStatus = classifyManagedSection(content, expectedBody);

    checks.push({
      name: checkName,
      status: sectionStatus,
      category: "managed_section",
      adapterId: adapter.id,
      configFile,
      detail: managedSectionDetail(sectionStatus, configFile)
    });
  }

  return checks;
}

async function componentSectionDrift({ homeDir, state, workspaceRoot, context }) {
  const checks = [];

  for (const stateEntry of state.components ?? []) {
    const component = resolveComponent(stateEntry.id, { workspaceRoot });
    const heading = componentSectionHeading(component);

    for (const configFile of stateEntry.managedTargets ?? []) {
      const configPath = join(homeDir, configFile);
      const checkName = `component-section:${component.id}:${configFile}`;

      if (!existsSync(configPath)) {
        checks.push({
          name: checkName,
          status: "missing",
          category: "component_section",
          componentId: component.id,
          configFile,
          detail: `Managed target missing: ~/${configFile}`
        });
        continue;
      }

      const content = await readFile(configPath, "utf8");
      let status = "ok";

      if (!hasManagedSection(content)) {
        status = "missing";
      } else if (!content.includes(heading)) {
        status = "stale";
      }

      checks.push({
        name: checkName,
        status,
        category: "component_section",
        componentId: component.id,
        configFile,
        detail: componentSectionDetail(status, component.id, configFile)
      });
    }
  }

  return checks;
}

async function adapterConfigDrift({ homeDir, state, context }) {
  const checks = [];

  for (const adapter of listAdapters()) {
    const stateEntry = state.adapters?.find((entry) => entry.id === adapter.id);
    const detected = adapter.detect(context);
    const isRelevant = detected || Boolean(stateEntry);

    if (!isRelevant) {
      checks.push({
        name: `agent:${adapter.id}`,
        status: "warning",
        category: "adapter",
        adapterId: adapter.id,
        detail: "Not detected on this machine."
      });
      continue;
    }

    if (!stateEntry) continue;

    const configPath = join(homeDir, adapter.assets.configFile);
    if (!existsSync(configPath)) {
      checks.push({
        name: `agent:${adapter.id}`,
        status: "missing",
        category: "adapter",
        adapterId: adapter.id,
        detail: `Installed in state but config missing: ~/${adapter.assets.configFile}`
      });
    }
  }

  return checks;
}

function classifyManagedSection(content, expectedBody) {
  if (!hasManagedSection(content)) return "missing";

  const { changed } = upsertManagedSection(content, expectedBody);
  return changed ? "stale" : "ok";
}

function managedSectionDetail(status, configFile) {
  switch (status) {
    case "missing":
      return `No managed section in ~/${configFile}. Run "harness sync".`;
    case "stale":
      return `Stale managed section in ~/${configFile}. Run "harness sync".`;
    default:
      return `Managed section in sync at ~/${configFile}`;
  }
}

function componentSectionDetail(status, componentId, configFile) {
  switch (status) {
    case "missing":
      return `Missing managed section for ${componentId} in ~/${configFile}`;
    case "stale":
      return `Stale managed section for ${componentId} in ~/${configFile}`;
    default:
      return `Component section in sync for ${componentId} in ~/${configFile}`;
  }
}

function componentSectionHeading(component) {
  return `### ${component.label}`;
}
