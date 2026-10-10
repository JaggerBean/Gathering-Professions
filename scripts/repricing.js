// Apply campaign prices (pricing.js) to the world: gathered materials, rare
// finds, refined goods and gathering tools here; other modules add their own
// items with registerPriceContributor (Crafting Professions: crafted goods,
// bounty gear and finds, recipe scrolls). Items on actors follow their world
// item by the same ratio (so Masterwork / Exquisite / perk multipliers stay);
// other compendium items are halved once. Skill items and the Unused folder
// are left alone. Idempotent: running it again changes nothing.
import { MODULE_ID, PROFESSIONS } from "./rules.js";
import { MATERIAL_BANDS, RARE_BANDS, PRICED_FLAG, STANDARD_PRICES, priceInGp, tidyPrice, campaignPrice, oddCoin, spreadInBand, recipeCosts, approvedPrice } from "./pricing.js";
import { allRecipes } from "./refining.js";

export const TOOL_PRICE = 1;
const contributors = [];

/** Another module adds prices: fn(prices: Map<name, gp>, helpers) → Promise<Map<name, gp>|void>. */
export function registerPriceContributor(fn) { if (typeof fn === "function" && !contributors.includes(fn)) contributors.push(fn); }

const folderPath = folder => { const parts = []; for (let entry = folder; entry; entry = entry.folder) parts.unshift(entry.name); return parts.join(" / "); };
const skipped = item => Boolean(item.getFlag?.(MODULE_ID, "universalSkill")) || folderPath(item.folder) === "Unused";
// Rank by the price an item had before campaign pricing (kept in the flag), so reruns are stable.
const oldGp = item => { const basis = Number(item.getFlag?.(MODULE_ID, PRICED_FLAG)?.basis); return Number.isFinite(basis) ? basis : priceInGp(item.system?.price); };

/** gp for every gathering item, by name. */
export { oldGp as basisGp };
export function gatheringPrices(items = Array.from(game.items ?? [])) {
  const prices = new Map();
  const material = item => { const rule = item.getFlag?.(MODULE_ID, "material"); return rule?.enabled !== false && rule?.profession ? rule : null; };
  // Materials: per profession and tier.
  const groups = new Map();
  for (const item of items) {
    const rule = material(item);
    if (!rule || skipped(item)) continue;
    const tier = Math.min(5, Math.max(1, Number(rule.tier) || 1));
    const key = `${rule.profession}:${tier}`;
    (groups.get(key) ?? groups.set(key, { tier, members: [] }).get(key)).members.push({ key: item.name, old: oldGp(item) });
  }
  for (const { tier, members } of groups.values()) for (const [name, gp] of spreadInBand(members, MATERIAL_BANDS[tier - 1])) prices.set(name, gp);
  // Rare finds: the professions' tier tables.
  const rareGroups = new Map();
  for (const profession of Object.values(PROFESSIONS)) {
    (profession.rareTables ?? []).forEach((uuid, index) => {
      const table = uuid ? globalThis.fromUuidSync?.(uuid) : null;
      for (const result of Array.from(table?.results ?? [])) {
        const item = result.documentUuid ? globalThis.fromUuidSync?.(result.documentUuid) : null;
        if (!item || prices.has(item.name) || skipped(item)) continue;
        const key = `${profession.key}:${index + 1}`;
        (rareGroups.get(key) ?? rareGroups.set(key, { tier: index + 1, members: [] }).get(key)).members.push({ key: item.name, old: oldGp(item) });
      }
    });
  }
  for (const { tier, members } of rareGroups.values()) for (const [name, gp] of spreadInBand(members, RARE_BANDS[tier - 1])) if (!prices.has(name)) prices.set(name, gp);
  // Preserve established raw/rare prices and GM-approved values. Recipe products
  // are floors, not fixed caps, so later ingredient increases remain safe.
  const rows = allRecipes();
  const outputs = new Set(rows.map(row => row.output));
  const inputs = new Set(rows.flatMap(row => row.inputs.map(([name]) => name)));
  for (const item of items) {
    if (item.getFlag?.(MODULE_ID, "universalSkill")) continue;
    const approved = approvedPrice(item);
    const current = priceInGp(item.system?.price);
    if (approved !== null) prices.set(item.name, approved);
    else if (prices.has(item.name) && item.getFlag?.(MODULE_ID, PRICED_FLAG)) prices.set(item.name, current);
    else if ((outputs.has(item.name) || inputs.has(item.name)) && current) prices.set(item.name, current);
  }
  for (const [name, gp] of prices) prices.set(name, priceInGp(tidyPrice(gp)));
  // Refined goods: every enabled recipe must cover ingredients + margin.
  for (const [name, gp] of recipeCosts(rows, prices)) prices.set(name, gp);
  // Basic gathering tools.
  for (const item of items) if (item.getFlag?.(MODULE_ID, "defaultTool")) prices.set(item.name, Math.max(TOOL_PRICE, prices.get(item.name) ?? 0, priceInGp(item.system?.price)));
  return prices;
}

