// Refining: gatherers turn their own materials into workable goods (smelting,
// milling, tanning, preparation) with their gathering profession. Recipes are
// module data; the Recipes window (recipes-ui.js) shows the ones the party has
// discovered, and this file runs the craft: check, consume, produce or queue.
import { MODULE_ID, PROFESSIONS, MAX_REFINE_MINUTES, activeRules, checkFormula, materialRule, professionFlag } from "./rules.js";
import { getDegreeOfSuccess, naturalMasterful } from "./gathering.js";
import { MATERIAL_PRESETS, folderPath, worldItem } from "./presets.js";

const KCTG = "kctg-5e.kctg-dnd5e";
const HELIANA = "helianas-harvest-compendium";
// Bump when recipes or generated items change: the GM prepares items again.
export const REFINING_VERSION = 1;
export { REFINE_MINUTES } from "./rules.js";

/** Minutes per unit: the recipe's own time, else the tier default (Rules). */
export function recipeMinutes(entry, rules = activeRules()) {
  const own = entry?.minutes;
  if (own !== undefined && own !== null && own !== "" && Number.isInteger(Number(own))) return Number(own);
  const tier = Math.min(5, Math.max(1, Math.trunc(Number(entry?.tier)) || 1));
  return rules.refineMinutes[tier - 1];
}
export const DRIED_PREFIX = "Dried ";

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const slug = text => String(text).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const recipe = (tier, output, quantity, inputs) => Object.freeze({ tier, output, quantity, inputs: Object.freeze(inputs.map(row => Object.freeze(row))) });

/* ---------------------------------------------------------------------- */
/* Recipe data: every preset material refines into something.            */
/* inputs: [name, quantity]; tier = the tier of the material refined.      */
/* ---------------------------------------------------------------------- */

