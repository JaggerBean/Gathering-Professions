// Refining: gatherers turn their own materials into workable goods (smelting,
// milling, tanning, preparation) without a crafting profession. Recipes live in
// Mastercrafted recipe books built by this module; each recipe runs
// `api.refining.check` before Mastercrafted consumes and produces, so the
// gathering profession's check, rank die, tier DC, and XP apply.
import { MODULE_ID, PROFESSIONS, activeRules, checkFormula, materialRule, professionFlag } from "./rules.js";
import { getDegreeOfSuccess, naturalMasterful } from "./gathering.js";
import { MATERIAL_PRESETS, folderPath, worldItem } from "./presets.js";

export const MASTERCRAFTED_ID = "mastercrafted";
const RECIPE_TYPE = "mastercrafted.mastercrafted";
const KCTG = "kctg-5e.kctg-dnd5e";
// Refining takes half of the crafting time for the tier (minutes).
export const REFINE_MINUTES = Object.freeze([30, 60, 120, 240, 720]);
// Mastercrafted bonus output by check result: Excellent +1, Masterful +2.
const MODIFIERS = Object.freeze([{ DC: 2, modifier: "+2" }, { DC: 1, modifier: "+1" }]);

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const recipe = (tier, output, quantity, inputs, name = output) => Object.freeze({ tier, name, output, quantity, inputs: Object.freeze(inputs) });

// inputs: [name, quantity]. Tier = the tier of the material being refined.
export const REFINING = Object.freeze({
  mining: Object.freeze({
    book: "Mining — Smelting", verb: "Smelting", requires: ["kctg-5e"], packs: [KCTG],
    folder: ["Professions", "Mining", "Refined"],
    recipes: Object.freeze([
      recipe(1, "Copper Ingot", 1, [["Copper Ore", 2], ["Coal", 1]]),
      recipe(1, "Stone Brick", 1, [["Cobblestones", 2]]),
      recipe(1, "Glass", 1, [["Sandstone", 2], ["Coal", 1]]),
      recipe(2, "Iron Ingot", 1, [["Iron Ore", 2], ["Coal", 1]]),
      recipe(2, "Lead Ingot", 1, [["Lead", 2], ["Coal", 1]]),
      recipe(2, "Pure-Metal Bronze Ingot", 1, [["Copper Ingot", 1], ["Tin", 1], ["Coal", 1]]),
      recipe(3, "Silver Ingot", 1, [["Silver Ore", 1], ["Coal", 1]]),
      recipe(3, "Gold Ingot", 1, [["Gold Ore", 1], ["Coal", 1]]),
      recipe(3, "Steel", 1, [["Iron Ingot", 1], ["Coal", 2]]),
      recipe(4, "Platinum Ingot", 1, [["Platinum Ore", 1], ["Coal", 1]])
    ])
  }),
  logging: Object.freeze({
    book: "Logging — Milling", verb: "Milling", requires: ["kctg-5e"], packs: [KCTG],
    folder: ["Professions", "Timber", "Timber"],
    recipes: Object.freeze([
      recipe(1, "Cedar Plank", 2, [["Cedar Log", 1]]),
      recipe(1, "Pine Plank", 2, [["Pine Log", 1]]),
      recipe(1, "Charcoal", 1, [["Brushwood Bundle", 2]]),
      recipe(1, "Pine Tar", 1, [["Pine Log", 2]]),
      recipe(2, "Hickory Plank", 2, [["Hickory Log", 1]]),
      recipe(2, "Birch Plank", 2, [["Birch Log", 1]]),
      recipe(2, "Maple Lumber", 2, [["Maple Log", 1]]),
      recipe(2, "Fir Plank", 2, [["Fir Log", 1]]),
      recipe(3, "Oak Plank", 2, [["Oak Log", 1]]),
      recipe(3, "Teak Plank", 2, [["Teak Log", 1]]),
      recipe(3, "Redwood Plank", 2, [["Redwood Log", 1]]),
      recipe(4, "Poplar Lumber", 2, [["Poplar Log", 1]]),
      recipe(4, "Aspen Lumber", 2, [["Aspen Log", 1]]),
      recipe(5, "Walnut Lumber", 2, [["Walnut Log", 1]]),
      recipe(5, "Sandalwood Lumber", 2, [["Sandalwood Log", 1]]),
      recipe(5, "Mahogany Lumber", 2, [["Mahogany Log", 1]]),
      recipe(5, "Sandalwood Oil", 1, [["Sandalwood Log", 1]])
    ])
  }),
  skinning: Object.freeze({
    book: "Skinning — Tanning", verb: "Tanning", requires: ["kctg-5e", "helianas-harvest-compendium"],
    packs: [KCTG, "helianas-harvest-compendium.beast", "helianas-harvest-compendium.monstrosity"],
    folder: ["Professions", "Skinning", "Refined"],
    recipes: Object.freeze([
      recipe(1, "Cured Hide", 1, [["Fox Hide", 1]], "Cured Hide (Fox)"),
      recipe(1, "Cured Hide", 1, [["Mole Rat Hide", 2]], "Cured Hide (Mole Rat)"),
      recipe(1, "Bone Meal", 1, [["Chicken Bones", 2]]),
      recipe(2, "Drayweight Leather", 1, [["Cowhide", 1]]),
      recipe(2, "Grain Leather", 1, [["Beast Pelt", 1]]),
      recipe(2, "Bone Meal", 2, [["Beast Bone", 1]], "Bone Meal (Beast Bone)"),
      recipe(3, "Tannin Leather", 1, [["Bear Hide", 1]]),
      recipe(4, "Winter Kept Pelt", 1, [["Tiger Hide", 1]]),
      recipe(4, "Leather Scales", 1, [["Monstrosity Pelt", 1]])
    ])
  }),
  // Herbalism recipes are generated from the world's herbalism materials:
  // 2 of a herb make 1 "Dried <herb>" (an Item this module creates).
  herbalism: Object.freeze({
    book: "Herbalism — Preparation", verb: "Preparation", requires: [], packs: [],
    folder: ["Professions", "Herbalism", "Prepared"], dried: true, recipes: Object.freeze([])
  })
});