/** The compendium book price of an item (its flag, else its source), or null. */
export async function bookPrice(item) {
  const saved = item.getFlag?.(MODULE_ID, PRICED_FLAG)?.book;
  if (saved) return saved;
  const source = item._stats?.compendiumSource || item.flags?.core?.sourceId;
  if (!source?.startsWith?.("Compendium.")) return null;
  try { return (await fromUuid(source))?.system?.price ?? null; } catch { return null; }
}

/**
 * Compute and apply campaign prices. With dryRun, returns the plan only.
 * @returns {Promise<{world: object[], actors: object[], halved: number}>}
 */
export async function repriceWorld({ dryRun = false } = {}) {
  if (!game.user.isGM) throw new Error("Only the GM may reprice items.");
  const items = Array.from(game.items ?? []);
  const prices = gatheringPrices(items);
  const helpers = { bookPrice, priceInGp, tidyPrice, campaignPrice };
  for (const contribute of contributors) {
    const extra = await contribute(new Map(prices), helpers);
    for (const [name, gp] of extra ?? []) prices.set(name, gp);
  }
  // Standard gear priced by type; crafted goods keep their recipe price.
  const crafted = new Set(prices.keys());
  for (const [name, gp] of Object.entries(STANDARD_PRICES)) if (!crafted.has(name)) prices.set(name, gp);
  // World items: named prices, else halve unpriced compendium items once.
  const world = [];
  const ratioByName = new Map();
  for (const item of items) {
    if (item.getFlag?.(MODULE_ID, "universalSkill")) continue;
    const unused = folderPath(item.folder) === "Unused";
    const before = item.system?.price;
    let target = null;
    if (unused) {
      if (approvedPrice(item) !== null) target = tidyPrice(approvedPrice(item));
      else if (oddCoin(before)) target = tidyPrice(priceInGp(before));
      else continue;
    }
    else if (prices.has(item.name)) target = tidyPrice(prices.get(item.name));
    else if (!item.getFlag(MODULE_ID, PRICED_FLAG) && priceInGp(before)) {
      const book = await bookPrice(item);
      if (book) target = campaignPrice(book);
    }
    // Silver and gold only.
    if (!target && oddCoin(before)) target = tidyPrice(priceInGp(before));
    if (!target) continue;
    const from = priceInGp(before), to = priceInGp(target);
    if (from !== to || oddCoin(before) || !item.getFlag(MODULE_ID, PRICED_FLAG)) {
      const saved = item.getFlag(MODULE_ID, PRICED_FLAG) ?? {};
      world.push({ item, name: item.name, from, to, changes: { "system.price": target, [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { ...saved, book: saved.book ?? await bookPrice(item) ?? null, basis: Number.isFinite(Number(saved.basis)) ? Number(saved.basis) : from } } });
    }
    if (from !== to) ratioByName.set(item.name, { from, to });
  }
  // Actor items: follow their world item's change (Masterwork/Exquisite prefixes included).
  const actorPlan = [];
  for (const actor of Array.from(game.actors ?? [])) {
    for (const item of Array.from(actor.items ?? [])) {
      if (item.getFlag?.(MODULE_ID, "universalSkill")) continue;
      const base = item.name.replace(/^(Masterwork|Exquisite)\s+/, "");
      const ratio = ratioByName.get(base) ?? ratioByName.get(item.name);
      const current = priceInGp(item.system?.price);
      let to = null;
      if (ratio) to = ratio.from ? current * (ratio.to / ratio.from) : ratio.to;
      else if (current && STANDARD_PRICES[item.name] !== undefined && !crafted.has(item.name)) to = STANDARD_PRICES[item.name];
      else if (!item.getFlag(MODULE_ID, PRICED_FLAG) && current && prices.has(base)) to = prices.get(base);
      else if (!item.getFlag(MODULE_ID, PRICED_FLAG) && current) {
        const book = await bookPrice(item);
        if (book) to = priceInGp(campaignPrice(book));
      }
      if (to === null && oddCoin(item.system?.price)) to = current;
      if (to === null) continue;
      const target = tidyPrice(to);
      if (priceInGp(target) === current && item.getFlag(MODULE_ID, PRICED_FLAG) && !oddCoin(item.system?.price)) continue;
      actorPlan.push({ actor, item, name: `${actor.name}: ${item.name}`, from: current, to: priceInGp(target), changes: { "system.price": target, [`flags.${MODULE_ID}.${PRICED_FLAG}`]: { ...(item.getFlag(MODULE_ID, PRICED_FLAG) ?? {}), book: item.getFlag(MODULE_ID, PRICED_FLAG)?.book ?? null } } });
    }
  }
  const summary = { world: world.map(({ name, from, to }) => ({ name, from, to })), actors: actorPlan.map(({ name, from, to }) => ({ name, from, to })) };
  if (dryRun) return summary;
  for (let index = 0; index < world.length; index += 100) {
    await Item.implementation.updateDocuments(world.slice(index, index + 100).map(entry => ({ _id: entry.item.id, ...entry.changes })));
  }
  const byActor = new Map();
  for (const entry of actorPlan) (byActor.get(entry.actor) ?? byActor.set(entry.actor, []).get(entry.actor)).push({ _id: entry.item.id, ...entry.changes });
  for (const [actor, updates] of byActor) await actor.updateEmbeddedDocuments("Item", updates);
  return summary;
}