export const REFINING = Object.freeze({
  mining: Object.freeze({
    verb: "Smelting", action: "Smelt", icon: "fa-fire-burner", requires: ["kctg-5e"], packs: [KCTG],
    folder: ["Professions", "Mining", "Refined"],
    recipes: Object.freeze([
      recipe(1, "Stone Brick", 1, [["Stone", 3]]),
      recipe(1, "Stone Brick", 1, [["Cobblestones", 2]]),
      recipe(1, "Glass", 1, [["Sandstone", 2], ["Coal", 1]]),
      recipe(1, "Coke", 1, [["Coal", 3]]),
      recipe(1, "Copper Ingot", 1, [["Copper Ore", 2], ["Coal", 1]]),
      recipe(2, "Stone Brick", 2, [["Granite", 1]]),
      recipe(2, "Glass", 2, [["Quartzite", 1], ["Coal", 1]]),
      recipe(2, "Tin Ingot", 1, [["Tin", 2], ["Coal", 1]]),
      recipe(2, "Lead Ingot", 1, [["Lead", 2], ["Coal", 1]]),
      recipe(2, "Iron Ingot", 1, [["Iron Ore", 2], ["Coal", 1]]),
      recipe(2, "Pure-Metal Bronze Ingot", 4, [["Copper Ingot", 3], ["Tin Ingot", 1]]),
      recipe(3, "Steel", 1, [["Iron Ingot", 1], ["Coke", 1]]),
      recipe(3, "Steel", 1, [["Iron Ingot", 1], ["Coal", 3]]),
      recipe(3, "Marble Slab", 1, [["Marble", 1]]),
      recipe(3, "Polished Alabaster", 1, [["Alabaster", 1]]),
      recipe(3, "Silver Ingot", 1, [["Silver Ore", 1], ["Coal", 1]]),
      recipe(3, "Gold Ingot", 1, [["Gold Ore", 1], ["Coal", 1]]),
      recipe(3, "Cut Kyanite", 1, [["Kyanite", 1]]),
      recipe(4, "Platinum Ingot", 1, [["Platinum Ore", 1], ["Coke", 1]]),
      recipe(4, "Cut Kornerupine", 1, [["Kornerupine", 1]]),
      recipe(4, "Cut Harunite", 1, [["Harunite", 1]]),
      recipe(4, "Cut Ravenar", 1, [["Ravenar", 1]]),
      recipe(4, "Cut Benitoite", 1, [["Benitoite", 1]]),
      recipe(5, "Mithral Ingot", 1, [["Mithral", 2], ["Coke", 1]]),
      recipe(5, "Adamantine Ingot", 1, [["Adamantine", 2], ["Coke", 2]]),
      recipe(5, "Cold Iron Ingot", 1, [["Cold Iron", 2], ["Coke", 1]]),
      recipe(5, "Palladium Ingot", 1, [["Palladium", 2], ["Coke", 1]]),
      recipe(5, "Cut Hambergite", 1, [["Hambergite", 1]])
    ])
  }),
  logging: Object.freeze({
    verb: "Milling", action: "Mill", icon: "fa-tree", requires: ["kctg-5e"], packs: [KCTG],
    folder: ["Professions", "Timber", "Timber"],
    recipes: Object.freeze([
      recipe(1, "Charcoal", 1, [["Brushwood Bundle", 2]]),
      recipe(1, "Split Bamboo", 3, [["Bamboo", 1]]),
      recipe(1, "Cedar Plank", 2, [["Cedar Log", 1]]),
      recipe(1, "Pine Plank", 2, [["Pine Log", 1]]),
      recipe(1, "Pine Tar", 1, [["Pine Log", 2]]),
      recipe(1, "Charcoal", 2, [["Pine Log", 1]]),
      recipe(2, "Hickory Plank", 2, [["Hickory Log", 1]]),
      recipe(2, "Birch Plank", 2, [["Birch Log", 1]]),
      recipe(2, "Maple Lumber", 2, [["Maple Log", 1]]),
      recipe(2, "Fir Plank", 2, [["Fir Log", 1]]),
      recipe(3, "Oak Plank", 2, [["Oak Log", 1]]),
      recipe(3, "Teak Plank", 2, [["Teak Log", 1]]),
      recipe(3, "Redwood Plank", 2, [["Redwood Log", 1]]),
      recipe(3, "Retama Switches", 4, [["Retama", 1]]),
      recipe(4, "Poplar Lumber", 2, [["Poplar Log", 1]]),
      recipe(4, "Aspen Lumber", 2, [["Aspen Log", 1]]),
      recipe(4, "Palo Verde Bark Fibre", 3, [["Palo Verde", 1]]),
      recipe(4, "Ironwood Plank", 2, [["Ironwood Log", 1]]),
      recipe(5, "Walnut Lumber", 2, [["Walnut Log", 1]]),
      recipe(5, "Sandalwood Lumber", 2, [["Sandalwood Log", 1]]),
      recipe(5, "Sandalwood Oil", 3, [["Sandalwood Log", 1]]),
      recipe(5, "Mahogany Lumber", 2, [["Mahogany Log", 1]]),
      recipe(5, "Darkwood Plank", 2, [["Darkwood", 1]])
    ])
  }),
  skinning: Object.freeze({
    verb: "Tanning", action: "Tan", icon: "fa-scroll", requires: ["kctg-5e", HELIANA],
    packs: [KCTG, `${HELIANA}.beast`, `${HELIANA}.monstrosity`, `${HELIANA}.dragon`],
    folder: ["Professions", "Skinning", "Refined"],
    recipes: Object.freeze([
      recipe(1, "Bone Meal", 1, [["Chicken Bones", 2]]),
      recipe(1, "Cured Hide", 1, [["Mole Rat Hide", 2]]),
      recipe(1, "Cured Hide", 1, [["Fox Hide", 1]]),
      recipe(1, "Fletching Feathers", 3, [["Crow Feathers", 1]]),
      recipe(1, "Waxed Thread", 2, [["Beast Hair", 1]]),
      recipe(2, "Drayweight Leather", 1, [["Cowhide", 1]]),
      recipe(2, "Horn Plate", 2, [["Ram's Horn", 1]]),
      recipe(2, "Horn Plate", 2, [["Antlers", 1]]),
      recipe(2, "Grain Leather", 1, [["Beast Pelt", 1]]),
      recipe(2, "Bone Meal", 2, [["Beast Bone", 1]]),
      recipe(3, "Tannin Leather", 1, [["Bear Hide", 1]]),
      recipe(3, "Bone Meal", 3, [["Boar Cranium", 1]]),
      recipe(3, "Polished Teeth", 2, [["Shark Teeth", 1]]),
      recipe(3, "Ivory Plate", 2, [["Beast Tusk", 1]]),
      recipe(3, "Polished Claws", 2, [["Beast Pouch Of Claws", 1]]),
      recipe(4, "Winter Kept Pelt", 1, [["Tiger Hide", 1]]),
      recipe(4, "Chitin Plate", 1, [["Chitin", 1]]),
      recipe(4, "Chitin Plate", 3, [["Exoskeleton", 1]]),
      recipe(4, "Leather Scales", 1, [["Monstrosity Pelt", 1]]),
      recipe(4, "Bone Plate", 2, [["Monstrosity Bone", 1]]),
      recipe(5, "Dragon Leather", 1, [["Dragonhide", 1]]),
      recipe(5, "Dragonbone Plate", 2, [["Dragon Bones", 1]]),
      recipe(5, "Dragonscale Plate", 1, [["Dragon Scales", 3]]),
      recipe(5, "Polished Dragon Talon", 1, [["Dragon Talons", 1]]),
      recipe(5, "Dragon Horn Plate", 2, [["Dragon Horn", 1]])
    ])
  }),
  // Herbalism recipes are generated from the world's herbalism materials:
  // 2 of a herb make 1 "Dried <herb>".
  herbalism: Object.freeze({
    verb: "Preparation", action: "Prepare", icon: "fa-mortar-pestle", requires: [], packs: [],
    folder: ["Professions", "Herbalism", "Prepared"], dried: true, recipes: Object.freeze([])
  })
});

