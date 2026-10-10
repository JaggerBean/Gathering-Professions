// Campaign pricing (0.32.0, user-approved): gold is worth twice the standard
// (a skilled hireling earns 1 gp a day), so book prices are halved, and the
// module's own goods follow tier bands matched to bounty pay.
// Only silver and gold are used (0.32.1): nothing costs less than 1 sp.
//   Materials (per unit):  T1 1–2 sp · T2 1.5–4.5 sp · T3 5 sp–1.5 gp · T4 2–6 gp · T5 7.5–22.5 gp
//   Rare finds:            T1 1–3 gp · T2 3–8 · T3 8–20 · T4 20–50 · T5 50–100 gp
//   Refined goods:         ingredients + 25% (per unit made)
// Within a band, items keep their old order (cheapest old price at the bottom).
// Items entering the world or an actor from any compendium are halved once
// (flag campaignPrice), so drag-and-drop and Item Piles merchants follow too.
import { MODULE_ID } from "./rules.js";

export const PRICE_FACTOR = 0.5;
export const MATERIAL_BANDS = Object.freeze([[0.1, 0.2], [0.15, 0.45], [0.5, 1.5], [2, 6], [7.5, 22.5]]);
export const RARE_BANDS = Object.freeze([[1, 3], [3, 8], [8, 20], [20, 50], [50, 100]]);
export const REFINED_MARGIN = 1.25;
export const PRICED_FLAG = "campaignPrice";

const RATE = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };

/** A dnd5e price {value, denomination} in gp. */
export function priceInGp(price) {
  const value = Number(price?.value);
  return Number.isFinite(value) && value > 0 ? value * (RATE[price?.denomination ?? "gp"] ?? 1) : 0;
}

/** Round upward to whole silver; fractional gold represents gold and silver only. */
export function tidyPrice(gp) {
  const amount = Math.max(0, Number(gp) || 0);
  if (!amount) return { value: 0, denomination: "gp" };
  const silver = Math.max(1, Math.ceil(amount * 10 - 1e-9));
  return silver < 10 ? { value: silver, denomination: "sp" } : { value: silver / 10, denomination: "gp" };
}

