import {
  BACKEND_IDS,
  OPENCODE_GO_BASE_URL,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL
} from "../types.js";
import {
  createOpencodeCatalogBackend,
  goCostClassForModel,
  zenCostClassForModel
} from "./opencode-catalog.js";

export function createOpencodeGoBackend({
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiKey = null,
  baseUrl = OPENCODE_GO_BASE_URL,
  collectCliEvidence
} = {}) {
  return createOpencodeCatalogBackend({
    id: BACKEND_IDS.OPENCODE_GO,
    label: "OpenCode Go",
    product: "go",
    baseUrl,
    defaultModelId: OPENCODE_GO_DEFAULT_MODEL,
    costClassForModel: goCostClassForModel,
    env,
    fetchImpl,
    apiKey,
    collectCliEvidence
  });
}

export function createOpencodeZenBackend({
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiKey = null,
  baseUrl = OPENCODE_ZEN_BASE_URL,
  collectCliEvidence
} = {}) {
  return createOpencodeCatalogBackend({
    id: BACKEND_IDS.OPENCODE_ZEN,
    label: "OpenCode Zen",
    product: "zen",
    baseUrl,
    defaultModelId: OPENCODE_ZEN_DEFAULT_FREE_MODEL,
    costClassForModel: zenCostClassForModel,
    env,
    fetchImpl,
    apiKey,
    collectCliEvidence
  });
}