const gen = (from, factor, text) => Object.freeze({ from, factor, text });
// Refined goods no compendium has: created from their source Item (icon,
// type) with a new name, price = source price × factor, and this text.
export const GENERATED = Object.freeze({
  "Coke": gen("Coal", 4, "Coal baked in a closed kiln until only hard, grey, porous lumps remain. It burns hotter and cleaner than coal; smiths need it for steel and rare metals."),
  "Tin Ingot": gen("Tin", 3, "A soft, silvery bar of smelted tin, ready to alloy with copper into bronze."),
  "Marble Slab": gen("Marble", 2, "Marble cut square and rubbed smooth, ready for a mason's chisel."),
  "Polished Alabaster": gen("Alabaster", 2, "Alabaster ground and polished until it glows when held to the light."),
  "Cut Kyanite": gen("Kyanite", 2, "Kyanite cut along its blade-like crystals and polished to a deep blue."),
  "Cut Kornerupine": gen("Kornerupine", 2, "Kornerupine faceted to show its green-to-brown shift."),
  "Cut Harunite": gen("Harunite", 2, "Harunite cut and polished, its colour drawn out by the facets."),
  "Cut Ravenar": gen("Ravenar", 2, "Ravenar cut and polished to a dark, mirror-like gleam."),
  "Cut Benitoite": gen("Benitoite", 2, "Benitoite faceted until it flashes blue fire like a sapphire."),
  "Cut Hambergite": gen("Hambergite", 2, "Hambergite cut into a clear, brilliant stone."),
  "Mithral Ingot": gen("Mithral", 2.5, "Mithral purified and cast into a bar, light as a feather and stronger than steel."),
  "Adamantine Ingot": gen("Adamantine", 2.5, "A bar of adamantine purified at a white-hot forge. It barely notices a hammer blow."),
  "Cold Iron Ingot": gen("Cold Iron", 2.5, "Cold iron worked without magic and cast into a bar. Fey creatures flinch from it."),
  "Palladium Ingot": gen("Palladium", 2.5, "Palladium refined into a bright, untarnishing bar."),
  "Split Bamboo": gen("Bamboo", 0.5, "Bamboo split into long, springy strips for weaving, fletching, and light frames."),
  "Retama Switches": gen("Retama", 0.4, "Supple green retama switches stripped of leaves, bundled for basketry and broom-making."),
  "Palo Verde Bark Fibre": gen("Palo Verde", 0.5, "Inner bark of the palo verde, stripped and beaten into fibre for rope and coarse cloth."),
  "Ironwood Plank": gen("Ironwood Log", 1, "A plank of ironwood, so dense it sinks in water and dulls saw blades."),
  "Darkwood Plank": gen("Darkwood", 0.6, "A plank of darkwood, light and supple; items made from it weigh half as much."),
  "Fletching Feathers": gen("Crow Feathers", 0.5, "Feathers trimmed and split for arrow fletching."),
  "Horn Plate": gen("Ram's Horn", 0.6, "Horn boiled soft and pressed flat into translucent plates for lanterns, bows, and handles."),
  "Ivory Plate": gen("Beast Tusk", 0.6, "Tusk sawn and polished into creamy plates for inlay and carving."),
  "Polished Teeth": gen("Shark Teeth", 0.6, "Teeth cleaned, drilled, and polished for charms, arrowheads, or trade."),
  "Polished Claws": gen("Beast Pouch Of Claws", 0.6, "Claws cleaned, hardened, and polished for hooks, charms, and blade inlays."),
  "Chitin Plate": gen("Chitin", 1, "Chitin trimmed, boiled, and pressed into light, hard plates for armourers."),
  "Bone Plate": gen("Monstrosity Bone", 0.6, "Monstrous bone sawn into flat plates harder than any beast's."),
  "Dragon Leather": gen("Dragonhide", 1.5, "Dragonhide tanned into leather that shrugs off flame and blade alike."),
  "Dragonbone Plate": gen("Dragon Bones", 0.6, "Dragon bone sawn into plates, light and harder than steel."),
  "Dragonscale Plate": gen("Dragon Scales", 4, "Dragon scales trimmed, matched, and riveted into a plate ready for an armourer."),
  "Polished Dragon Talon": gen("Dragon Talons", 1.5, "A dragon talon cleaned and polished to a wicked edge."),
  "Dragon Horn Plate": gen("Dragon Horn", 0.6, "Dragon horn boiled and pressed into dark, glossy plates.")
});

/* ---------------------------------------------------------------------- */
/* Recipes                                                                 */
/* ---------------------------------------------------------------------- */

// Preset alias groups (e.g. ["Mithral", "Mithril"]): recipes use the spelling the world has.
const ALIASES = Object.values(MATERIAL_PRESETS).flatMap(preset => Object.values(preset.materials).flat()).filter(Array.isArray);

/** The name this world uses for an item that presets know under several spellings. */
export function canonicalName(name) {
  const group = ALIASES.find(names => names.includes(name));
  if (!group) return name;
  return group.find(alias => Array.from(game.items ?? []).some(item => item.name === alias)) ?? name;
}

const withId = (profession, base) => {
  const entry = { ...base, inputs: base.inputs.map(([name, quantity]) => [canonicalName(name), quantity]) };
  return { ...entry, profession,
    id: `${profession}:${slug(entry.output)}:${entry.inputs.map(([name, quantity]) => `${quantity}-${slug(name)}`).join("+")}` };
};

/** The herbalism materials currently assigned in the world, as dried recipes. */
function driedRecipes() {
  return Array.from(game.items ?? []).map(item => ({ item, rule: materialRule(item) }))
    .filter(({ rule }) => rule?.profession === "herbalism")
    .sort((a, b) => a.rule.tier - b.rule.tier || a.item.name.localeCompare(b.item.name))
    .map(({ item, rule }) => recipe(rule.tier, `${DRIED_PREFIX}${item.name}`, 1, [[item.name, 2]]));
}

/** Refining professions usable in this world (profession exists, source modules active). */
export function refiningProfessions() {
  return Object.entries(REFINING).filter(([key, entry]) =>
    PROFESSIONS[key] && entry.requires.every(id => game.modules.get(id)?.active))
    .map(([key, entry]) => ({ key, label: PROFESSIONS[key].label, verb: entry.verb, action: entry.action, icon: entry.icon }));
}

