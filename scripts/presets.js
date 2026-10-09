// Material presets: ready-made material lists built from other modules'
// compendiums. Applying a preset imports any missing Items (Items already in
// the world with the same name are reused), assigns them to the profession and
// tier, and fills that profession's tier rare-find tables. Presets only list
// names; nothing is shipped from the source modules.
import { MODULE_ID, PROFESSIONS } from "./rules.js";
import { ensureTierTable, normalizeTable } from "./materials.js";

const KCTG = "kctg-5e.kctg-dnd5e";
const HELIANA_PLANT = "helianas-harvest-compendium.plant";
const list = text => text.split(",").map(name => name.trim()).filter(Boolean);

export const MATERIAL_PRESETS = Object.freeze({
  herbalism: Object.freeze({
    profession: "herbalism",
    label: "Herbalism: Kris's Trade Goods + Heliana's Harvest",
    requires: ["kctg-5e", "helianas-harvest-compendium"],
    folder: ["Professions", "Herbalism", "Wild"],
    rareFolder: ["Rare Finds", "Herbalism"],
    // Wild herbs, flowers, and mushrooms (crops, seeds, and non-plants excluded).
    materials: Object.freeze({
      1: list("Clover, Dandelion, Chamomile, Wild Mint, Nettle, Marjoram, Field Mushroom, Mugwort"),
      2: list("Horsetail, Figworts, Coneflower, Laurel, Blewits, King Bolete, Puffball, Water Lily"),
      3: list("Blue Chanterelle, Indigo Milkcap, Elfin Saddle, Stargazer Lily, Bitterroot, Pennyroyal, Death Cap, Purple Berries"),
      4: list("Last Hope Fire, Roseoflava, The Last Veiled Widow, Green Elf Cup, Neon-Ront, Myrica Gale, Wood Lily, Nerium"),
      5: list("Silphium, Bearberry, Myrrh, Sunberries, Toadstool, Henbane, Breadseed Poppy, Witchhat Mushroom")
    }),
    materialPack: KCTG,
    baseYield: Object.freeze({ 1: "1d3", 2: "1d2", 3: "1d2", 4: "1", 5: "1" }),
    // Rare finds: Heliana plant parts plus exotic herbs, three per tier.
    rare: Object.freeze({
      1: [[HELIANA_PLANT, "Plant Phial Of Sap"], [HELIANA_PLANT, "Plant Tuber"], [KCTG, "Matsutake"]],
      2: [[HELIANA_PLANT, "Plant Pouch Of Leaves"], [HELIANA_PLANT, "Plant Bundle Of Roots"], [HELIANA_PLANT, "Plant Pouch Of Seeds"]],
      3: [[HELIANA_PLANT, "Plant Pouch Of Hyphae"], [HELIANA_PLANT, "Plant Pouch Of Pollen"], [KCTG, "Divine Light"]],
      4: [[HELIANA_PLANT, "Plant Bark"], [HELIANA_PLANT, "Plant Pouch Of Spores"], [HELIANA_PLANT, "Plant Poison Gland"]],
      5: [[HELIANA_PLANT, "Plant Membrane"], [KCTG, "Belladonna Fruit"], [KCTG, "Wolf Bane's Leaves"]]
    })
  })
});

/** Presets whose source modules are active and whose profession exists. */
export function availablePresets() {
  return Object.entries(MATERIAL_PRESETS).filter(([, preset]) =>
    PROFESSIONS[preset.profession] && preset.requires.every(id => game.modules.get(id)?.active))
    .map(([key, preset]) => ({ key, label: preset.label, profession: preset.profession }));
}

/** Find or create a nested Item folder path like ["Professions", "Herbalism", "Wild"]. */
async function folderPath(names) {
  let parent = null;
  for (const name of names) {
    let folder = Array.from(game.folders ?? []).find(entry => entry.type === "Item" && entry.name === name && (entry.folder?.id ?? entry.folder ?? null) === (parent?.id ?? null));
    folder ??= await Folder.implementation.create({ name, type: "Item", folder: parent?.id ?? null });
    parent = folder;
  }
  return parent;
}

/** A world Item with this name (preferring one in the target folder), else a fresh import. */
async function worldItem(packId, name, folder, cache) {
  const existing = Array.from(game.items ?? []).filter(item => item.name === name);
  const found = existing.find(item => (item.folder?.id ?? item.folder) === folder.id) ?? existing[0];
  if (found) return { item: found, imported: false };
  const pack = game.packs.get(packId);
  if (!pack) throw new Error(`Compendium ${packId} is not available.`);
  const index = cache.get(packId) ?? await pack.getIndex();
  cache.set(packId, index);
  const entry = Array.from(index).find(row => row.name === name);
  if (!entry) throw new Error(`"${name}" was not found in ${pack.title}.`);
  const source = await pack.getDocument(entry._id);
  const data = source.toObject();
  delete data._id;
  data.folder = folder.id;
  foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
  const [item] = await Item.implementation.create([data]);
  return { item, imported: true };
}

/**
 * GM: apply a material preset.
 * @returns {Promise<{materials: number, rare: number, imported: number}>}
 */
export async function applyMaterialPreset(key) {
  if (!game.user.isGM) throw new Error("Only the GM may apply material presets.");
  const preset = MATERIAL_PRESETS[key];
  if (!preset) throw new Error("Unknown material preset.");
  const missing = preset.requires.filter(id => !game.modules.get(id)?.active);
  if (missing.length) throw new Error(`Enable ${missing.join(" and ")} first.`);
  if (!PROFESSIONS[preset.profession]) throw new Error(`This world has no ${preset.profession} profession.`);
  const api = game.modules.get(MODULE_ID).api;
  const cache = new Map();
  const report = { materials: 0, rare: 0, imported: 0 };
  const folder = await folderPath(preset.folder);
  for (const [tier, names] of Object.entries(preset.materials)) {
    for (const name of names) {
      const { item, imported } = await worldItem(preset.materialPack, name, folder, cache);
      if (imported) report.imported++;
      const saved = item.getFlag(MODULE_ID, "material") ?? {};
      await api.setMaterial(item, {
        profession: preset.profession, tier: Number(tier), baseYield: preset.baseYield[tier] ?? "1",
        dc: saved.dc ?? null, xp: saved.xp ?? null, untrainedDc: saved.untrainedDc ?? 0, rareTable: saved.rareTable ?? "", conditions: saved.conditions ?? []
      });
      report.materials++;
    }
  }
  const rareFolder = await folderPath(preset.rareFolder);
  for (const [tierKey, entries] of Object.entries(preset.rare)) {
    const tier = Number(tierKey);
    const items = [];
    for (const [packId, name] of entries) {
      const { item, imported } = await worldItem(packId, name, rareFolder, cache);
      if (imported) report.imported++;
      await item.setFlag(MODULE_ID, "rareFind", { profession: preset.profession, tier });
      items.push(item);
    }
    // The tier table holds exactly the preset's finds (other results removed).
    const table = await ensureTierTable(preset.profession, tier);
    const stale = Array.from(table.results ?? []).map(result => result.id ?? result._id);
    if (stale.length) await table.deleteEmbeddedDocuments("TableResult", stale);
    await table.createEmbeddedDocuments("TableResult", items.map((item, index) => ({
      type: "document", documentUuid: item.uuid, name: item.name, img: item.img, weight: 1, range: [index + 1, index + 1], drawn: false
    })));
    await normalizeTable(table);
    report.rare += items.length;
  }
  return report;
}
