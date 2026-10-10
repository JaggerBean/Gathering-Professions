// Campaign pricing (0.32.0, user-approved): gold is worth twice the standard
// (a skilled hireling earns 1 gp a day), so book prices are halved, and the
// module's own goods follow tier bands matched to bounty pay.
//   Materials (per unit):  T1 5 cp–1.5 sp · T2 1.5–4.5 sp · T3 5 sp–1.5 gp · T4 2–6 gp · T5 7.5–22.5 gp
//   Rare finds:            T1 1–3 gp · T2 3–8 · T3 8–20 · T4 20–50 · T5 50–100 gp
//   Refined goods:         ingredients + 25% (per unit made)
// Within a band, items keep their old order (cheapest old price at the bottom).
// Items entering the world or an actor from any compendium are halved once
// (flag campaignPrice), so drag-and-drop and Item Piles merchants follow too.
import { MODULE_ID } from "./rules.js";

export const PRICE_FACTOR = 0.5;
export const MATERIAL_BANDS = Object.freeze([[0.05, 0.15], [0.15, 0.45], [0.5, 1.5], [2, 6], [7.5, 22.5]]);
export const RARE_BANDS = Object.freeze([[1, 3], [3, 8], [8, 20], [20, 50], [50, 100]]);
export const REFINED_MARGIN = 1.25;
export const PRICED_FLAG = "campaignPrice";

const RATE = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };

/** A dnd5e price {value, denomination} in gp. */
export function priceInGp(price) {
  const value = Number(price?.value);
  return Number.isFinite(value) && value > 0 ? value * (RATE[price?.denomination ?? "gp"] ?? 1) : 0;
}

/** A gp amount as a tidy dnd5e price: cp under 1 sp, sp under 1 gp, then gp (½ gp steps under 10, whole above). */
export function tidyPrice(gp) {
  const amount = Math.max(0, Number(gp) || 0);
  if (!amount) return { value: 0, denomination: "gp" };
  if (amount < 0.1) return { value: Math.max(1, Math.round(amount * 100)), denomination: "cp" };
  if (amount < 1) return { value: Math.max(1, Math.round(amount * 10)), denomination: "sp" };
  if (amount < 10) return { value: Math.round(amount * 2) / 2, denomination: "gp" };
  return { value: Math.round(amount), denomination: "gp" };
}

/** Half (PRICE_FACTOR) of a book price, tidied; free stays free. */
export const campaignPrice = (price, factor = PRICE_FACTOR) => tidyPrice(priceInGp(price) * factor);

/** Position p (0–1) inside a band, on a geometric scale. */
export const inBand = ([low, high], position = 0.5) => low * (high / low) ** Math.min(1, Math.max(0, position));

/**
 * Spread a group of items over a band, keeping their old price order.
 * @param {{key: string, old: number}[]} members
 * @returns {Map<string, number>} key → gp
 */
export function spreadInBand(members, band) {
  const sorted = [...members].sort((a, b) => a.old - b.old || String(a.key).localeCompare(String(b.key)));
  const result = new Map();
  sorted.forEach((member, index) => {
    // Equal old prices share a position (their average rank).
    const first = sorted.findIndex(other => other.old === member.old);
    const last = sorted.length - 1 - [...sorted].reverse().findIndex(other => other.old === member.old);
    const rank = (first + last) / 2;
    result.set(member.key, inBand(band, sorted.length > 1 ? rank / (sorted.length - 1) : 0.5));
  });
  return result;
}

/**
 * Unit cost of each recipe output from its ingredients (+ margin), iterating so
 * refined ingredients (ingots, planks) are priced first. Cheapest recipe wins.
 * @param {{output: string, quantity: number, inputs: [string, number][]}[]} recipes
 * @param {Map<string, number>} known  name → gp for ingredients already priced
 */
export function recipeCosts(recipes, known, margin = REFINED_MARGIN) {
  const prices = new Map(known);
  const outputs = new Map();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const row of recipes) {
      if (!row.inputs.every(([name]) => prices.has(name))) continue;
      const unit = row.inputs.reduce((sum, [name, quantity]) => sum + prices.get(name) * quantity, 0) * margin / Math.max(1, row.quantity);
      const best = outputs.has(row.output) ? Math.min(outputs.get(row.output), unit) : unit;
      if (outputs.get(row.output) !== best) { outputs.set(row.output, best); changed = true; }
      if (!known.has(row.output)) prices.set(row.output, outputs.get(row.output));
    }
    if (!changed) break;
  }
  return outputs;
}

/* ---------------------------------------------------------------------- */
/* Entry rule: compendium items come in at campaign price                  */
/* ---------------------------------------------------------------------- */

const compendiumSource = data => data?._stats?.compendiumSource || data?.flags?.core?.sourceId || "";

/**
 * preCreateItem: an item coming from a compendium (dragged, imported, or bought
 * from an Item Piles merchant stocked from one) is priced at PRICE_FACTOR × book,
 * once. Items already flagged keep their price (copies between actors).
 */
export function priceOnCreate(item, data) {
  if (data?.flags?.[MODULE_ID]?.[PRICED_FLAG]) return;
  const source = compendiumSource(data);
  if (!source.startsWith("Compendium.")) return;
  const price = foundry.utils.getProperty(data, "system.price");
  if (!price || !priceInGp(price)) return;
  item.updateSource({ "system.price": campaignPrice(price), [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { book: { value: price.value, denomination: price.denomination ?? "gp" } } });
}

export function registerPricingHooks() {
  Hooks.on("preCreateItem", (item, data) => { try { priceOnCreate(item, data); } catch (error) { console.error(`${MODULE_ID}: campaign price failed`, error); } });
}

/** Changes that set an item's campaign price and mark it priced. */
export const priceChanges = (gp, book = null) => ({ "system.price": tidyPrice(gp), [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { book } });