/** Recipes for one profession, each with a stable id. */
/* GM changes, saved per world:
 *   recipeEdits   { [builtInId]: { disabled?, tier?, output?, quantity?, inputs? } }
 *   customRecipes [{ id: "<profession>:custom-<random>", profession, tier, output, quantity, inputs }]
 *   recipeLearned { [id]: "learned" | "unlearned" }   (missing = auto) */
function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; }
}
const plainObject = value => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
export const recipeEdits = () => plainObject(setting("recipeEdits", {}));
export const customRecipes = () => (Array.isArray(setting("customRecipes", [])) ? setting("customRecipes", []) : []);
export const learnedStates = () => plainObject(setting("recipeLearned", {}));

/** Edits keep the built-in recipe's id, so learned states follow the recipe. */
function applyEdit(row, edit) {
  if (!edit) return row;
  const next = { ...row, edited: true };
  for (const key of ["tier", "output", "quantity", "minutes"]) if (edit[key] !== undefined) next[key] = edit[key];
  if (Array.isArray(edit.inputs)) next.inputs = edit.inputs.map(([name, quantity]) => [name, quantity]);
  if (edit.disabled) next.disabled = true;
  return next;
}

/**
 * Recipes for one profession, each with a stable id: built-ins with the GM's
 * edits, then the GM's own recipes. Disabled recipes only with `includeDisabled`.
 */
export function refiningRecipes(profession, { includeDisabled = false } = {}) {
  const entry = REFINING[profession];
  if (!entry) return [];
  const edits = recipeEdits();
  const base = (entry.dried ? driedRecipes() : entry.recipes).map(row => withId(profession, row)).map(row => applyEdit(row, edits[row.id]));
  const custom = customRecipes().filter(row => row?.profession === profession).map(row => ({ ...row, inputs: row.inputs.map(([name, quantity]) => [name, quantity]), custom: true }));
  return [...base, ...custom].filter(row => includeDisabled || !row.disabled);
}

export function allRecipes(options = {}) {
  return refiningProfessions().flatMap(({ key }) => refiningRecipes(key, options));
}

export function findRecipe(id, options = {}) {
  const profession = String(id).split(":")[0];
  return refiningRecipes(profession, options).find(row => row.id === id) ?? null;
}

/** Validate recipe fields from the GM editor; names must be world Items. */
export function normalizeRecipeFields({ profession, tier, output, quantity, inputs, minutes = null }) {
  if (!REFINING[profession] || !PROFESSIONS[profession]) throw new Error("Choose a profession tab.");
  const level = Number(tier);
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error("Tier must be 1 to 5.");
  const exists = name => Array.from(game.items ?? []).some(item => item.name === name);
  const product = String(output ?? "").trim();
  if (!product) throw new Error("Choose the product Item.");
  if (!exists(product)) throw new Error(`No world Item is named "${product}". Drag the product from the Items sidebar.`);
  const made = Number(quantity);
  if (!Number.isInteger(made) || made < 1 || made > 99) throw new Error("Product quantity must be a whole number from 1 to 99.");
  const rows = (inputs ?? []).map(([name, count]) => [String(name ?? "").trim(), Number(count)]).filter(([name]) => name);
  if (!rows.length) throw new Error("Add at least one ingredient.");
  if (rows.length > 6) throw new Error("A recipe can have at most 6 ingredients.");
  for (const [name, count] of rows) {
    if (!exists(name)) throw new Error(`No world Item is named "${name}". Drag ingredients from the Items sidebar.`);
    if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error(`${name}: quantity must be a whole number from 1 to 99.`);
  }
  if (new Set(rows.map(([name]) => name)).size !== rows.length) throw new Error("List each ingredient once.");
  if (rows.some(([name]) => name === product)) throw new Error("A recipe cannot use its own product.");
  // Blank = the tier's default time (Rules).
  let time = null;
  if (minutes !== null && minutes !== undefined && String(minutes).trim() !== "") {
    time = Number(minutes);
    if (!Number.isInteger(time) || time < 0 || time > MAX_REFINE_MINUTES) throw new Error("Time must be whole minutes from 0 to 10080 (one week), or blank for the tier default.");
  }
  return { profession, tier: level, output: product, quantity: made, inputs: rows, minutes: time };
}

/** Players' clients need the product Item: make it Observer. */
async function shareProduct(name) {
  const item = Array.from(game.items ?? []).find(entry => entry.name === name);
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  if (item && (item.ownership?.default ?? 0) < observer) await item.update({ "ownership.default": observer });
}

const requireGM = () => { if (!game.user.isGM) throw new Error("Only the GM may change recipes."); };

/** GM: add a recipe. Returns it. */
export async function createRecipe(fields) {
  requireGM();
  const data = normalizeRecipeFields(fields);
  const row = { id: `${data.profession}:custom-${foundry.utils.randomID()}`, ...data };
  await game.settings.set(MODULE_ID, "customRecipes", [...customRecipes(), row]);
  await shareProduct(data.output);
  return row;
}

/** GM: change a recipe (built-in: saved as an edit over the default; custom: replaced). */
export async function updateRecipe(id, fields) {
  requireGM();
  const current = findRecipe(id, { includeDisabled: true });
  if (!current) throw new Error("That recipe no longer exists.");
  const data = normalizeRecipeFields({ ...fields, profession: current.profession });
  if (current.custom) {
    await game.settings.set(MODULE_ID, "customRecipes", customRecipes().map(row => (row.id === id ? { ...row, ...data } : row)));
  } else {
    const edits = recipeEdits();
    await game.settings.set(MODULE_ID, "recipeEdits", { ...edits, [id]: { ...(edits[id] ?? {}), tier: data.tier, output: data.output, quantity: data.quantity, inputs: data.inputs, minutes: data.minutes } });
  }
  await shareProduct(data.output);
  return findRecipe(id, { includeDisabled: true });
}

