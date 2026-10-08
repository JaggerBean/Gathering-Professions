import { baseYieldFormula } from "./gathering.js";

export const MODULE_ID = "gathering-professions";

export const ABILITY_LABELS = Object.freeze({
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma"
});

// Defaults for a world that has never saved a custom profession list.
export const DEFAULT_PROFESSIONS = Object.freeze([
  Object.freeze({ key: "mining", label: "Mining", ability: "str", rareTable: "" }),
  Object.freeze({ key: "herbalism", label: "Herbalism", ability: "wis", rareTable: "" }),
  Object.freeze({ key: "logging", label: "Logging", ability: "str", rareTable: "" }),
  Object.freeze({ key: "skinning", label: "Skinning", ability: "wis", rareTable: "" })
]);

// Form field names already used by the profession dialogs.
const RESERVED_KEYS = new Set(["selectedprofession", "assignment", "tier", "dc", "xp", "baseyield", "untraineddc", "raretable", "advancementmode", "any", "none", "automatic"]);

/**
 * Validate a GM-edited profession list. Throws a readable Error on bad input.
 * @param {Array<{key?: string, label: string, ability: string, rareTable?: string, rareTables?: string[]}>} list
 */
export function normalizeProfessions(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("Define at least one profession.");
  const seen = new Set();
  return list.map(entry => {
    const label = String(entry?.label ?? "").trim();
    if (!label) throw new Error("Every profession needs a name.");
    const key = String(entry?.key ?? "").trim() || slugify(label);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(key)) throw new Error(`Profession key "${key}" must start with a letter and use only lowercase letters, numbers, and dashes.`);
    if (RESERVED_KEYS.has(key) || key.startsWith("rank_")) throw new Error(`"${key}" is a reserved name. Choose another profession key.`);
    if (seen.has(key)) throw new Error(`Two professions use the key "${key}".`);
    seen.add(key);
    const ability = String(entry?.ability ?? "");
    if (!Object.hasOwn(ABILITY_LABELS, ability)) throw new Error(`${label}: choose a valid ability.`);
    const rareTable = typeof entry?.rareTable === "string" ? entry.rareTable.trim() : "";
    // One rare-find table per material tier (1–5); blank tiers use rareTable.
    const rareTables = Array.from({ length: 5 }, (_, index) => {
      const value = Array.isArray(entry?.rareTables) ? entry.rareTables[index] : "";
      return typeof value === "string" ? value.trim() : "";
    });
    // Default accepted gathering tools [{uuid, name, img}]; a node may replace them.
    const tools = (Array.isArray(entry?.tools) ? entry.tools : [])
      .map(tool => ({ uuid: String(tool?.uuid ?? "").trim(), name: String(tool?.name ?? "").trim(), img: String(tool?.img ?? "") }))
      .filter(tool => tool.uuid || tool.name);
    return { key, label, ability, rareTable, rareTables, tools };
  });
}

export function slugify(label) {
  return String(label).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(\d)/, "p$1").slice(0, 32);
}

// Preserve data saved before the Harvesting profession was renamed.
export function professionKey(key) {
  return key === "harvesting" ? "skinning" : key;
}

export function professionFlag(actor, field, profession) {
  const value = actor?.getFlag?.(MODULE_ID, `${field}.${profession}`);
  return value ?? (profession === "skinning" ? actor?.getFlag?.(MODULE_ID, `${field}.harvesting`) : undefined);
}

/** The world's profession list as a key → definition map. Falls back to defaults. */
export function getProfessions() {
  let saved;
  try { saved = globalThis.game?.settings?.get(MODULE_ID, "professions"); }
  catch { /* Not registered yet during init. */ }
  let list = DEFAULT_PROFESSIONS;
  if (Array.isArray(saved) && saved.length) {
    try {
      const entries = normalizeProfessions(saved);
      list = entries.filter(entry => entry.key !== "harvesting" || !entries.some(other => other.key === "skinning"))
        .map(entry => entry.key === "harvesting"
        ? { ...entry, key: "skinning", label: entry.label === "Harvesting" ? "Skinning" : entry.label }
        : entry);
    }
    catch (error) { console.error(`${MODULE_ID}: saved profession list is invalid; using defaults.`, error); }
  }
  return Object.fromEntries(list.map(({ key, ...rest }) => [key, { key, ...rest }]));
}

