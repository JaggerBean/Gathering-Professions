// Profession materials browser (GM hub → Materials): each profession's
// gathering materials by tier, with the nodes that drop them, and its rare
// finds by tier, read from (and edited on) the tier rare-find tables.
import { MODULE_ID, PROFESSIONS, materialRule } from "./rules.js";
import { allNodePages } from "./nodes.js";

export const TIERS = 5;

function fromUuidSafe(uuid) {
  if (!uuid) return null;
  try { return globalThis.fromUuidSync?.(uuid) ?? null; } catch { return null; }
}

/** Item UUID → names of the gathering nodes whose table can drop it. */
export function nodeIndex(pages = allNodePages()) {
  const index = new Map();
  for (const page of pages) {
    const table = fromUuidSafe(page?.flags?.gatherer?.table);
    for (const result of Array.from(table?.results ?? [])) {
      if (!result.documentUuid) continue;
      if (!index.has(result.documentUuid)) index.set(result.documentUuid, []);
      const names = index.get(result.documentUuid);
      if (!names.includes(page.name)) names.push(page.name);
    }
  }
  return index;
}

/** Results of a rare table with their chance (weight share), as plain data. */
export function rareEntries(table) {
  const results = Array.from(table?.results ?? []);
  const total = results.reduce((sum, result) => sum + Math.max(0, Number(result.weight) || 0), 0) || 1;
  return results.map(result => {
    const item = fromUuidSafe(result.documentUuid);
    return {
      resultId: result.id ?? result._id, uuid: result.documentUuid ?? "", weight: Number(result.weight) || 0,
      percent: Math.round(((Number(result.weight) || 0) / total) * 100),
      name: item?.name ?? result.name ?? result.text ?? "Result", img: item?.img ?? result.img ?? "", missing: Boolean(result.documentUuid) && !item
    };
  });
}

/**
 * Everything the Materials section shows for one profession.
 * @returns {{profession, gathering: Array<{tier, materials}>, rare: Array<{tier, table, fallback, entries}>}}
 */
export function materialsModel(professionKey, items = Array.from(globalThis.game?.items ?? []), nodes = nodeIndex()) {
  const profession = PROFESSIONS[professionKey] ?? null;
  const gathering = Array.from({ length: TIERS }, (_, index) => ({ tier: index + 1, materials: [] }));
  for (const item of items) {
    const rule = materialRule(item);
    if (!rule || rule.profession !== professionKey) continue;
    gathering[rule.tier - 1].materials.push({
      id: item.id, uuid: item.uuid, name: item.name, img: item.img ?? "", tier: rule.tier, dc: rule.dc, xp: rule.xp,
      baseYield: rule.baseYield, conditions: rule.conditions.length, nodes: nodes.get(item.uuid) ?? []
    });
  }
  for (const group of gathering) group.materials.sort((a, b) => a.name.localeCompare(b.name));
  const rare = Array.from({ length: TIERS }, (_, index) => {
    const own = profession?.rareTables?.[index] ?? "";
    const tableUuid = own || profession?.rareTable || "";
    const table = fromUuidSafe(tableUuid);
    return { tier: index + 1, tableUuid, tableName: table?.name ?? (tableUuid ? "Missing table" : ""), fallback: !own && Boolean(tableUuid),
      missing: Boolean(tableUuid) && !table, entries: table ? rareEntries(table) : [] };
  });
  return { profession, gathering, rare };
}

/* ---------------------------------------------------------------------- */
/* Rare table edits (GM)                                                   */
/* ---------------------------------------------------------------------- */

/** Keep ranges contiguous and the formula 1dN after weights change. */
export async function normalizeTable(table) {
  const results = Array.from(table.results ?? []);
  let low = 1;
  const updates = results.map(result => {
    const weight = Math.max(1, Math.trunc(Number(result.weight) || 1));
    const range = [low, low + weight - 1];
    low += weight;
    return { _id: result.id ?? result._id, weight, range };
  });
  if (updates.length) await table.updateEmbeddedDocuments("TableResult", updates);
  await table.update({ formula: `1d${Math.max(1, low - 1)}` });
}