/** GM: hide a built-in recipe from everyone (or bring it back). */
export async function setRecipeDisabled(id, disabled = true) {
  requireGM();
  const current = findRecipe(id, { includeDisabled: true });
  if (!current || current.custom) throw new Error("Only built-in recipes can be disabled; delete your own recipes instead.");
  const edits = { ...recipeEdits() };
  const edit = { ...(edits[id] ?? {}) };
  if (disabled) edit.disabled = true; else delete edit.disabled;
  if (Object.keys(edit).length) edits[id] = edit; else delete edits[id];
  await game.settings.set(MODULE_ID, "recipeEdits", edits);
}

/** GM: undo every change to a built-in recipe. */
export async function resetRecipe(id) {
  requireGM();
  const edits = { ...recipeEdits() };
  delete edits[id];
  await game.settings.set(MODULE_ID, "recipeEdits", edits);
}

/** GM: delete one of their own recipes. */
export async function deleteRecipe(id) {
  requireGM();
  if (!customRecipes().some(row => row.id === id)) throw new Error("Only your own recipes can be deleted.");
  await game.settings.set(MODULE_ID, "customRecipes", customRecipes().filter(row => row.id !== id));
  await setLearnedState(id, "auto");
}

/** GM: "learned" (always known), "unlearned" (always hidden), or "auto" (known when the party has every input). */
export async function setLearnedState(id, state) {
  requireGM();
  if (!["learned", "unlearned", "auto"].includes(state)) throw new Error("Choose Auto, Learned, or Unlearned.");
  const states = { ...learnedStates() };
  if (state === "auto") delete states[id]; else states[id] = state;
  await game.settings.set(MODULE_ID, "recipeLearned", states);
}

/* ---------------------------------------------------------------------- */
/* Party discovery: an input is known once any player character had it.   */
/* ---------------------------------------------------------------------- */

export function discoveredNames() {
  let saved = [];
  try { saved = game.settings.get(MODULE_ID, "discoveredItems") ?? []; } catch { saved = []; }
  return new Set(Array.isArray(saved) ? saved : []);
}

/** A recipe is known when the party has had every one of its inputs. */
export function isKnown(entry, names = discoveredNames(), states = learnedStates()) {
  if (entry.disabled) return false;
  if (states[entry.id] === "learned") return true;
  if (states[entry.id] === "unlearned") return false;
  return entry.inputs.every(([name]) => names.has(name));
}

const isPartyActor = actor => actor?.type === "character" && Boolean(actor.hasPlayerOwner);

/** GM: add item names to the party's discoveries. Returns the new names. */
export async function recordDiscoveries(names) {
  if (!game.user.isGM) return [];
  const known = discoveredNames();
  const fresh = [...new Set(names)].filter(name => name && !known.has(name));
  if (fresh.length) await game.settings.set(MODULE_ID, "discoveredItems", [...known, ...fresh].sort());
  return fresh;
}

/** GM: record everything player characters carry now. */
export async function backfillDiscoveries() {
  const names = Array.from(game.actors ?? []).filter(isPartyActor).flatMap(actor => Array.from(actor.items ?? []).map(item => item.name));
  return recordDiscoveries(names);
}

let discoveryQueue = Promise.resolve();
/** Active GM: watch player characters' inventories for new item names. */
export function registerDiscoveryHooks(isActiveGM) {
  Hooks.on("createItem", item => {
    if (!isActiveGM() || !isPartyActor(item.parent)) return;
    discoveryQueue = discoveryQueue.then(() => recordDiscoveries([item.name])).catch(error => console.error(`${MODULE_ID}: discovery`, error));
  });
}

/* ---------------------------------------------------------------------- */
/* Refined Items in the world (players craft from these)                  */
/* ---------------------------------------------------------------------- */

/** Item data made from a source Item: renamed, repriced, gathering flags removed. */
export function derivedData(source, name, factor, text, folder = null, weightFactor = 1) {
  const data = typeof source.toObject === "function" ? source.toObject() : structuredClone(source);
  delete data._id;
  delete data._stats;
  data.name = name;
  data.folder = folder;
  data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const price = Number(data.system?.price?.value) || 0;
  const denomination = data.system?.price?.denomination || "gp";
  foundry.utils.setProperty(data, "system.price", { value: Math.max(1, Math.round(price * factor * 100) / 100), denomination });
  const weight = Number(data.system?.weight?.value);
  if (Number.isFinite(weight) && weightFactor !== 1) foundry.utils.setProperty(data, "system.weight.value", Math.round(weight * weightFactor * 100) / 100);
  foundry.utils.setProperty(data, "system.quantity", 1);
  foundry.utils.setProperty(data, "system.description.value", `<p>${text}</p>`);
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { refinedFrom: source.name, generatedItem: name } };
  return data;
}

/** World Item data for the dried form of a herb (no gathering flags). */
export function driedItemData(herb, folder = null) {
  const data = derivedData(herb, `${DRIED_PREFIX}${herb.name}`, 3,
    `Dried and bundled for storage; keeps for months. Prepared by a herbalist from two fresh ${herb.name}.`, folder, 0.5);
  data.flags[MODULE_ID].preparedFrom = herb.name;
  return data;
}

const worldItemNamed = name => Array.from(game.items ?? []).find(item => item.name === name) ?? null;

