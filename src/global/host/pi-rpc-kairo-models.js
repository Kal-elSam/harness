/**
 * Cycle / select among Kairo provider models (projectTeam routes only).
 */

const KAIRO_PROVIDER_ID = "kairo";

/**
 * @param {object[]|null|undefined} models
 * @param {string|null|undefined} currentModelId
 * @returns {object|null}
 */
export function pickNextKairoModel(models, currentModelId) {
  if (!Array.isArray(models) || models.length === 0) return null;
  if (models.length === 1) return models[0];
  const idx = models.findIndex((m) => m?.id === currentModelId);
  const nextIdx = idx < 0 ? 0 : (idx + 1) % models.length;
  return models[nextIdx] ?? null;
}

/**
 * @param {object} model - entry from buildKairoProviderModels
 * @returns {{ provider: string, modelId: string }}
 */
export function kairoSetModelCommand(model) {
  const modelId = typeof model?.id === "string" ? model.id : "";
  if (!modelId) {
    throw new Error("Kairo model id is missing");
  }
  return { type: "set_model", provider: KAIRO_PROVIDER_ID, modelId };
}

/**
 * @param {object|null|undefined} model - Pi Model object from get_state / set_model
 * @returns {string}
 */
export function formatEngineModelLabel(model) {
  if (!model || typeof model !== "object") return "no model";
  const id = typeof model.id === "string" ? model.id : "";
  const name = typeof model.name === "string" ? model.name.trim() : "";
  if (name && id && name !== id) return `${name} (${id})`;
  if (id) return id;
  if (name) return name;
  return "no model";
}

export { KAIRO_PROVIDER_ID };