/** The profession's own table for a tier, creating it (folder "Rare Finds") when missing. */
export async function ensureTierTable(professionKey, tier) {
  const profession = PROFESSIONS[professionKey];
  if (!profession) throw new Error("Unknown profession.");
  const existing = fromUuidSafe(profession.rareTables?.[tier - 1]);
  if (existing) return existing;
  const folder = Array.from(game.folders ?? []).find(entry => entry.type === "RollTable" && entry.name === "Rare Finds" && !entry.folder)
    ?? await Folder.implementation.create({ name: "Rare Finds", type: "RollTable" });
  const table = await RollTable.implementation.create({
    name: `${profession.label} Rare Finds — Tier ${tier}`, folder: folder.id, formula: "1d1", replacement: true, displayRoll: false,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { [MODULE_ID]: { rareFindTable: { profession: professionKey, tier } } }
  });
  const rareTables = Array.from({ length: TIERS }, (_, index) => profession.rareTables?.[index] ?? "");
  rareTables[tier - 1] = table.uuid;
  await game.modules.get(MODULE_ID).api.setProfessions(Object.values(PROFESSIONS).map(entry => entry.key === professionKey ? { ...entry, rareTables } : entry));
  return table;
}

/** Add an Item to a profession's tier rare table (weight 1). Returns false if already there. */
export async function addRareItem(professionKey, tier, item) {
  if (!game.user.isGM) throw new Error("Only the GM may edit rare finds.");
  const table = await ensureTierTable(professionKey, tier);
  if (Array.from(table.results ?? []).some(result => result.documentUuid === item.uuid)) return false;
  await table.createEmbeddedDocuments("TableResult", [{ type: "document", documentUuid: item.uuid, name: item.name, img: item.img, weight: 1, range: [1, 1], drawn: false }]);
  await normalizeTable(table);
  if (!item.parent && !item.pack && !item.getFlag?.(MODULE_ID, "rareFind")) await item.setFlag(MODULE_ID, "rareFind", { profession: professionKey, tier });
  return true;
}

export async function removeRareResult(table, resultId) {
  if (!game.user.isGM) throw new Error("Only the GM may edit rare finds.");
  await table.deleteEmbeddedDocuments("TableResult", [resultId]);
  await normalizeTable(table);
}

/** weights: {resultId: weight} for one table. */
export async function setRareWeights(table, weights) {
  if (!game.user.isGM) throw new Error("Only the GM may edit rare finds.");
  const updates = Object.entries(weights).map(([id, weight]) => {
    const value = Number(weight);
    if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error("Weights must be whole numbers from 1 to 1000.");
    return { _id: id, weight: value };
  });
  if (updates.length) await table.updateEmbeddedDocuments("TableResult", updates);
  await normalizeTable(table);
}

/** Assign a world Item to a profession and tier, keeping its other material settings. */
export async function assignMaterial(professionKey, tier, item) {
  if (!game.user.isGM) throw new Error("Only the GM may assign materials.");
  if (item.parent || item.pack) throw new Error("Drop a world Item from the Items sidebar.");
  const saved = item.getFlag(MODULE_ID, "material") ?? {};
  await game.modules.get(MODULE_ID).api.setMaterial(item, {
    profession: professionKey, tier, baseYield: saved.baseYield ?? "1", dc: saved.dc ?? null, xp: saved.xp ?? null,
    untrainedDc: saved.untrainedDc ?? 0, rareTable: saved.rareTable ?? "", conditions: saved.conditions ?? []
  });
}

/** Stop treating a world Item as a gathering material (its other settings are kept). */
export async function unassignMaterial(item) {
  if (!game.user.isGM) throw new Error("Only the GM may assign materials.");
  await item.setFlag(MODULE_ID, "material", { enabled: false });
}
