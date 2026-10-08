// Tiered rare finds.
//
// Entry (full successes only):
//   - a natural 20 on the gathering check: always (it is also a Masterful extraction);
//   - a Masterful extraction: always, while the GM rule is on;
//   - otherwise, trained gatherers only: d100 at or under the rare chance
//     (skills + node bonus + the GM's Excellent bonus on an Excellent roll).
// Start tier: the material's tier. The table is the node's or material's own
// rare table if set, else the profession's table for that tier.
// Climb: a natural 20 on the gathering check moves the find up one tier. At
// each new table the PLAYER rolls a fresh d20 (the "Fortune die", a chat-card
// button): a 20 (19–20 with Discerning Eye) climbs again, and so on. Until they
// roll, the find is pending (serializable state, stored on the actor by main.js).
// Climbing past tier 5 reveals a story discovery: the find still draws from
// tier 5, and the GM is asked to describe something more.
// Draws: 1 + Rich Find's extra draws, all from the final table.
import { MODULE_ID, PROFESSIONS, activeRules } from "./rules.js";
import { rareChanceTotal } from "./perks.js";
import { drawRareFind } from "./integrations.js";

export const TOP_TIER = 5;
const FULL_SUCCESS = new Set(["successful", "excellent", "masterful"]);

/** The profession's rare table for a tier, falling back to its any-tier table. */
export function professionRareTable(profession, tier) {
  const entry = PROFESSIONS[profession];
  if (!entry) return "";
  return entry.rareTables?.[tier - 1] || entry.rareTable || "";
}

/** Table a find starts on: node override, material override, then the tier table. */
export function startingRareTable(rule, node = null) {
  return node?.rareTable || rule.materialRareTable || professionRareTable(rule.profession, rule.tier);
}

/** Lowest natural d20 that climbs at a fresh table (20, or 19 with Discerning Eye, …). */
export function climbThreshold(perks) {
  return Math.max(2, 20 - Math.max(0, Math.trunc(Number(perks?.climbExpand) || 0)));
}

/**
 * Decide whether the gather earns a rare draw.
 * @returns {Promise<{trigger: string|null, chanceRoll?: Roll, chance?: number}|null>} null = no roll at all
 */
export async function rareEntry({ degree, natural20, trained, perks, node }) {
  if (!FULL_SUCCESS.has(degree.id)) return null;
  if (natural20) return { trigger: "Natural 20" };
  const rules = activeRules();
  if (degree.id === "masterful" && rules.masterfulRareFind) return { trigger: "Masterful extraction" };
  // Untrained gatherers only find rares on a Masterful extraction or a natural 20.
  if (!trained) return null;
  const bonus = (Number(node?.rareChance) || 0) + (degree.id === "excellent" ? rules.excellentRareBonus : 0);
  const chance = rareChanceTotal(perks, bonus);
  if (chance <= 0) return null;
  const chanceRoll = await new Roll(perks?.rareAdvantage ? "2d100kl" : "1d100").evaluate();
  const excellent = degree.id === "excellent" && rules.excellentRareBonus ? `, Excellent +${rules.excellentRareBonus}%` : "";
  return chanceRoll.total <= chance
    ? { trigger: `Rare roll ${chanceRoll.total} ≤ ${chance}%${excellent}`, chanceRoll, chance }
    : { trigger: null, chanceRoll, chance };
}

/** Move a find up one tier, or past tier 5 into a story discovery. Mutates state. */
export function climbStep(state, roll = null) {
  if (state.tier >= TOP_TIER) {
    state.steps.push({ from: state.tier, to: TOP_TIER + 1, roll });
    state.story = true;
    return state;
  }
  state.steps.push({ from: state.tier, to: state.tier + 1, roll });
  state.tier += 1;
  return state;
}

/**
 * The player's Fortune die at the current table. Mutates and returns state:
 * a climb raises the tier (or reveals the story); otherwise the find settles.
 * @returns {Promise<{roll: Roll, climbs: boolean, state: object}>}
 */
