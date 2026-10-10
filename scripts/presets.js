// Material presets: ready-made material lists built from other modules'
// compendiums (Kris's Compendium of Trade Goods; Heliana's Harvest for
// skinning). Applying a preset imports any missing Items (Items already in
// the world with the same name are reused), assigns them to the profession and
// tier, and fills that profession's tier rare-find tables. Presets only list
// names; nothing is shipped from the source modules.
import { MODULE_ID, PROFESSIONS, materialRule } from "./rules.js";
import { ensureTierTable, normalizeTable } from "./materials.js";
import { customItemData } from "./customitems.js";

const KCTG = "kctg-5e.kctg-dnd5e";
const HELIANA = "helianas-harvest-compendium";
const list = text => text.split(",").map(name => name.trim()).filter(Boolean);

// Entries are names, or [name, alias...] when worlds may use another spelling.
export const MATERIAL_PRESETS = Object.freeze({
  herbalism: Object.freeze({
    profession: "herbalism",
    label: "Herbalism: Kris's Trade Goods",
    requires: ["kctg-5e"],
    packs: [KCTG],
    folder: ["Professions", "Herbalism", "Wild"],
    rareFolder: ["Rare Finds", "Herbalism"],
    // Wild herbs, flowers, and mushrooms (crops, seeds, and non-plants excluded).
    materials: Object.freeze({
      1: list("Clover, Dandelion, Chamomile, Wild Mint, Nettle"),
      2: list("Horsetail, Coneflower, Laurel, King Bolete, Puffball"),
      3: list("Blue Chanterelle, Indigo Milkcap, Stargazer Lily, Pennyroyal, Death Cap"),
      4: list("Last Hope Fire, Roseoflava, Green Elf Cup, Neon-Ront, Nerium"),
      5: list("Bearberry, Myrrh, Sunberries, Toadstool, Henbane")
    }),
    baseYield: Object.freeze({ 1: "1d3", 2: "1d2", 3: "1d2", 4: "1", 5: "1" }),
    rare: Object.freeze({
      1: list("Matsutake, Verdigris Waxcap, Golden Berry"),
      2: list("Witchhat Mushroom, Forest Lantern, Jack'o'lantern Mushroom"),
      3: list("Divine Light, Purple Emperor, Funeral Bell"),
      4: list("The Last Veiled Widow, Daer-Kron, Kurnarac"),
      5: list("Silphium, Belladonna Fruit, Wolf Bane's Leaves")
    })
  }),
  mining: Object.freeze({
    profession: "mining",
    label: "Mining: Kris's Trade Goods",
    requires: ["kctg-5e"],
    packs: [KCTG],
    folder: ["Professions", "Mining", "Ores"],
    rareFolder: ["Rare Finds", "Mining"],
    // Ores and stone as gathering materials; gemstones as rare finds.
    materials: Object.freeze({
      // Rock Salt: a cooking staple (Crafting Professions' Cook).
      1: list("Stone, Cobblestones, Sandstone, Coal, Copper Ore, Rock Salt"),
      2: list("Granite, Quartzite, Tin, Lead, Iron Ore"),
      3: list("Marble, Alabaster, Silver Ore, Gold Ore, Kyanite"),
      4: list("Platinum Ore, Kornerupine, Harunite, Ravenar, Benitoite"),
      5: [["Mithral", "Mithril"], "Hambergite", "Adamantine", "Cold Iron", "Palladium"]
    }),
    baseYield: Object.freeze({ 1: "1d3", 2: "1d2", 3: "1d2", 4: "1", 5: "1" }),
    rare: Object.freeze({
      1: list("Quartz, Agate, Obsidian"),
      2: list("Moonstone, Bloodstone, Citrine"),
      3: list("Amethyst, Jade, Amber"),
      4: list("Aquamarine, Topaz, Peridot"),
      5: list("Blue-White Diamond, Red Topaz, Dragon's Heart")
    })
  }),
  logging: Object.freeze({
    profession: "logging",
    label: "Logging: Kris's Trade Goods + forest finds",
    requires: ["kctg-5e"],
    packs: [KCTG],
    folder: ["Professions", "Timber", "Logs"],
    rareFolder: ["Rare Finds", "Logging"],
    // Raw wood only (4 per tier): planks, lumber, Charcoal, Pine Tar, and
    // Sandalwood Oil come from refining (milling). Rare finds are tree
    // products, topped up with this module's own forest finds.
    materials: Object.freeze({
      1: list("Brushwood Bundle, Bamboo, Cedar Log, Pine Log"),
      2: list("Hickory Log, Birch Log, Maple Log, Fir Log"),
      3: list("Oak Log, Teak Log, Redwood Log, Retama"),
      4: list("Poplar Log, Aspen Log, Palo Verde, Ironwood Log"),
      5: list("Walnut Log, Sandalwood Log, Mahogany Log, Darkwood")
    }),
    baseYield: Object.freeze({ 1: "1d3", 2: "1d2", 3: "1d2", 4: "1", 5: "1" }),
    rare: Object.freeze({
      1: list("Acorns, Cobnut, Maple Seeds"),
      2: list("Hazelnut, Mistletoe, Birch Bark Roll"),
      3: list("Vertugal, Honey, Knotwood Burl"),
      4: list("Maple Sap, Petrified Heartwood, Golden Resin Tear"),
      5: list("Elderwood Heartcore, Lightning-Struck Ironbark, Seed of the Old Grove")
    })
  }),
  skinning: Object.freeze({
    profession: "skinning",
    label: "Skinning: Kris's Trade Goods + Heliana's Beasts",
    requires: ["kctg-5e", HELIANA],
    packs: [KCTG, `${HELIANA}.beast`, `${HELIANA}.monstrosity`, `${HELIANA}.dragon`],
    folder: ["Professions", "Skinning"],
    rareFolder: ["Rare Finds", "Skinning"],
    // Tiers follow creature toughness: small game, livestock and deer, big
    // predators, monsters and giant vermin, dragons. Heliana's type-named parts
    // appear only at the tier of that creature type.
    materials: Object.freeze({
      // Beast Flesh and Beast Fat: meat for cooking.
      1: list("Chicken Bones, Mole Rat Hide, Fox Hide, Crow Feathers, Beast Hair, Beast Flesh"),
      2: list("Cowhide, Ram's Horn, Antlers, Beast Pelt, Beast Bone, Beast Fat"),
      3: list("Bear Hide, Boar Cranium, Shark Teeth, Beast Tusk, Beast Pouch Of Claws"),
      4: list("Tiger Hide, Chitin, Exoskeleton, Monstrosity Pelt, Monstrosity Bone"),
      5: list("Dragonhide, Dragon Bones, Dragon Scales, Dragon Talons, Dragon Horn")
    }),
    baseYield: Object.freeze({ 1: "1d3", 2: "1d2", 3: "1d2", 4: "1", 5: "1" }),
    rare: Object.freeze({
      1: list("Corvus Corax, Beast Pouch Of Feathers, Beast Egg"),
      2: list("Beast Heart, Beast Phial Of Blood, Beast Pouch Of Teeth"),
      3: list("Boar Head, Beast Poison Gland, Beast Talon"),
      4: list("Monstrosity Heart, Monstrosity Poison Gland, Monstrosity Eye"),
      5: list("Dragon's Skull, Dragon Eye, Dragon Breath Sac")
    })
  })
});

