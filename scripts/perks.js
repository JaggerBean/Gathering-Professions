// Gathering perks: the effects a perk Item can carry, validation, and the
// combined totals for one actor. Perks usually come from the universal Skill
// Tree, but any Item with flags.gathering-professions.perk counts.
import { MODULE_ID, PROFESSIONS, professionKey } from "./rules.js";

export const MAX_PERK_YIELD = 20;
export const MAX_CONSERVE = 90;

/**
 * Every perk effect. kind: "int" sums (capped at max), "die" keeps the largest,
 * "fraction" keeps the largest (0–1), "flag" is on if any perk has it.
 */
export const PERK_EFFECTS = Object.freeze({
  checkBonus: { kind: "int", max: 10, label: "Check bonus", hint: "Flat bonus to gathering checks." },
  dcReduction: { kind: "int", max: 10, label: "DC reduction", hint: "Lowers the final gathering DC." },
  checkDie: { kind: "die", dice: [4, 6, 8], label: "Bonus die", hint: "Extra die added to gathering checks." },
  partialAsFull: { kind: "flag", label: "Partial counts as success", hint: "Partial extractions become Successful extractions." },
  rerolls: { kind: "int", max: 5, label: "Rerolls per long rest", hint: "When a gather fails, the player is asked whether to reroll it while uses remain. Declining keeps the use." },
  masterfulUses: { kind: "int", max: 5, label: "Auto-Masterful per long rest", hint: "Before gathering, the player may choose an automatic Masterful extraction (no check roll). Its rare find still needs the Fortune die to climb." },
  yieldBonus: { kind: "int", max: MAX_PERK_YIELD, label: "Yield bonus", hint: "Added to Successful, Excellent, and Masterful extractions." },
  extraDraws: { kind: "int", max: 5, label: "Extra draws on great success", hint: "Excellent or Masterful extractions draw this many extra results from the node." },
  conserveChance: { kind: "int", max: MAX_CONSERVE, label: "No-pull chance %", hint: `Chance a gather does not use a node pull. Perks add up to ${MAX_CONSERVE}%.` },
  rareChance: { kind: "int", max: 100, label: "Rare-find chance %", hint: "On a full success, roll d100; at or under, draw from the rare-find table." },
  rareAdvantage: { kind: "flag", label: "Roll rare chance twice", hint: "Roll the rare-find d100 twice and keep the better roll." },
  rareDraws: { kind: "int", max: 5, label: "Extra rare draws", hint: "A rare find draws this many extra times from the rare table." },
  rareDouble: { kind: "flag", label: "Double rare chance", hint: "Doubles the total rare-find chance (up to 100%)." },
  climbExpand: { kind: "int", max: 5, label: "Climb range", hint: "After a rare find climbs a tier, each fresh climb d20 also climbs on this many numbers below 20 (1 = 19–20)." },
  climbAdvantage: { kind: "flag", label: "Climb with advantage", hint: "Fresh climb d20s roll twice and keep the better." },
  toolBonus: { kind: "int", max: 10, label: "Tool bonus", hint: "Added when you gather with an accepted tool." },
  toolWithSkill: { kind: "flag", label: "Tools on skill checks", hint: "Tool bonuses also apply on nodes that use a skill check." },
  toolDouble: { kind: "flag", label: "Double tool bonus", hint: "Doubles the tool proficiency bonus." },
  untrainedRelief: { kind: "fraction", label: "Untrained penalty relief", hint: "Share of untrained DC penalties removed (0.5 = half, 1 = all)." },
  ignoreConditionDc: { kind: "flag", label: "Ignore condition DC penalties", hint: "Season, weather, and time DC increases are ignored; decreases still apply." },
  scarcityRelief: { kind: "fraction", label: "Scarcity relief", hint: "Share of a 'Scarce now' penalty removed (0.5 = halved, 1 = ignored). ×0 still blocks." },
  seeOdds: { kind: "flag", label: "See drop odds", hint: "The gathering window shows current drop odds and the chance to find nothing." },
  senseBonus: { kind: "int", max: 5, label: "Sense bonus (ranks)", hint: "Sense hidden nodes as if this many ranks higher." },
  senseAll: { kind: "flag", label: "Sense every hidden node", hint: "Sense every node that can be sensed, of any profession and rank." },
  assistBonus: { kind: "int", max: 10, label: "Assist bonus", hint: "Flat bonus your Assist gives an ally's next gather at that node." },
  assistDie: { kind: "die", dice: [4, 6, 8], label: "Assist die", hint: "Extra die your Assist gives an ally's check." },
  assistUntrainedRelief: { kind: "fraction", label: "Assist untrained relief", hint: "Share of an assisted ally's untrained penalties removed." },
  // 0.31.0 skill tree expansion.
  naturalRefund: { kind: "flag", label: "Natural 20 keeps the pull", hint: "A natural 20 on a gathering check does not use a node pull." },
  momentumBonus: { kind: "int", max: 5, label: "Momentum bonus", hint: "After an Excellent or Masterful gather, added to the next gathering check within an hour." },
  toolSteward: { kind: "int", max: 5, label: "Tool-safe natural 1s per long rest", hint: "Natural 1s that do not wear the tool, per long rest." },
  fieldRepairs: { kind: "int", max: 5, label: "Field repairs per long rest", hint: "Restore 1d4 durability to a gathering tool from the gathering window." },
  refillCut: { kind: "int", max: 75, label: "Faster refill %", hint: "Nodes this character exhausts refill this much sooner." },
  extraAttempts: { kind: "int", max: 5, label: "Extra free attempts", hint: "Free gathering attempts added to the long-rest allowance." },
  secondWind: { kind: "int", max: 5, label: "Exhaustion-free attempts per long rest", hint: "Gathers beyond the free attempts that add no exhaustion, per long rest." },
  refineSaver: { kind: "flag", label: "Thrifty refining", hint: "On a successful refine, every 4 units use one fewer of the recipe's first ingredient." },
  refineTimeCut: { kind: "int", max: 90, label: "Faster refining %", hint: "Timed refining finishes this much sooner." },
  familiarDc: { kind: "int", max: 10, label: "Familiar biome DC reduction", hint: "Gathering DCs are lower in the biome the character chose." },
  sharedHaul: { kind: "int", max: 5, label: "Shared haul", hint: "When an ally this character assists gets an Excellent or Masterful extraction, the helper also gets this many of the material." },
  carefulUses: { kind: "int", max: 5, label: "Careful selections per long rest", hint: "Draw two results from the node and choose one, per long rest." },
  appraiseUses: { kind: "int", max: 5, label: "Appraisals per long rest", hint: "After a rare find, reroll it and keep either result, per long rest." },
  lastPulls: { kind: "int", max: 5, label: "Last pulls per long rest", hint: "Gather from an exhausted node, per long rest." }
});