/** The world Item a recipe produces, if prepared. */
export function productItem(name) {
  return worldItemNamed(name);
}

/**
 * GM: make sure every recipe's inputs and products exist as world Items.
 * Products are imported (Kris, Heliana), generated, or dried; they are made
 * visible to players (Observer) so their clients can craft them.
 * @returns {Promise<{created: number, imported: number, shared: number, missing: string[]}>}
 */
export async function prepareRefinedItems(professions = refiningProfessions().map(entry => entry.key)) {
  if (!game.user.isGM) throw new Error("Only the GM may prepare refined items.");
  const report = { created: 0, imported: 0, shared: 0, missing: [] };
  const cache = new Map();
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  for (const profession of professions) {
    const entry = REFINING[profession];
    if (!entry || !PROFESSIONS[profession]) continue;
    const folder = await folderPath(entry.folder);
    const inputFolder = await folderPath(MATERIAL_PRESETS[profession]?.folder ?? ["Professions", PROFESSIONS[profession].label]);
    const recipes = refiningRecipes(profession);
    const products = new Map(recipes.map(row => [row.output, row]));
    // Inputs that are themselves products (Copper Ingot, Coke) are made below.
    for (const row of recipes) {
      for (const [name] of row.inputs) {
        if (worldItemNamed(name) || products.has(name)) continue;
        try { const found = await worldItem(entry.packs, name, inputFolder, cache); if (found.imported) report.imported++; }
        catch { report.missing.push(name); }
      }
    }
    const pending = [...products.values()];
    // Generated items need their source first; repeat while progress is made.
    for (let pass = 0; pass < 3 && pending.length; pass++) {
      for (const row of [...pending]) {
        let item = worldItemNamed(row.output);
        if (!item && entry.dried) {
          const herb = worldItemNamed(row.inputs[0][0]);
          if (herb) { [item] = await Item.implementation.create([driedItemData(herb, folder.id)]); report.created++; }
        } else if (!item && GENERATED[row.output]) {
          const spec = GENERATED[row.output];
          const source = worldItemNamed(canonicalName(spec.from));
          if (source) { [item] = await Item.implementation.create([derivedData(source, row.output, spec.factor, spec.text, folder.id)]); report.created++; }
        } else if (!item) {
          try { const found = await worldItem(entry.packs, row.output, folder, cache); item = found.item; if (found.imported) report.imported++; }
          catch { item = null; }
        }
        if (!item) continue;
        pending.splice(pending.indexOf(row), 1);
        if ((item.ownership?.default ?? 0) < observer) {
          await item.update({ "ownership.default": observer });
          report.shared++;
        }
      }
    }
    report.missing.push(...pending.map(row => row.output));
  }
  report.missing = [...new Set(report.missing)];
  return report;
}

/* ---------------------------------------------------------------------- */
/* Crafting                                                                */
/* ---------------------------------------------------------------------- */

const itemQuantity = item => Math.max(0, Number(item?.system?.quantity) || 0);

export function inventoryCount(actor, name) {
  return Array.from(actor?.items ?? []).filter(item => item.name === name).reduce((sum, item) => sum + itemQuantity(item), 0);
}

/** How many batches the actor's inventory allows. */
export function maxBatch(actor, entry) {
  const totals = new Map();
  for (const [name, quantity] of entry.inputs) totals.set(name, (totals.get(name) ?? 0) + quantity);
  return Math.min(...[...totals].map(([name, quantity]) => Math.floor(inventoryCount(actor, name) / quantity)));
}

/** The refining check numbers for an actor and recipe (no roll). */
export function refineCheckFor(actor, entry) {
  const rules = activeRules();
  const tier = Math.min(5, Math.max(1, Math.trunc(Number(entry.tier)) || 1));
  const xp = Math.max(0, Number(professionFlag(actor, "xp", entry.profession)) || 0);
  return { tier, ...checkFormula(actor, entry.profession, xp, rules.refineDc[tier - 1], { tier }) };
}

export async function removeFromInventory(actor, name, quantity) {
  let left = quantity;
  const updates = [];
  const deletes = [];
  for (const item of Array.from(actor.items).filter(entry => entry.name === name)) {
    if (left <= 0) break;
    const have = itemQuantity(item);
    if (have <= left) { deletes.push(item.id); left -= have; }
    else { updates.push({ _id: item.id, "system.quantity": have - left }); left = 0; }
  }
  if (left > 0) throw new Error(`${actor.name} does not have enough ${name}.`);
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (deletes.length) await actor.deleteEmbeddedDocuments("Item", deletes);
}

/** Add gold pieces to a character's dnd5e currency. */
export async function addGold(actor, amount) {
  const gold = Math.round(Number(amount) || 0);
  if (!gold) return;
  const current = Number(actor.system?.currency?.gp) || 0;
  await actor.update({ "system.currency.gp": current + gold });
}

/** Add an item (by data) to an inventory, stacking onto an item with the same name. */
export async function addToInventory(actor, data, quantity) {
  const signature = source => {
    const system = structuredClone(source.system ?? {});
    delete system.quantity;
    return JSON.stringify({ type: source.type, system, flags: source.flags ?? {} });
  };
  const existing = Array.from(actor.items).find(item => item.name === data.name && signature(item.toObject()) === signature(data));
  if (existing) return actor.updateEmbeddedDocuments("Item", [{ _id: existing.id, "system.quantity": itemQuantity(existing) + quantity }]);
  const copy = structuredClone(data);
  delete copy._id;
  delete copy.folder;
  delete copy.ownership;
  foundry.utils.setProperty(copy, "system.quantity", quantity);
  return actor.createEmbeddedDocuments("Item", [copy]);
}