export const DRIED_PREFIX = "Dried ";

/** Refining definitions available in this world (Mastercrafted and source modules active). */
export function availableRefining() {
  if (!game.modules.get(MASTERCRAFTED_ID)?.active) return [];
  return Object.entries(REFINING).filter(([key, entry]) =>
    PROFESSIONS[key] && entry.requires.every(id => game.modules.get(id)?.active))
    .map(([key, entry]) => ({ key, book: entry.book, verb: entry.verb }));
}

/** The herbalism materials currently assigned in the world, as dried recipes. */
function driedRecipes() {
  return Array.from(game.items ?? []).map(item => ({ item, rule: materialRule(item) }))
    .filter(({ rule }) => rule?.profession === "herbalism")
    .sort((a, b) => a.rule.tier - b.rule.tier || a.item.name.localeCompare(b.item.name))
    .map(({ item, rule }) => ({ ...recipe(rule.tier, `${DRIED_PREFIX}${item.name}`, 1, [[item.name, 2]]), source: item }));
}

/** Recipes for a profession (herbalism: generated from the world's herbs). */
export function refiningRecipes(profession) {
  const entry = REFINING[profession];
  if (!entry) return [];
  return entry.dried ? driedRecipes() : [...entry.recipes];
}

/** World Item data for the dried form of a herb (no gathering flags). */
export function driedItemData(herb, folder = null) {
  const data = herb.toObject();
  delete data._id;
  data.name = `${DRIED_PREFIX}${herb.name}`;
  data.folder = folder;
  const price = Number(data.system?.price?.value) || 0;
  const denomination = data.system?.price?.denomination || "cp";
  foundry.utils.setProperty(data, "system.price", { value: Math.max(1, Math.round(price * 3)), denomination });
  const weight = Number(data.system?.weight?.value);
  if (Number.isFinite(weight)) foundry.utils.setProperty(data, "system.weight.value", Math.round(weight * 50) / 100);
  foundry.utils.setProperty(data, "system.quantity", 1);
  const text = data.system?.description?.value ?? "";
  foundry.utils.setProperty(data, "system.description.value",
    `<p><em>Dried and bundled for storage; keeps for months. Prepared by a herbalist from two fresh ${herb.name}.</em></p>${text}`);
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { preparedFrom: herb.name } };
  delete data._stats;
  return data;
}

async function driedItem(herb, folder) {
  const name = `${DRIED_PREFIX}${herb.name}`;
  const existing = Array.from(game.items ?? []).find(item => item.name === name);
  if (existing) return existing;
  const [item] = await Item.implementation.create([driedItemData(herb, folder.id)]);
  return item;
}

