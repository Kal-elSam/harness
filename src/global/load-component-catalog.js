import { readFileSync } from "node:fs";
import { createManagedSectionBuilder } from "./component-builders.js";
import { normalizeCatalogDocument } from "./component-manifest.js";

const defaultCatalogUrl = new URL("../../global-template/components/catalog.json", import.meta.url);

export function readComponentCatalogDocument(catalogUrl = defaultCatalogUrl) {
  return JSON.parse(readFileSync(catalogUrl, "utf8"));
}

export function loadComponentCatalog(catalogUrl = defaultCatalogUrl) {
  const catalog = readComponentCatalogDocument(catalogUrl);
  const { components } = normalizeCatalogDocument(catalog, {
    source: "bundled",
    requireDefaultEnabled: true
  });

  return components.map((entry) => ({
    ...entry,
    source: "bundled",
    buildManagedSection: createManagedSectionBuilder(entry.id, entry)
  }));
}