// Live view of getProfessions(), so existing PROFESSIONS[key] and
// Object.entries(PROFESSIONS) code follows the GM-edited list.
export const PROFESSIONS = new Proxy({}, {
  get: (_target, key) => typeof key === "string" ? getProfessions()[key] : undefined,
  has: (_target, key) => Object.hasOwn(getProfessions(), key),
  ownKeys: () => Object.keys(getProfessions()),
  getOwnPropertyDescriptor: (_target, key) => {
    const professions = getProfessions();
    return Object.hasOwn(professions, key)
      ? { value: professions[key], writable: false, enumerable: true, configurable: true } : undefined;
  },
  set: () => false, defineProperty: () => false, deleteProperty: () => false
});

// Total XP needed to enter ranks 1 through 5.
export const RANK_XP = Object.freeze([0, 100, 300, 700, 1500]);
export const RANK_DIE = Object.freeze([4, 6, 8, 10, 12]);
export const RANK_DC_REDUCTION = Object.freeze([0, 2, 4, 6, 8]);
export const TIER_DC = Object.freeze([10, 14, 18, 23, 28]);
export const TIER_XP = Object.freeze([5, 10, 20, 35, 60]);
export const TIER_UNTRAINED_DC = Object.freeze([0, 0, 0, 0, 0]);
export const EXCELLENT_RARE_BONUS = 10;
// Durability of a tool with no maximum of its own (0 = tools never wear).
export const TOOL_DURABILITY = 10;
export const GATHER_ATTEMPTS_PER_REST = 5;

export function activeRules() {
  let saved = {};
  try { saved = globalThis.game?.settings?.get(MODULE_ID, "rules") || {}; }
  catch { /* The setting is not registered during module initialization. */ }
  const values = (key, defaults) => defaults.map((value, index) => {
    const candidate = Number(saved[key]?.[index]);
    return Number.isFinite(candidate) && candidate >= 0 ? candidate : value;
  });
  return {
    rankXp: values("rankXp", RANK_XP),
    tierDc: values("tierDc", TIER_DC),
    tierXp: values("tierXp", TIER_XP),
    rankDcReduction: values("rankDcReduction", RANK_DC_REDUCTION),
    tierUntrainedDc: values("tierUntrainedDc", TIER_UNTRAINED_DC),
    milestoneAdvancement: saved.milestoneAdvancement === true,
    // Masterful extractions roll the rare-find table unless the GM turns it off.
    masterfulRareFind: saved.masterfulRareFind !== false,
    // Excellent extractions add this to a trained gatherer's rare-find chance (%).
    excellentRareBonus: Number.isInteger(Number(saved.excellentRareBonus)) && Number(saved.excellentRareBonus) >= 0 && Number(saved.excellentRareBonus) <= 100
      ? Number(saved.excellentRareBonus) : EXCELLENT_RARE_BONUS,
    toolDurability: Number.isInteger(Number(saved.toolDurability)) && Number(saved.toolDurability) >= 0 && Number(saved.toolDurability) <= 1000
      ? Number(saved.toolDurability) : TOOL_DURABILITY,
    gatherAttemptsPerRest: Number.isInteger(Number(saved.gatherAttemptsPerRest)) && Number(saved.gatherAttemptsPerRest) >= 0 && Number(saved.gatherAttemptsPerRest) <= 100
      ? Number(saved.gatherAttemptsPerRest) : GATHER_ATTEMPTS_PER_REST
  };
}