/** Explicit campaign price approved by the GM, in gp; zero remains a valid override. */
export function approvedPrice(item) {
  const value = item?.getFlag?.(MODULE_ID, PRICED_FLAG)?.approved ?? item?.flags?.[MODULE_ID]?.[PRICED_FLAG]?.approved;
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

/** True when a price uses a coin the campaign doesn't (cp, ep, pp). */
export const oddCoin = price => Boolean(Number(price?.value)) && !["gp", "sp"].includes(price?.denomination ?? "gp");

/**
 * Campaign prices (gp) for standard gear by name, set by type rather than a flat
 * half (user, 0.32.1). Used for items in inventories and any future item with
 * the name. Crafted goods (daggers, arrows, spears…) are priced from recipes.
 */
export const STANDARD_PRICES = Object.freeze({
  // Weapons
  "Crossbow, Hand": 35, "Hand Crossbow": 35, "Crossbow, Light": 12, "Light Crossbow": 12, "Crossbow, Heavy": 25, "Heavy Crossbow": 25,
  "Longbow": 25, "Shortbow": 12, "Rapier": 12, "Scimitar": 12, "Shortsword": 5, "Longsword": 7.5, "Battleaxe": 5, "Greataxe": 15, "Greatsword": 25,
  "Warhammer": 7.5, "Mace": 2.5, "Quarterstaff": 0.2, "Club": 0.1, "Whip": 1, "Javelin": 0.3, "Sling": 0.1,
  // Armour
  "Padded": 2.5, "Padded Armor": 2.5, "Leather": 5, "Leather Armor": 5, "Studded Leather": 22, "Studded Leather Armor": 22, "Hide": 5, "Hide Armor": 5,
  "Chain Shirt": 25, "Scale Mail": 25, "Breastplate": 200, "Half Plate": 375, "Half Plate Armor": 375, "Ring Mail": 15, "Chain Mail": 40, "Splint": 100, "Splint Armor": 100,
  "Plate": 750, "Plate Armor": 750, "Shield": 5,
  // Instruments and tools
  "Fiddle": 12, "Viol": 15, "Lute": 17, "Flute": 1, "Pan Flute": 6, "Drum": 3, "Horn": 1.5, "Lyre": 15, "Bagpipes": 15,
  "Thieves' Tools": 12, "Herbalism Kit": 2.5, "Healer's Kit": 2.5, "Disguise Kit": 12, "Navigator's Tools": 12,
  // Adventuring gear and clothing
  "Backpack": 1, "Bedroll": 0.5, "Blanket": 0.3, "Tinderbox": 0.3, "Waterskin": 0.1, "Oil": 0.1, "Flask of Oil": 0.1, "Lamp": 0.3, "Bullseye Lantern": 5,
  "Hooded Lantern": 2.5, "Crowbar": 1, "Hammer": 0.5, "Piton": 0.1, "Pouch": 0.3, "Quiver": 0.5, "Bell": 0.5, "Mirror": 3, "Steel Mirror": 3, "Signet Ring": 3,
  "Sprig of Mistletoe": 0.5, "Traveler's Clothes": 1, "Clothes, Traveler's": 1, "Common Clothes": 0.3, "Clothes, Common": 0.3, "Fine Clothes": 8, "Clothes, Fine": 8,
  "Costume": 2, "Costume Clothes": 2, "Robe": 0.5, "Robes": 0.5, "Candle": 0.1, "Chalk": 0.1, "Ink": 5, "Paper": 0.1, "Parchment": 0.1, "Soap": 0.1,
  "Torch": 0.1, "Rations": 0.3, "Burger": 0.1
});

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
 * refined ingredients (ingots, planks) are priced first. Most expensive enabled
 * recipe establishes the minimum; final rounded ingredient prices are used.
 * @param {{output: string, quantity: number, inputs: [string, number][]}[]} recipes
 * @param {Map<string, number>} known  name → gp for ingredients already priced
 */
export function recipeCosts(recipes, known, margin = REFINED_MARGIN) {
  assertAcyclicRecipes(recipes);
  const prices = new Map(known);
  const outputs = new Map();
  for (let pass = 0; pass < Math.max(8, recipes.length + 1); pass++) {
    let changed = false;
    for (const row of recipes) {
      if (!row.inputs.every(([name]) => prices.has(name))) continue;
      const unit = row.inputs.reduce((sum, [name, quantity]) => sum + prices.get(name) * quantity, 0) * margin / Math.max(1, row.quantity);
      const best = priceInGp(tidyPrice(Math.max(outputs.get(row.output) ?? 0, known.get(row.output) ?? 0, unit)));
      if (outputs.get(row.output) !== best) { outputs.set(row.output, best); changed = true; }
      prices.set(row.output, outputs.get(row.output));
    }
    if (!changed) break;
  }
  return outputs;
}

/** Reject indirect recipe loops before calculating or persisting prices. */
export function assertAcyclicRecipes(recipes) {
  const dependencies = new Map();
  for (const row of recipes.filter(row => !row.disabled)) {
    const inputs = dependencies.get(row.output) ?? new Set();
    for (const [name] of row.inputs) inputs.add(name);
    dependencies.set(row.output, inputs);
  }
  const visiting = new Set(), visited = new Set();
  const visit = name => {
    if (visiting.has(name)) throw new Error(`Recipe cycle includes "${name}". Remove the circular ingredients before repricing.`);
    if (visited.has(name) || !dependencies.has(name)) return;
    visiting.add(name);
    for (const input of dependencies.get(name)) visit(input);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of dependencies.keys()) visit(name);
}

/** Recover a crafted item's base identity and configured value premiums. */
export function itemPriceProfile(item) {
  const flags = item?.flags?.["crafting-professions"] ?? {};
  let name = String(item?.name ?? "");
  let multiplier = 1;
  let rules = {}, perks = null;
  try { rules = game.settings.get("crafting-professions", "rules") ?? {}; } catch { /* Companion inactive. */ }
  try { perks = game.settings.get("crafting-professions", "perks")?.list; } catch { /* Defaults below. */ }
  if (flags.masterwork || name.startsWith("Masterwork ")) {
    name = name.replace(/^Masterwork\s+/, "");
    multiplier *= Number(rules.masterworkValue) || 2;
  }
  if (flags.meal?.exquisite || name.startsWith("Exquisite ")) {
    name = flags.meal?.dish || name.replace(/^Exquisite\s+/, "");
    multiplier *= Number(rules.cooking?.exquisiteValue) || 2;
  }
  for (const perk of [...(flags.perks ?? [])].reverse()) {
    const suffix = ` (${perk})`;
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
    multiplier *= Number(perks?.find(entry => entry.name === perk)?.effects?.value) || (perk === "Ornate" ? 2 : 1);
  }
  return { name, multiplier, quality: multiplier !== 1 || Boolean(flags.masterwork || flags.meal?.exquisite || flags.perks?.length) };
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
  const price = foundry.utils.getProperty(data, "system.price");
  const profile = itemPriceProfile(data);
  // Quality has already been applied to the payload. Do not replace it with
  // an inherited base approval, or halve it again during inventory transfers.
  if (profile.quality && data?.flags?.[MODULE_ID]?.[PRICED_FLAG]) {
    if (oddCoin(price)) item.updateSource({ "system.price": tidyPrice(priceInGp(price)) });
    return;
  }
  const own = approvedPrice(data);
  const world = Array.from(game.items ?? []).find(entry => entry.name === data?.name);
  const approved = own ?? approvedPrice(world);
  if (approved !== null) {
    const saved = data?.flags?.[MODULE_ID]?.[PRICED_FLAG] ?? {};
    return item.updateSource({ "system.price": tidyPrice(approved), [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { ...saved, approved, book: saved.book ?? price ?? null } });
  }
  if (data?.flags?.[MODULE_ID]?.[PRICED_FLAG]) {
    if (oddCoin(price)) item.updateSource({ "system.price": tidyPrice(priceInGp(price)) });
    return;
  }
  if (!price || !priceInGp(price)) return;
  const book = { value: price.value, denomination: price.denomination ?? "gp" };
  const standard = STANDARD_PRICES[data?.name];
  if (standard !== undefined) return item.updateSource({ "system.price": tidyPrice(standard), [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { book } });
  if (compendiumSource(data).startsWith("Compendium.")) return item.updateSource({ "system.price": campaignPrice(price), [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { book } });
  if (oddCoin(price)) item.updateSource({ "system.price": tidyPrice(priceInGp(price)) });
}

export function registerPricingHooks() {
  Hooks.on("preCreateItem", (item, data) => { try { priceOnCreate(item, data); } catch (error) { console.error(`${MODULE_ID}: campaign price failed`, error); } });
}

/** Changes that set an item's campaign price and mark it priced. */
export const priceChanges = (gp, book = null) => ({ "system.price": tidyPrice(gp), [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { book } });