export const PERK_KEYS = Object.freeze(Object.keys(PERK_EFFECTS));

function emptyTotals() {
  const totals = {};
  for (const [key, effect] of Object.entries(PERK_EFFECTS)) totals[key] = effect.kind === "flag" ? false : 0;
  return totals;
}

export function readPerk(item) {
  const perk = item?.getFlag?.(MODULE_ID, "perk") ?? item?.flags?.[MODULE_ID]?.perk;
  if (!perk || perk.enabled === false) return null;
  return { ...perk, profession: professionKey(perk.profession) };
}

function normalizeEffect(key, effect, raw) {
  const label = effect.label;
  if (effect.kind === "flag") return raw === true || raw === "true" || raw === "on" || raw === 1;
  const value = Number(raw ?? 0);
  if (effect.kind === "int") {
    if (!Number.isInteger(value) || value < 0 || value > effect.max) throw new Error(`${label} must be a whole number from 0 to ${effect.max}.`);
    return value;
  }
  if (effect.kind === "die") {
    if (value !== 0 && !effect.dice.includes(value)) throw new Error(`${label} must be none or d${effect.dice.join(", d")}.`);
    return value;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`);
  return Math.round(value * 100) / 100;
}

/** Validate a perk for storage. Throws a readable Error. */
export function normalizePerk(perk) {
  const profession = String(perk?.profession ?? "any");
  if (profession !== "any" && !Object.hasOwn(PROFESSIONS, profession)) throw new Error("Choose a valid profession for this perk.");
  const result = { enabled: true, profession };
  for (const [key, effect] of Object.entries(PERK_EFFECTS)) result[key] = normalizeEffect(key, effect, perk?.[key]);
  if (!PERK_KEYS.some(key => result[key])) throw new Error("Give the perk at least one effect, or remove the perk.");
  return result;
}

function itemsOf(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items.contents)) return items.contents;
  return typeof items[Symbol.iterator] === "function" ? Array.from(items) : [];
}

/** Read one stored effect leniently (old or hand-edited flags never throw). */
function storedEffect(effect, raw) {
  if (effect.kind === "flag") return raw === true;
  const value = Number(raw) || 0;
  if (effect.kind === "fraction") return Math.min(1, Math.max(0, value));
  if (effect.kind === "die") return effect.dice.includes(value) ? value : 0;
  return Math.max(0, Math.trunc(value));
}

const flagOf = (document, scope, key) => {
  const raw = foundry.utils?.getProperty?.(document?.flags?.[scope] ?? {}, key);
  if (scope === "skill-tree" && !globalThis.game?.modules?.get("skill-tree")?.active) return raw;
  return document?.getFlag?.(scope, key) ?? raw;
};

/** The linked Skill Tree journal, or null. */
function linkedTree() {
  try {
    const uuid = globalThis.game?.settings?.get(MODULE_ID, "skillTree")?.uuid;
    return uuid ? globalThis.fromUuidSync?.(uuid) ?? null : null;
  } catch { return null; }
}

/**
 * Whether a universal skill is unlocked for the actor in the linked tree.
 * With no linked universal tree there is nothing to check against, so it counts.
 */
export function universalSkillUnlocked(actor, key, tree = linkedTree()) {
  const pages = Array.from(tree?.pages ?? []);
  const universal = pages.filter(page => flagOf(page, MODULE_ID, "universalSkill"));
  if (!universal.length) return true;
  const page = universal.find(entry => flagOf(entry, MODULE_ID, "universalSkill") === key);
  if (!page) return false;
  const learned = flagOf(actor, "skill-tree", "skills");
  const entry = Array.isArray(learned) ? learned.find(skill => skill?.uuid === page.uuid) : null;
  const needed = Math.max(1, Number(flagOf(page, "skill-tree", "points")) || 1);
  return (Number(entry?.points) || 0) >= needed;
}

/**
 * Leftover skill Items do not count: a universal skill copy applies only while
 * that skill is unlocked. Perks the GM hands out directly always count.
 */
export function perkApplies(actor, item, tree = linkedTree()) {
  const key = flagOf(item, MODULE_ID, "universalSkill");
  return key ? universalSkillUnlocked(actor, key, tree) : true;
}

/**
 * Combined perks on the actor's Items for one profession ("any" perks always count).
 * @returns {object} one total per PERK_EFFECTS key, plus sources (all perk names),
 *   effectSources {key: names[]}, and the older yieldSources / rareSources lists.
 */
export function actorPerks(actor, profession) {
  const totals = emptyTotals();
  const effectSources = Object.fromEntries(PERK_KEYS.map(key => [key, []]));
  const sources = [];
  const tree = linkedTree();
  for (const item of itemsOf(actor)) {
    const perk = readPerk(item);
    if (!perk || (perk.profession && perk.profession !== "any" && perk.profession !== profession)) continue;
    if (!perkApplies(actor, item, tree)) continue;
    let used = false;
    for (const [key, effect] of Object.entries(PERK_EFFECTS)) {
      const value = storedEffect(effect, perk[key]);
      if (!value) continue;
      used = true;
      effectSources[key].push(item.name);
      if (effect.kind === "int") totals[key] += value;
      else if (effect.kind === "flag") totals[key] = true;
      else totals[key] = Math.max(totals[key], value);
    }
    if (used) sources.push(item.name);
  }
  for (const [key, effect] of Object.entries(PERK_EFFECTS)) {
    if (effect.kind === "int") totals[key] = Math.min(effect.max, totals[key]);
  }
  totals.conserveChance = Math.min(MAX_CONSERVE, totals.conserveChance);
  return { ...totals, sources, effectSources, yieldSources: effectSources.yieldBonus, rareSources: effectSources.rareChance };
}

/** Final rare-find chance after doubling, capped at 100. */
export function rareChanceTotal(perks, nodeChance = 0) {
  const base = (Number(perks?.rareChance) || 0) + (Number(nodeChance) || 0);
  return Math.min(100, perks?.rareDouble ? base * 2 : base);
}

/** A condition multiplier after scarcity relief. ×0 stays a hard block. */
export function relievedMultiplier(multiplier, relief = 0) {
  const value = Number(multiplier);
  if (!(value > 0) || value >= 1 || !relief) return value;
  return Math.round((value + (1 - value) * Math.min(1, relief)) * 100) / 100;
}

/* ---------------------------------------------------------------------- */
/* Long-rest uses                                                          */
/* ---------------------------------------------------------------------- */

export function rerollsLeft(actor, perks) {
  const used = Math.max(0, Number(actor?.getFlag?.(MODULE_ID, "rerollsUsed")) || 0);
  return Math.max(0, (Number(perks?.rerolls) || 0) - used);
}

export async function spendReroll(actor) {
  const used = Math.max(0, Number(actor.getFlag(MODULE_ID, "rerollsUsed")) || 0);
  await actor.setFlag(MODULE_ID, "rerollsUsed", used + 1);
}

export function masterfulLeft(actor, perks) {
  const used = Math.max(0, Number(actor?.getFlag?.(MODULE_ID, "masterfulUsed")) || 0);
  return Math.max(0, (Number(perks?.masterfulUses) || 0) - used);
}

export async function spendMasterful(actor) {
  const used = Math.max(0, Number(actor.getFlag(MODULE_ID, "masterfulUsed")) || 0);
  await actor.setFlag(MODULE_ID, "masterfulUsed", used + 1);
}

/**
 * Other once-per-long-rest perks (0.31.0) count their uses in
 * flags.gathering-professions.restUses.<perk key>.
 */
export const REST_USE_KEYS = Object.freeze(["toolSteward", "fieldRepairs", "secondWind", "carefulUses", "appraiseUses", "lastPulls"]);

export function restUsesLeft(actor, perks, key) {
  const used = Math.max(0, Number(actor?.getFlag?.(MODULE_ID, `restUses.${key}`)) || 0);
  return Math.max(0, (Number(perks?.[key]) || 0) - used);
}

/** Changes that spend `count` uses of a rest perk (for one Actor update). */
export function restUseChanges(actor, key, count = 1) {
  const used = Math.max(0, Number(actor?.getFlag?.(MODULE_ID, `restUses.${key}`)) || 0);
  return { [`flags.${MODULE_ID}.restUses.${key}`]: used + count };
}

export async function spendRestUse(actor, key, count = 1) {
  await actor.update(restUseChanges(actor, key, count));
}

/** dnd5e long rest: refresh perk uses. */
export async function resetRestUses(actor) {
  if (actor?.getFlag?.(MODULE_ID, "rerollsUsed")) await actor.unsetFlag(MODULE_ID, "rerollsUsed");
  if (actor?.getFlag?.(MODULE_ID, "masterfulUsed")) await actor.unsetFlag(MODULE_ID, "masterfulUsed");
  if (actor?.getFlag?.(MODULE_ID, "restUses")) await actor.unsetFlag(MODULE_ID, "restUses");
}

/* ---------------------------------------------------------------------- */
/* Momentum and Familiar Ground                                            */
/* ---------------------------------------------------------------------- */

export const MOMENTUM_SECONDS = 3600;

/** Momentum waiting for this actor's next gather (0 when none or expired). */
export function momentumBonus(actor) {
  const saved = actor?.getFlag?.(MODULE_ID, "momentum");
  if (!saved) return 0;
  const now = Number(globalThis.game?.time?.worldTime) || 0;
  return Math.abs(now - (Number(saved.at) || 0)) <= MOMENTUM_SECONDS ? Math.max(0, Number(saved.bonus) || 0) : 0;
}

/** The biome a Familiar Ground character chose ("" = none yet). */
export const familiarBiome = actor => String(actor?.getFlag?.(MODULE_ID, "familiarBiome") ?? "");

/** DC reduction from Familiar Ground at these conditions. */
export function familiarReduction(actor, perks, conditions) {
  const amount = Number(perks?.familiarDc) || 0;
  const biome = familiarBiome(actor);
  return amount && biome && conditions?.biome?.key === biome ? amount : 0;
}

/** Perks for one check, with any waiting Momentum added to the flat bonus. */
export function withMomentum(actor, perks) {
  const bonus = momentumBonus(actor);
  return bonus ? { ...perks, checkBonus: (Number(perks?.checkBonus) || 0) + bonus, momentumApplied: bonus } : perks;
}

/* ---------------------------------------------------------------------- */
/* Check adjustments                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Apply perks (and an ally's Assist) to a check from checkFormula/applyNodeCheck.
 * Dice order stays d20, profession die, then bonus dice, so chat cards and the
 * gathering window still read dice[0] and dice[1].
 * @param {object} check
 * @param {object} perks   from actorPerks()
 * @param {{bonus?: number, die?: number, untrainedRelief?: number}|null} assist
 */
export function applyPerksToCheck(check, perks, assist = null) {
  const penalty = (Number(check.tierPenalty) || 0) + (Number(check.materialPenalty) || 0);
  const relief = Math.max(Number(perks?.untrainedRelief) || 0, Number(assist?.untrainedRelief) || 0);
  const untrainedRelief = Math.floor(penalty * Math.min(1, relief));
  const perkDc = Number(perks?.dcReduction) || 0;
  let toolBonus = Number(check.toolBonus) || 0;
  if (check.toolName) {
    const proficiency = Number(check.toolProficiency ?? check.toolBonus) || 0;
    let base = check.skill ? (perks?.toolWithSkill ? proficiency : 0) : proficiency;
    if (perks?.toolDouble) base *= 2;
    toolBonus = base + (Number(perks?.toolBonus) || 0);
  }
  const perkFlat = Number(perks?.checkBonus) || 0;
  const assistFlat = Number(assist?.bonus) || 0;
  const extraDice = [Number(perks?.checkDie) || 0, Number(assist?.die) || 0].filter(die => die > 0);
  const flat = perkFlat + assistFlat;
  const formula = `1d20 + ${check.modifier}${toolBonus ? ` + ${toolBonus}` : ""}${check.trained ? ` + 1d${check.die}` : ""}`
    + `${flat ? ` + ${flat}` : ""}${extraDice.map(die => ` + 1d${die}`).join("")}`;
  return { ...check, toolBonus, perkFlat, assistFlat, extraDice, untrainedRelief, perkDc,
    target: check.target - untrainedRelief - perkDc, formula };
}