// Defaults for the world Items in Professions > Mining. An Item's
// flags.gathering-professions.material overrides any field here.
export const MINING_MATERIALS = Object.freeze({
  "Stone": 1, "Cobblestones": 1, "Sandstone": 1, "Siltstone": 1,
  "Coal": 1, "Copper Ore": 1, "Tin": 1, "Fool's Gold": 1,
  "Serpentine": 1, "Tiger's Eye": 1, "Carnelian": 1,
  "Granite": 2, "Quartzite": 2, "Marble": 2, "Alabaster": 2,
  "Lead": 2, "Iron Ore": 2, "Aluminum Ore": 2,
  "Cassiterite": 2, "Kyanite": 2, "Pyrope": 2,
  "Silver Ore": 3, "Gold Ore": 3, "Morganite": 3,
  "Rubellite": 3, "Wulfenite": 3, "Latratite": 3,
  "Didntonite": 3,
  "Platinum Ore": 4, "Kornerupine": 4, "Harunite": 4,
  "Ravenar": 4, "Benitoite": 4,
  "Mithril": 5, "Hambergite": 5
});
const MINING_FOLDER_IDS = new Set([
  "Wkx8ircLDt9noLvA", // Stones
  "SNA2HD9SFFE3nK5M", // Ores
  "wUpErlf99KqnnRYI"  // Gemstones
]);

export function rankForXp(xp) {
  const value = Math.max(0, Number(xp) || 0);
  const thresholds = activeRules().rankXp;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) return i + 1;
  }
  return 1;
}

export function selectedProfession(actor) {
  const key = professionKey(actor?.getFlag?.(MODULE_ID, "selectedProfession"));
  return Object.hasOwn(PROFESSIONS, key) ? key : null;
}

export function rankForActor(actor, profession, xp) {
  if (selectedProfession(actor) !== professionKey(profession)) return 0;
  if (!activeRules().milestoneAdvancement) {
    return rankForXp(xp ?? professionFlag(actor, "xp", profession));
  }
  const rank = Number(professionFlag(actor, "rank", profession));
  return Number.isInteger(rank) && rank >= 1 && rank <= 5 ? rank : 1;
}

export function materialRule(item) {
  const override = item?.getFlag?.(MODULE_ID, "material");
  if (override?.enabled === false) return null;
  // Foundry may expose a Folder document or only its stored id here, depending
  // on where the Item came from. The stored id is also reliable for table draws.
  const folderId = typeof item?.folder === "string" ? item.folder : item?.folder?.id ?? item?._source?.folder;
  const defaultTier = MINING_FOLDER_IDS.has(folderId) ? MINING_MATERIALS[item?.name] : undefined;
  if (!defaultTier && !override?.profession) return null;
  const profession = professionKey(override?.profession || "mining");
  if (!PROFESSIONS[profession]) return null;
  const tier = Math.min(5, Math.max(1, Number(override?.tier ?? defaultTier) || 1));
  const rules = activeRules();
  return {
    profession,
    tier,
    dc: Number.isFinite(Number(override?.dc)) && override?.dc !== undefined && override?.dc !== null
      ? Number(override.dc) : rules.tierDc[tier - 1],
    xp: Number.isFinite(Number(override?.xp)) && override?.xp !== undefined && override?.xp !== null
      ? Math.max(0, Number(override.xp)) : rules.tierXp[tier - 1],
    baseYield: baseYieldFormula(override?.baseYield),
    untrainedDc: Math.max(0, Number(override?.untrainedDc) || 0),
    conditions: Array.isArray(override?.conditions) ? override.conditions : [],
    // Material override first, then the profession's rare-find table.
    rareTable: (typeof override?.rareTable === "string" && override.rareTable.trim())
      || PROFESSIONS[profession].rareTable || "",
    // The material's own rare table only (replaces the tier table it starts on).
    materialRareTable: typeof override?.rareTable === "string" ? override.rareTable.trim() : ""
  };
}

export function checkFormula(actor, profession, xp, dc, material = {}) {
  const rank = rankForActor(actor, profession, xp);
  const trained = rank > 0;
  const ability = PROFESSIONS[profession].ability;
  const modifier = Number(actor?.system?.abilities?.[ability]?.mod) || 0;
  const rules = activeRules();
  const die = trained ? RANK_DIE[rank - 1] : null;
  const reduction = trained ? rules.rankDcReduction[rank - 1] : 0;
  const tierPenalty = trained ? 0 : rules.tierUntrainedDc[(material.tier ?? 1) - 1] ?? 0;
  const materialPenalty = trained ? 0 : Math.max(0, Number(material.untrainedDc) || 0);
  return { rank, trained, ability, modifier, die, reduction, tierPenalty, materialPenalty,
    target: dc - reduction + tierPenalty + materialPenalty,
    formula: `1d20 + ${modifier}${trained ? ` + 1d${die}` : ""}` };
}