const LABELS = Object.freeze({ failed: "Failed", partial: "Near Miss", successful: "Success", excellent: "Excellent", masterful: "Masterful" });

export function formatMinutes(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${minutes}m`;
}

/**
 * Refine `batch` times at once with one check (the actor's owner or GM).
 * Near miss (fail by < 5): nothing made, materials kept. Fail by 5+ or a
 * natural 1: half the materials (rounded up) lost. Success: the products (+1
 * on Excellent, +2 on Masterful or a natural 20) and Refining XP per unit;
 * with timed crafting they arrive after the recipe's time in world time.
 */
export function craftRecipe(actor, id, batch = 1, options) {
  return runActorAction(actor, () => craftRecipeUnlocked(actor, id, batch, options));
}

async function craftRecipeUnlocked(actor, id, batch = 1, { addXp }) {
  if (!actor || !(game.user.isGM || actor.isOwner)) throw new Error("Choose a character you own.");
  const entry = findRecipe(id);
  if (!entry) throw new Error("That recipe no longer exists.");
  if (!game.user.isGM && !isKnown(entry)) throw new Error("Your party has not discovered this recipe.");
  const count = Math.trunc(Number(batch));
  if (!Number.isInteger(count) || count < 1) throw new Error("Choose how many to make.");
  if (count > maxBatch(actor, entry)) throw new Error(`${actor.name} does not have enough materials for ${count}.`);
  const product = productItem(entry.output);
  if (!product) throw new Error(`${entry.output} is not prepared in this world yet. Ask the GM (GM hub → Materials → Prepare refined items).`);
  const rules = activeRules();
  const check = refineCheckFor(actor, entry);
  const roll = await rollProfessionCheck(actor, check);
  const natural = roll.dice?.[0]?.total;
  let degree = getDegreeOfSuccess(roll.total, check.target);
  if (natural === 20) degree = naturalMasterful(degree);
  if (natural === 1 && degree.id !== "failed") degree = { ...degree, id: "failed", natural1: true };
  const success = ["successful", "excellent", "masterful"].includes(degree.id);
  const lost = degree.id === "failed" ? entry.inputs.map(([name, quantity]) => [name, Math.ceil(quantity * count / 2)])
    : success ? entry.inputs.map(([name, quantity]) => [name, quantity * count]) : [];
  for (const [name, quantity] of lost) await removeFromInventory(actor, name, quantity);
  const bonus = degree.id === "masterful" ? 2 : degree.id === "excellent" ? 1 : 0;
  const made = success ? entry.quantity * count + bonus : 0;
  const xp = success ? rules.refineXp[check.tier - 1] * count : 0;
  if (xp) await addXp(actor, entry.profession, xp);
  let job = null;
  if (made) {
    const minutes = rules.craftingTimed ? recipeMinutes(entry, rules) * count : 0;
    const data = product.toObject();
    if (minutes) job = await queueJob(actor, { name: entry.output, img: product.img, quantity: made, data, ready: (game.time?.worldTime ?? 0) + minutes * 60, recipe: id, minutes });
    else await addToInventory(actor, data, made);
  }
  const verb = REFINING[entry.profession]?.verb ?? "Refining";
  const label = PROFESSIONS[entry.profession]?.label ?? entry.profession;
  const used = entry.inputs.map(([name, quantity]) => `${quantity * count} ${escape(name)}`).join(", ");
  const outcome = success ? `${made} ${escape(entry.output)}${bonus ? ` (+${bonus} ${LABELS[degree.id].toLowerCase()})` : ""}${job ? `, ready in ${formatMinutes(job.minutes)}` : ""}.`
    : degree.id === "failed" ? `Ruined: lost ${lost.map(([name, quantity]) => `${quantity} ${escape(name)}`).join(", ")}.` : "Nothing made; materials kept.";
  const flavor = `<div class="gathering-professions-chat"><strong>${verb}: ${escape(entry.output)}${count > 1 ? ` ×${count}` : ""}</strong>
    <br>${escape(label)} check, tier ${check.tier} · DC ${check.target}${check.trained ? ` (rank ${check.rank}, d${check.die})` : " (untrained)"} · from ${used}
    <br><strong>${LABELS[degree.id]}</strong>${natural === 20 ? " (natural 20)" : degree.natural1 ? " (natural 1)" : ""}: ${outcome}${xp ? ` +${xp} ${escape(label)} XP.` : ""}</div>`;
  try { await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor }); }
  catch (error) { console.error(`${MODULE_ID}: could not post the refining roll`, error); }
  return { degree: degree.id, made, lost, xp, job, total: roll.total, target: check.target };
}

/* ---------------------------------------------------------------------- */
/* Timed jobs (actor flag refiningJobs)                                    */
/* ---------------------------------------------------------------------- */

/** Queue finished goods for later delivery (shared with crafting modules). */
export async function queueJob(actor, job) {
  const id = foundry.utils.randomID();
  const record = { ...job, id };
  await actor.setFlag(MODULE_ID, `refiningJobs.${id}`, record);
  return record;
}

export function actorJobs(actor) {
  return Object.values(actor?.getFlag?.(MODULE_ID, "refiningJobs") ?? {}).filter(job => job && job.id)
    .sort((a, b) => a.ready - b.ready);
}

/** Deliver the actor's finished jobs. Returns the delivered jobs. */
export function deliverDueJobs(actor, now = game.time?.worldTime ?? 0) {
  return runActorAction(actor, async () => {
    const delivered = [];
    for (const job of actorJobs(actor).filter(job => job.ready <= now)) {
      const path = `flags.${MODULE_ID}.refiningJobs.${job.id}`;
      // Gold and its receipt are stored in the same Actor update. A retry never
      // pays twice even if item delivery or removing the job subsequently fails.
      if (job.gold && !job.goldDelivered) await actor.update({
        "system.currency.gp": (Number(actor.system?.currency?.gp) || 0) + Math.round(job.gold),
        [`${path}.goldDelivered`]: true
      });
      if (job.data && !Array.from(actor.items).some(item => item.getFlag?.(MODULE_ID, "deliveryJob") === job.id)) {
        const data = structuredClone(job.data);
        delete data._id; delete data.folder; delete data.ownership;
        foundry.utils.setProperty(data, "system.quantity", job.quantity);
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.deliveryJob`, job.id);
        // Do not stack until settled: the embedded Item itself is the receipt.
        await actor.createEmbeddedDocuments("Item", [data]);
      }
      await actor.update({ [`flags.${MODULE_ID}.refiningJobs.-=${job.id}`]: null });
      delivered.push(job);
    }
    if (delivered.length) ui.notifications.info(`${actor.name}: ${delivered.map(job => job.gold && !job.data ? `${job.gold} gp (${job.name})` : `${job.quantity} ${job.name}`).join(", ")} ready.`);
    return delivered;
  });
}

