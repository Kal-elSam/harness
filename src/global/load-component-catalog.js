import { readFileSync } from "node:fs";
import { createManagedSectionBuilder } from "./component-builders.js";

const defaultCatalogUrl = new URL("../../global-template/components/catalog.json", import.meta.url);

function validateCatalogEntry(entry) {
  const required = ["id", "label", "version", "defaultEnabled", "assetFiles"];

  for (const field of required) {
    if (entry[field] === undefined) {
      throw new Error(`Component catalog entry is missing "${field}".`);
    }
  }

  if (!Array.isArray(entry.assetFiles) || entry.assetFiles.length === 0) {
    throw new Error(`Component "${entry.id}" must declare at least one asset file.`);
  }
}

export function readComponentCatalogDocument(catalogUrl = defaultCatalogUrl) {
  return JSON.parse(readFileSync(catalogUrl, "utf8"));
}

export function loadComponentCatalog(catalogUrl = defaultCatalogUrl) {
  const catalog = readComponentCatalogDocument(catalogUrl);

  return catalog.components.map((entry) => {
    validateCatalogEntry(entry);

    return {
      id: entry.id,
      label: entry.label,
      version: entry.version,
      source: "bundled",
      defaultEnabled: entry.defaultEnabled,
      assetFiles: [...entry.assetFiles],
      adapterHints: { ...(entry.adapterHints ?? {}) },
      buildManagedSection: createManagedSectionBuilder(entry.id, entry)
    };
  });
}