export async function rollClimb(state) {
  if (!state?.pending) throw new Error("This rare find has no climb roll waiting.");
  const roll = await new Roll(state.climbAdvantage ? "2d20kh" : "1d20").evaluate();
  state.lastRoll = roll.total;
  const climbs = roll.total >= state.climbThreshold;
  if (climbs) climbStep(state, roll.total);
  state.pending = climbs && !state.story;
  return { roll, climbs, state };
}

/** The table for the find's current tier (ladder fallbacks, then the start table). */
export function finalRareTable(state) {
  // Climbed finds use the profession's ladder; an unset tier falls back to the
  // highest lower tier that has a table, then the starting table.
  let table = state.tier === state.startTier ? state.startTable : "";
  for (let tier = state.tier; !table && tier > state.startTier; tier--) table = professionRareTable(state.profession, tier);
  return table || state.startTable || "";
}

/** Draw the find from its final table. Items are returned, not awarded. */
export async function finishRareFind(state) {
  const table = finalRareTable(state);
  const found = { table: null, items: [], texts: [] };
  if (table) {
    for (let draw = 0; draw <= (Number(state.rareDraws) || 0); draw++) {
      const next = await drawRareFind(table);
      found.table = next.table;
      found.items.push(...next.items);
      found.texts.push(...next.texts);
    }
  }
  return { ...state, pending: false, tableName: found.table?.name ?? "", ...found };
}

/**
 * Rare-find resolution for one gather. A natural 20 below tier 5 returns a
 * pending find (`pending: true`, no items yet) that waits for the player's
 * Fortune die; everything else is drawn now. Items are returned, not awarded.
 * @returns {Promise<object|null>} null when no rare roll happened at all
 */
export async function resolveRareFind({ rule, degree, natural20 = false, trained = true, perks = {}, node = null, fortuneDie = false }) {
  const startTable = startingRareTable(rule, node);
  if (!startTable) return null;
  // Grandmaster's Touch: a guaranteed find that waits for the Fortune die on its starting table.
  const entry = fortuneDie ? { trigger: "Grandmaster's Touch" } : await rareEntry({ degree, natural20, trained, perks, node });
  if (!entry) return null;
  if (!entry.trigger) return { ...entry, items: [], texts: [] };
  const state = {
    trigger: entry.trigger, profession: rule.profession, startTier: rule.tier, tier: rule.tier, startTable,
    steps: [], story: false, lastRoll: null, pending: false,
    climbThreshold: climbThreshold(perks), climbAdvantage: Boolean(perks?.climbAdvantage), rareDraws: Number(perks?.rareDraws) || 0
  };
  if (fortuneDie) return { ...entry, ...state, pending: true, items: [], texts: [] };
  // The check's own natural 20 is always exactly one step.
  if (natural20) {
    climbStep(state, null);
    if (!state.story) return { ...entry, ...state, pending: true, items: [], texts: [] };
  }
  return finishRareFind({ ...entry, ...state });
}

/** The serializable part of a pending find, for storage between rolls. */
export function climbState(rare) {
  const keys = ["trigger", "profession", "startTier", "tier", "startTable", "steps", "story", "lastRoll", "pending", "climbThreshold", "climbAdvantage", "rareDraws"];
  return Object.fromEntries(keys.map(key => [key, foundry.utils?.deepClone ? foundry.utils.deepClone(rare[key]) : structuredClone(rare[key])]));
}

/** Private GM prompt for a story discovery. */
export async function whisperStoryFind({ actor, item, page, rare }) {
  const gms = typeof ChatMessage?.getWhisperRecipients === "function" ? ChatMessage.getWhisperRecipients("GM") : [];
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const content = `<div class="eryndor-profession-check ep-story"><strong>Story discovery</strong><br>
    ${escape(actor?.name ?? "A gatherer")} climbed past the tier 5 rare table while gathering ${escape(item?.name ?? "a material")}${page?.name ? ` at ${escape(page.name)}` : ""}.
    They found ${rare.items.map(found => escape(found.name)).join(", ") || "a tier 5 rare find"}, and something more: describe what they uncover.</div>`;
  await ChatMessage.create({ content, whisper: gms.map(user => user.id ?? user), speaker: { alias: "Eryndor Professions" }, flags: { [MODULE_ID]: { storyFind: true } } });
}