const names = entry => Array.isArray(entry) ? entry : [entry];

/** Presets whose source modules are active and whose profession exists. */
export function availablePresets() {
  return Object.entries(MATERIAL_PRESETS).filter(([, preset]) =>
    PROFESSIONS[preset.profession] && preset.requires.every(id => game.modules.get(id)?.active))
    .map(([key, preset]) => ({ key, label: preset.label, profession: preset.profession }));
}

/** Find or create a nested Item folder path like ["Professions", "Herbalism", "Wild"]. */
export async function folderPath(names) {
  let parent = null;
  for (const name of names) {
    let folder = Array.from(game.folders ?? []).find(entry => entry.type === "Item" && entry.name === name && (entry.folder?.id ?? entry.folder ?? null) === (parent?.id ?? null));
    folder ??= await Folder.implementation.create({ name, type: "Item", folder: parent?.id ?? null });
    parent = folder;
  }
  return parent;
}

/**
 * A world Item with this name (preferring one in the target folder), else one
 * of this module's own items, else a fresh import from the first pack that has it.
 */
export async function worldItem(packIds, entryNames, folder, cache = new Map()) {
  const candidates = names(entryNames);
  const existing = Array.from(game.items ?? []).filter(item => candidates.includes(item.name));
  const found = existing.find(item => (item.folder?.id ?? item.folder) === folder.id) ?? existing[0];
  if (found) return { item: found, imported: false };
  const custom = candidates.map(name => customItemData(name, folder.id)).find(Boolean);
  if (custom) {
    const [item] = await Item.implementation.create([custom]);
    return { item, imported: true };
  }
  for (const packId of packIds) {
    const pack = game.packs.get(packId);
    if (!pack) throw new Error(`Compendium ${packId} is not available.`);
    const index = cache.get(packId) ?? await pack.getIndex();
    cache.set(packId, index);
    const entry = Array.from(index).find(row => candidates.includes(row.name));
    if (!entry) continue;
    const source = await pack.getDocument(entry._id);
    const data = source.toObject();
    delete data._id;
    data.folder = folder.id;
    foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
    const [item] = await Item.implementation.create([data]);
    return { item, imported: true };
  }
  throw new Error(`"${candidates[0]}" was not found in ${packIds.map(id => game.packs.get(id)?.title ?? id).join(" or ")}.`);
}

/**
 * GM: apply a material preset. With `exclusive` (default), other materials of
 * the profession are unassigned (Items are kept).
 * @returns {Promise<{materials: number, rare: number, imported: number, unassigned: number}>}
 */
export async function applyMaterialPreset(key, { exclusive = true } = {}) {
  if (!game.user.isGM) throw new Error("Only the GM may apply material presets.");
  const preset = MATERIAL_PRESETS[key];
  if (!preset) throw new Error("Unknown material preset.");
  const missing = preset.requires.filter(id => !game.modules.get(id)?.active);
  if (missing.length) throw new Error(`Enable ${missing.join(" and ")} first.`);
  if (!PROFESSIONS[preset.profession]) throw new Error(`This world has no ${preset.profession} profession.`);
  const api = game.modules.get(MODULE_ID).api;
  const cache = new Map();
  const report = { materials: 0, rare: 0, imported: 0, unassigned: 0 };
  const assigned = new Set();
  const folder = await folderPath(preset.folder);
  for (const [tier, names] of Object.entries(preset.materials)) {
    for (const entry of names) {
      const { item, imported } = await worldItem(preset.packs, entry, folder, cache);
      assigned.add(item.id);
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
    for (const entry of entries) {
      const { item, imported } = await worldItem(preset.packs, entry, rareFolder, cache);
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
  if (exclusive) {
    for (const item of Array.from(game.items ?? [])) {
      if (assigned.has(item.id) || materialRule(item)?.profession !== preset.profession) continue;
      await item.setFlag(MODULE_ID, "material", { enabled: false });
      report.unassigned++;
    }
  }
  return report;
}