const recipeKey = entry => `${entry.output}<-${entry.inputs.map(([name, quantity]) => `${quantity}x${name}`).join("+")}`;

/** Inline Mastercrafted macro: hand the craft to this module's refining check. */
export function refiningMacro(profession, entry) {
  const args = JSON.stringify({ profession, tier: entry.tier, recipe: entry.name });
  return `return game.modules.get("${MODULE_ID}")?.api?.refining?.check({ actor, inventoryActor, componentsToConsume, ...${args} }) ?? { success: false, consume: false };`;
}

function component(item, quantity) {
  return { id: foundry.utils.randomID(), uuid: item.uuid, quantity, name: item.name, img: item.img, tags: [] };
}

function recipeFlags(book, profession, entry, inputs, output) {
  return {
    mastercrafted: {
      recipeBook: book.id, img: output.img,
      ingredients: inputs.map(({ item, quantity }) => ({ id: foundry.utils.randomID(), name: item.name, components: [component(item, quantity)] })),
      products: [{ id: foundry.utils.randomID(), name: output.name, components: [component(output, entry.quantity)] }],
      ingredientsInspection: false, productInspection: false, sound: "", require: "",
      macroName: refiningMacro(profession, entry), time: REFINE_MINUTES[entry.tier - 1],
      toolCheck: null, toolDc: null, abilityCheck: null, abilityDc: null, expression: "", modifierList: MODIFIERS.map(row => ({ ...row }))
    },
    [MODULE_ID]: { refining: { profession, tier: entry.tier, key: recipeKey(entry) } }
  };
}

async function refiningJournal(profession, entry) {
  const existing = Array.from(game.journal ?? []).find(journal => journal.getFlag?.(MODULE_ID, "refiningBook") === profession);
  if (existing) return existing;
  let folder = Array.from(game.folders ?? []).find(f => f.type === "JournalEntry" && f.name === "Refining" && !(f.folder?.id ?? f.folder));
  folder ??= await Folder.implementation.create({ name: "Refining", type: "JournalEntry" });
  return JournalEntry.implementation.create({
    name: entry.book, folder: folder.id,
    // Observers: players can see and use the book; Mastercrafted treats an unset user as allowed.
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: {
      mastercrafted: { img: "icons/sundries/books/book-worn-brown-grey.webp", sound: "", require: "", ingredientsInspection: false, productInspection: false, macroName: "", time: null },
      [MODULE_ID]: { refiningBook: profession }
    }
  });
}

/**
 * GM: create or update the profession's refining recipe book. Missing Items are
 * imported (or, for dried herbs, created). Pages this module made are updated
 * in place; pages the GM added are left alone.
 * @returns {Promise<{book: JournalEntry, created: number, updated: number, imported: number}>}
 */
export async function buildRefiningBook(profession) {
  if (!game.user.isGM) throw new Error("Only the GM may build refining recipes.");
  if (!game.modules.get(MASTERCRAFTED_ID)?.active) throw new Error("Enable Mastercrafted first.");
  const entry = REFINING[profession];
  if (!entry || !PROFESSIONS[profession]) throw new Error("This profession has no refining recipes.");
  const missing = entry.requires.filter(id => !game.modules.get(id)?.active);
  if (missing.length) throw new Error(`Enable ${missing.join(" and ")} first.`);
  const recipes = refiningRecipes(profession);
  if (!recipes.length) throw new Error(`Assign ${PROFESSIONS[profession].label} materials first.`);
  const preset = MATERIAL_PRESETS[profession];
  const inputFolder = await folderPath(preset?.folder ?? ["Professions", PROFESSIONS[profession].label]);
  const outputFolder = await folderPath(entry.folder);
  const cache = new Map();
  const report = { created: 0, updated: 0, imported: 0 };
  const book = await refiningJournal(profession, entry);
  const pages = new Map(Array.from(book.pages ?? []).map(page => [page.getFlag?.(MODULE_ID, "refining")?.key, page]).filter(([key]) => key));
  const creates = [];
  const updates = [];
  for (const recipeEntry of recipes) {
    const inputs = [];
    for (const [name, quantity] of recipeEntry.inputs) {
      const { item, imported } = recipeEntry.source && recipeEntry.source.name === name
        ? { item: recipeEntry.source, imported: false }
        : await worldItem(entry.packs, name, inputFolder, cache);
      if (imported) report.imported++;
      inputs.push({ item, quantity });
    }
    let output;
    if (entry.dried) output = await driedItem(recipeEntry.source, outputFolder);
    else {
      const found = await worldItem(entry.packs, recipeEntry.output, outputFolder, cache);
      if (found.imported) report.imported++;
      output = found.item;
    }
    const data = {
      name: recipeEntry.name, type: RECIPE_TYPE,
      text: { content: `<p>${entry.verb}, tier ${recipeEntry.tier}. Rolls ${PROFESSIONS[profession].label} at the tier DC.</p>`, format: 1 },
      flags: recipeFlags(book, profession, recipeEntry, inputs, output)
    };
    const page = pages.get(recipeKey(recipeEntry));
    if (page) updates.push({ _id: page.id, ...data });
    else creates.push(data);
  }
  if (creates.length) await book.createEmbeddedDocuments("JournalEntryPage", creates);
  if (updates.length) await book.updateEmbeddedDocuments("JournalEntryPage", updates);
  report.created = creates.length;
  report.updated = updates.length;
  return { book, ...report };
}

