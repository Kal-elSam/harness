// Price bands per provider: a role's tier picks a band inside each provider,
// so distribution rotates providers within one price class instead of
// sending light work to a provider's most expensive model. Bands come from
// list price only, never from hardcoded model names.

const TIERS = ["light", "standard", "demanding"];
// Nearest band when a provider has none for the role: prefer quality (up) first.
const FALLBACK = { light: ["standard", "demanding"], standard: ["demanding", "light"], demanding: ["standard", "light"] };

const keyOf = model => `${model.adapterId}/${model.modelId}`;
const valid = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** List price (input + output per MTok). AA cost per task is a different unit and never substitutes. */
export function listPrice(model) {
  return valid(model?.priceInputPerMTok) && valid(model?.priceOutputPerMTok) ? model.priceInputPerMTok + model.priceOutputPerMTok : null;
}

/**
 * modelKey -> "light" | "standard" | "demanding" | "any". Within each provider
 * the cheapest priced model is light, the priciest demanding and the rest
 * standard; a provider with one price level serves every band. Unpriced
 * models get no band.
 */
export function providerPriceTiers(models) {
  const byProvider = new Map();
  for (const model of models ?? []) {
    const price = listPrice(model);
    if (!model?.adapterId || price == null) continue;
    byProvider.set(model.adapterId, [...(byProvider.get(model.adapterId) ?? []), { model, price }]);
  }
  const tiers = new Map();
  for (const rows of byProvider.values()) {
    const min = Math.min(...rows.map(row => row.price));
    const max = Math.max(...rows.map(row => row.price));
    for (const { model, price } of rows) {
      tiers.set(keyOf(model), min === max ? "any" : price === min ? "light" : price === max ? "demanding" : "standard");
    }
  }
  return tiers;
}

/**
 * Keep, per provider, the pool members in the role's band (or the nearest
 * band that provider has). Bands are computed over `models`, the provider's
 * full priced catalog, not the floor-filtered pool.
 * @returns {{pool: object[], note: string|null}}
 */
export function tierBandPool(pool, models, tier) {
  const wanted = TIERS.includes(tier) ? tier : "standard";
  const tiers = providerPriceTiers(models);
  const providers = [...new Set((pool ?? []).map(model => model.adapterId))];
  const kept = [];
  const notes = [];
  for (const provider of providers) {
    const members = pool.filter(model => model.adapterId === provider);
    const priced = members.filter(model => tiers.has(keyOf(model)));
    if (!priced.length) { kept.push(...members); continue; }
    const inBand = band => priced.filter(model => [band, "any"].includes(tiers.get(keyOf(model))));
    const band = [wanted, ...FALLBACK[wanted]].find(candidate => inBand(candidate).length);
    if (band !== wanted) notes.push(`${provider} has no ${wanted} model in the pool; using its ${band} band`);
    kept.push(...inBand(band));
  }
  return { pool: kept, note: notes.length ? `${notes.join("; ")}.` : null };
}
