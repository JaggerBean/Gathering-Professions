// Tool durability. A natural 1 on a gathering check made with a node's tool
// costs that tool 1 durability. At 0 the tool is broken: it no longer meets a
// node's tool requirement or adds its bonus until the GM repairs it (it is not
// deleted). Stored on the Item: flags.eryndor-professions.durability {value, max}.
// A missing max uses the world default (Tier & Rank Rules); max 0 = never wears.
// A missing value means full.
import { MODULE_ID, activeRules } from "./rules.js";

export const MAX_DURABILITY = 1000;

function stored(item) {
  return item?.getFlag?.(MODULE_ID, "durability") ?? item?.flags?.[MODULE_ID]?.durability ?? {};
}

const whole = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(MAX_DURABILITY, number) : fallback;
};

/** {value, max, unbreakable, broken} for a tool Item. */
export function toolDurability(item) {
  const saved = stored(item);
  const max = whole(saved.max, activeRules().toolDurability);
  if (!max) return { value: 0, max: 0, unbreakable: true, broken: false };
  const value = Math.min(max, whole(saved.value, max));
  return { value, max, unbreakable: false, broken: value <= 0 };
}

export const isBroken = item => toolDurability(item).broken;

export function durabilityLabel(item) {
  const state = toolDurability(item);
  if (state.unbreakable) return "";
  return state.broken ? "broken" : `${state.value}/${state.max}`;
}

/**
 * Wear a tool by `amount` (a natural 1 costs 1).
 * @returns {Promise<{before: number, after: number, max: number, broke: boolean}|null>} null when it cannot wear
 */
export async function wearTool(item, amount = 1) {
  const state = toolDurability(item);
  if (!item || state.unbreakable || state.broken || amount <= 0) return null;
  const after = Math.max(0, state.value - amount);
  await item.setFlag(MODULE_ID, "durability", { ...stored(item), value: after });
  return { before: state.value, after, max: state.max, broke: after === 0 };
}

/** GM: set or repair a tool. Blank max = world default. */
export function normalizeDurability({ value = null, max = null } = {}) {
  const clean = (entry, label) => {
    if (entry === null || entry === "" || entry === undefined) return null;
    const number = Number(entry);
    if (!Number.isInteger(number) || number < 0 || number > MAX_DURABILITY) throw new Error(`${label} must be a whole number from 0 to ${MAX_DURABILITY}.`);
    return number;
  };
  const result = { max: clean(max, "Maximum durability"), value: clean(value, "Durability") };
  const cap = result.max ?? activeRules().toolDurability;
  if (result.value !== null && cap && result.value > cap) throw new Error(`Durability cannot be above the maximum (${cap}).`);
  return result;
}