const OUTCOMES = Object.freeze({
  failed: "Ruined: half of the materials are lost.",
  partial: "Not quite: nothing is made, but the materials are kept.",
  successful: "Refined.",
  excellent: "Excellent work: +1 extra.",
  masterful: "Masterful work: +2 extra."
});
const LABELS = Object.freeze({ failed: "Failed", partial: "Near Miss", successful: "Success", excellent: "Excellent", masterful: "Masterful" });

/** Half (rounded up) of each component, as Mastercrafted component clones. */
function halveComponents(components) {
  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    const quantity = Math.ceil((Number(component.quantity) || 0) / 2);
    components[index] = typeof component.clone === "function" ? component.clone({ quantity }) : { ...component, quantity };
  }
}

/**
 * The refining check, called from a Mastercrafted recipe before it crafts.
 * Same check as gathering at the material's tier. Near miss (fail by < 5): keep
 * the materials. Fail by 5+ or a natural 1: lose half. Success: product and half
 * the tier's XP (Rules: refining XP %); Excellent +1 and Masterful +2 output.
 * @returns {Promise<{success: boolean, consume: boolean, checkResult?: number}>}
 */
export async function refineCheck({ actor, componentsToConsume = [], profession, tier, recipe: recipeName = "" }, { addXp }) {
  if (!actor) return { success: false, consume: false };
  if (!PROFESSIONS[profession]) {
    ui.notifications.warn("This refining recipe's profession no longer exists.");
    return { success: false, consume: false };
  }
  const level = Math.min(5, Math.max(1, Math.trunc(Number(tier)) || 1));
  const rules = activeRules();
  const xpNow = Math.max(0, Number(professionFlag(actor, "xp", profession)) || 0);
  const check = checkFormula(actor, profession, xpNow, rules.tierDc[level - 1], { tier: level });
  const roll = await new Roll(check.formula).evaluate();
  const natural = roll.dice?.[0]?.total;
  let degree = getDegreeOfSuccess(roll.total, check.target);
  if (natural === 20) degree = naturalMasterful(degree);
  if (natural === 1 && degree.id !== "failed") degree = { ...degree, id: "failed", natural1: true };
  const success = ["successful", "excellent", "masterful"].includes(degree.id);
  const xp = success ? Math.round(rules.tierXp[level - 1] * rules.refineXpPercent / 100) : 0;
  if (xp) await addXp(actor, profession, xp);
  if (degree.id === "failed") halveComponents(componentsToConsume);
  const label = PROFESSIONS[profession].label;
  const flavor = `<div class="gathering-professions-chat"><strong>${REFINING[profession]?.verb ?? "Refining"}: ${escape(recipeName)}</strong>
    <br>${label} check, tier ${level} · DC ${check.target}${check.trained ? ` (rank ${check.rank}, d${check.die})` : " (untrained)"}
    <br><strong>${LABELS[degree.id]}</strong>${natural === 20 ? " (natural 20)" : degree.natural1 ? " (natural 1)" : ""} — ${OUTCOMES[degree.id]}${xp ? ` +${xp} ${label} XP.` : ""}</div>`;
  try { await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor }); }
  catch (error) { console.error(`${MODULE_ID}: could not post the refining roll`, error); }
  if (success) return { success: true, consume: true, checkResult: degree.id === "masterful" ? 2 : degree.id === "excellent" ? 1 : 0 };
  return { success: false, consume: degree.id === "failed" };
}