/** Active GM: deliver every actor's finished jobs (on world time changes). */
export async function deliverAllDueJobs(now = game.time?.worldTime ?? 0) {
  const delivered = [];
  for (const actor of Array.from(game.actors ?? [])) {
    if (actorJobs(actor).some(job => job.ready <= now)) delivered.push(...await deliverDueJobs(actor, now));
  }
  return delivered;
}

/* ---------------------------------------------------------------------- */
/* Recipes-window providers (one tab per refining profession)              */
/* ---------------------------------------------------------------------- */

/** The Recipes-window provider for one refining profession. */
export function refiningProvider(profession, { addXp }) {
  const entry = REFINING[profession];
  return {
    key: profession, order: 10 + Object.keys(REFINING).indexOf(profession),
    get label() { return PROFESSIONS[profession]?.label ?? profession; },
    verb: entry.verb, action: entry.action, icon: entry.icon,
    get rollLabel() { return `Rolls ${PROFESSIONS[profession]?.label ?? profession} at the recipe's tier`; },
    learnOptions: [["auto", "Auto"], ["learned", "Learned"], ["unlearned", "Unlearned"]],
    learnHint: "Auto: learned once the party has had every ingredient",
    perCharacter: false,
    hiddenHint: "Gather new materials to discover more ways to make this", hiddenWord: "undiscovered",
    emptyText: "No recipes discovered yet. Gather materials to discover what they refine into.",
    gmHint: "Eye: whether players see it. Auto = learned once the party has had every ingredient.",
    visible: () => Boolean(PROFESSIONS[profession]) && entry.requires.every(id => game.modules.get(id)?.active),
    recipes: options => refiningRecipes(profession, options),
    isKnown: row => isKnown(row),
    learnState: row => learnedStates()[row.id] ?? "auto",
    setLearned: (id, state) => setLearnedState(id, state),
    check: (actor, row) => refineCheckFor(actor, row),
    blocked: () => null,
    minutes: row => recipeMinutes(row),
    defaultMinutes: tier => recipeMinutes({ tier }),
    craft: (actor, id, batch) => craftRecipe(actor, id, batch, { addXp }),
    gm: {
      create: fields => createRecipe({ ...fields, profession }),
      update: (id, fields) => updateRecipe(id, fields),
      disable: (id, on) => setRecipeDisabled(id, on),
      reset: id => resetRecipe(id),
      delete: id => deleteRecipe(id)
    },
    itemGroups: search => refiningItemGroups(profession, search)
  };
}

/** Editor picker groups: this profession's materials, refined goods, other items. */
export function refiningItemGroups(profession, search = "") {
  const label = PROFESSIONS[profession]?.label ?? "Profession";
  const refined = new Set(allRecipes({ includeDisabled: true }).map(row => row.output));
  return itemPickerGroups(search, [
    { label: `${label} materials`, filter: item => materialRule(item)?.profession === profession },
    { label: "Refined goods", filter: item => refined.has(item.name) }
  ]);
}

const OTHER_LIMIT = 60;
/**
 * World Items grouped for a picker: each group's filter in order (an item
 * appears once), then "Other items" (first 60 until searched).
 */
export function itemPickerGroups(search = "", groups = []) {
  const query = search.trim().toLowerCase();
  const items = Array.from(game.items ?? []).filter(item => item?.name).sort((a, b) => a.name.localeCompare(b.name));
  const match = item => !query || item.name.toLowerCase().includes(query);
  const seen = new Set();
  const take = list => list.filter(item => match(item) && !seen.has(item.name) && seen.add(item.name)).map(item => ({ name: item.name, img: item.img || "icons/svg/item-bag.svg" }));
  const result = groups.map(group => ({ label: group.label, items: take(items.filter(group.filter)) }));
  const other = { label: "Other items", items: take(items) };
  other.more = Math.max(0, other.items.length - OTHER_LIMIT);
  other.items = other.items.slice(0, OTHER_LIMIT);
  return [...result, other].filter(group => group.items.length || group.more);
}
