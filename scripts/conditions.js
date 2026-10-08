// Conditional loot: season, weather, time of day, and biome. Materials carry
// weight multipliers per condition (a node may override them), and the GM can
// set DC modifiers per condition. Season/weather/time come from Simple
// Timekeeping unless the GM pins an override.
import { MODULE_ID, PROFESSIONS, slugify, professionKey } from "./rules.js";
import { relievedMultiplier } from "./perks.js";

export const CONDITION_TYPES = Object.freeze({
  season: { label: "Season", icon: "fa-leaf" },
  weather: { label: "Weather", icon: "fa-cloud-sun-rain" },
  time: { label: "Time of day", icon: "fa-clock" },
  biome: { label: "Biome", icon: "fa-mountain-sun" }
});

export const TIME_OF_DAY = Object.freeze([
  { key: "dawn", label: "Dawn" }, { key: "day", label: "Day" },
  { key: "dusk", label: "Dusk" }, { key: "night", label: "Night" }
]);

export const WEATHER_KEYS = Object.freeze(["clear", "partlyCloudy", "cloudy", "overcast", "rain", "thunderstorm", "drizzle", "snow", "blizzard", "hail", "fog", "mist", "windy", "tornado", "hurricane", "ashfall", "sandstorm", "luminousSky", "bloodRain", "manaStorm", "arcaneFog", "voidstorm", "celestialEclipse", "meteorShower", "frozenHell", "sunshower", "spectralStorm", "etherealDrizzle", "wildMagicWinds"]);

export const DEFAULT_BIOMES = Object.freeze(["Arctic", "Coast", "Desert", "Forest", "Grassland", "Hill", "Mountain", "Swamp", "Underdark", "Urban"]
  .map(label => Object.freeze({ key: slugify(label), label, color: "" })));

const ST_ID = "simple-timekeeping";

function setting(key, fallback) {
  try { return globalThis.game?.settings?.get(MODULE_ID, key) ?? fallback; }
  catch { return fallback; }
}

function localize(text) {
  const value = String(text ?? "");
  try { return globalThis.game?.i18n?.localize?.(value) ?? value; } catch { return value; }
}

/* ---------------------------------------------------------------------- */
/* Option lists                                                            */
/* ---------------------------------------------------------------------- */

export function getBiomes() {
  const saved = setting("biomes", null);
  const list = Array.isArray(saved) && saved.length ? saved : DEFAULT_BIOMES;
  return list.filter(biome => biome?.key && biome?.label).map(biome => ({ key: String(biome.key), label: String(biome.label), color: String(biome.color ?? "") }));
}

export function normalizeBiomes(list) {
  if (!Array.isArray(list)) throw new Error("Biome list is not valid.");
  const seen = new Set();
  return list.map(entry => {
    const label = String(entry?.label ?? "").trim();
    if (!label) return null;
    const key = String(entry?.key ?? "").trim() || slugify(label);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(key)) throw new Error(`Biome key "${key}" must start with a letter and use lowercase letters, numbers, and dashes.`);
    if (seen.has(key)) throw new Error(`Two biomes use the key "${key}".`);
    seen.add(key);
    const color = String(entry?.color ?? "").trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`${label}: color must look like #4a8fc4.`);
    return { key, label, color };
  }).filter(Boolean);
}

export function seasonOptions() {
  const values = globalThis.game?.time?.calendar?.seasons?.values ?? [];
  return values.map(season => {
    const label = localize(season.name);
    return { key: slugify(label), label };
  }).filter(season => season.key);
}

export function weatherOptions() {
  return WEATHER_KEYS.map(key => {
    const id = `${ST_ID}.weather.${key}`;
    const label = localize(id);
    return { key, label: label === id ? key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()) : label };
  });
}

export function conditionOptions(type) {
  if (type === "season") return seasonOptions();
  if (type === "weather") return weatherOptions();
  if (type === "time") return [...TIME_OF_DAY];
  if (type === "biome") return getBiomes();
  return [];
}

export function optionLabel(type, key) {
  return conditionOptions(type).find(option => option.key === key)?.label ?? key;
}

/* ---------------------------------------------------------------------- */
/* Current conditions                                                      */
/* ---------------------------------------------------------------------- */

/** Match Simple Timekeeping's free-text weather label (may include emoji) to a known key. */
export function matchWeather(label) {
  const text = String(label ?? "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!text || text === "click me") return null;
  const options = weatherOptions().sort((a, b) => b.label.length - a.label.length);
  const hit = options.find(option => text.includes(option.label.toLowerCase()));
  return hit ?? { key: slugify(text), label: String(label).trim() };
}

/** Dawn / Day / Dusk / Night from the fraction of the day (0–1). */
export function timeBucket(fraction, dawn = 0.23, dusk = 0.77, window = 1 / 24) {
  const f = ((Number(fraction) % 1) + 1) % 1;
  if (Math.abs(f - dawn) <= window) return "dawn";
  if (Math.abs(f - dusk) <= window) return "dusk";
  return f > dawn && f < dusk ? "day" : "night";
}

function stConfig() {
  try {
    if (!globalThis.game?.modules?.get(ST_ID)?.active) return null;
    return globalThis.game.settings.get(ST_ID, "configuration") ?? null;
  } catch { return null; }
}

function autoSeason() {
  const index = globalThis.game?.time?.components?.season;
  const season = Number.isInteger(index) ? globalThis.game?.time?.calendar?.seasons?.values?.[index] : null;
  if (!season) return null;
  const label = localize(season.name);
  return { key: slugify(label), label };
}

function autoTime() {
  const components = globalThis.game?.time?.components;
  const days = globalThis.game?.time?.calendar?.days;
  if (!components || !days) return null;
  const secondsPerDay = days.hoursPerDay * days.minutesPerHour * days.secondsPerMinute;
  const seconds = ((components.hour ?? 0) * days.minutesPerHour + (components.minute ?? 0)) * days.secondsPerMinute + (components.second ?? 0);
  const { dawn, dusk } = dawnDusk();
  const key = timeBucket(seconds / secondsPerDay, dawn, dusk);
  return TIME_OF_DAY.find(entry => entry.key === key);
}

/**
 * Dawn/dusk as fractions of the day. Prefer Simple Timekeeping's calendar
 * getters (per-month values, then latitude, then config), so buckets match
 * the scene lighting; fall back to the config, then the defaults.
 */
export function dawnDusk() {
  const valid = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const calendar = globalThis.game?.time?.calendar;
  const config = stConfig();
  let dawn = 0.23, dusk = 0.77;
  for (const source of [config, calendar]) {
    const d = Number(source?.dawn), k = Number(source?.dusk);
    if (valid(d) && valid(k) && d < k) { dawn = d; dusk = k; }
  }
  return { dawn, dusk };
}

export function getOverrides() {
  const saved = setting("conditionOverrides", {}) ?? {};
  return { season: String(saved.season ?? ""), weather: String(saved.weather ?? ""), time: String(saved.time ?? "") };
}

/** The scene a node belongs to: its journal's scene, else its first pin's scene. */
export function nodeScene(page, pinsFor) {
  const key = page?.parent?.getFlag?.(MODULE_ID, "nodeJournal");
  const scene = key && key !== "none" ? globalThis.game?.scenes?.get?.(key) : null;
  if (scene) return scene;
  return pinsFor?.(page)?.[0]?.scene ?? null;
}

export function sceneBiome(scene) {
  return String(scene?.getFlag?.(MODULE_ID, "biome") ?? scene?.flags?.[MODULE_ID]?.biome ?? "");
}

/**
 * Conditions that apply to a node right now.
 * @returns {{season, weather, time, biome}} each {key, label, source: "auto"|"override"|"node"|"scene"} or null
 */
export function currentConditions({ node = null, scene = null } = {}) {
  const overrides = getOverrides();
  const config = stConfig();
  const pick = (type, auto) => {
    if (overrides[type]) return { key: overrides[type], label: optionLabel(type, overrides[type]), source: "override" };
    return auto ? { ...auto, source: "auto" } : null;
  };
  const weatherAuto = config ? matchWeather(config.weatherLabel) : null;
  let biome = null;
  if (node?.biome) biome = { key: node.biome, label: optionLabel("biome", node.biome), source: "node" };
  else if (sceneBiome(scene)) biome = { key: sceneBiome(scene), label: optionLabel("biome", sceneBiome(scene)), source: "scene" };
  return { season: pick("season", autoSeason()), weather: pick("weather", weatherAuto), time: pick("time", autoTime()), biome };
}

export function conditionChips(conditions) {
  return Object.keys(CONDITION_TYPES).map(type => conditions?.[type] ? { type, ...conditions[type], icon: CONDITION_TYPES[type].icon } : null).filter(Boolean);
}

/* ---------------------------------------------------------------------- */
/* Rules                                                                   */
/* ---------------------------------------------------------------------- */

/** Rules: [{type, value, multiplier}]. Multiplier 0–10 in steps of 0.05. */
export function normalizeRules(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("Condition rules are not valid.");
  const rules = [];
  for (const entry of list) {
    const type = String(entry?.type ?? "");
    const value = String(entry?.value ?? "").trim();
    if (!type && !value) continue;
    if (!Object.hasOwn(CONDITION_TYPES, type)) throw new Error("Choose a condition type for every rule.");
    if (!value) throw new Error(`Choose a ${CONDITION_TYPES[type].label.toLowerCase()} for every rule.`);
    const multiplier = Number(entry?.multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) throw new Error("Multipliers must be between 0 and 10.");
    rules.push({ type, value, multiplier: Math.round(multiplier * 100) / 100 });
  }
  if (rules.length > 24) throw new Error("A material can have at most 24 condition rules.");
  return rules;
}

/** Product of every matching rule's multiplier (1 when nothing matches). */
export function weightMultiplier(rules, conditions) {
  let multiplier = 1;
  for (const rule of rules ?? []) {
    if (conditions?.[rule.type]?.key === rule.value) multiplier *= Number(rule.multiplier);
  }
  return multiplier;
}

/** Rules for an Item on a node: the node's override if set, else the material's own. */
export function rulesFor(item, node) {
  const override = item?.uuid ? node?.materialRules?.[item.uuid] : undefined;
  if (Array.isArray(override)) return override;
  const material = item?.getFlag?.(MODULE_ID, "material") ?? item?.flags?.[MODULE_ID]?.material;
  return Array.isArray(material?.conditions) ? material.conditions : [];
}

export function abundance(multiplier) {
  if (multiplier <= 0) return { key: "none", label: "Not found now" };
  if (multiplier > 1) return { key: "abundant", label: "Abundant now" };
  if (multiplier < 1) return { key: "scarce", label: "Scarce now" };
  return { key: "normal", label: "" };
}

/* ---------------------------------------------------------------------- */
/* DC modifiers                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Recommended DC modifiers (moderate, penalties only, every profession).
 * Conditions not listed here are 0. Seeded into the world once; the GM edits
 * them in Eryndor Professions → Conditions → Difficulty.
 */
export const DEFAULT_CONDITION_DC = Object.freeze({
  season: { winter: 2 },
  time: { dawn: 1, dusk: 1, night: 2 },
  weather: {
    overcast: 1, drizzle: 1, mist: 1, windy: 1, sunshower: 1,
    rain: 2, snow: 2, fog: 2, celestialEclipse: 2, etherealDrizzle: 2,
    hail: 3, ashfall: 3, bloodRain: 3, arcaneFog: 3,
    thunderstorm: 4, sandstorm: 4, meteorShower: 4, wildMagicWinds: 4,
    blizzard: 5, tornado: 5, hurricane: 5, manaStorm: 5, spectralStorm: 5,
    voidstorm: 6, frozenHell: 6
  },
  biome: { mountain: 1, swamp: 1, arctic: 2, desert: 2, underdark: 2 }
});

/** DEFAULT_CONDITION_DC as stored rows [{type, value, profession: "", dc}]. */
export function defaultConditionDcRows() {
  return Object.entries(DEFAULT_CONDITION_DC).flatMap(([type, values]) =>
    Object.entries(values).map(([value, dc]) => ({ type, value, profession: "", dc })));
}

export function getConditionDc() {
  const saved = setting("conditionDc", []);
  return Array.isArray(saved) ? saved : [];
}

export function normalizeConditionDc(list) {
  if (!Array.isArray(list)) throw new Error("DC modifiers are not valid.");
  return list.map(entry => {
    const type = String(entry?.type ?? "");
    const value = String(entry?.value ?? "").trim();
    if (!type && !value) return null;
    if (!Object.hasOwn(CONDITION_TYPES, type) || !value) throw new Error("Every DC modifier needs a condition.");
    const profession = String(professionKey(entry?.profession ?? ""));
    if (profession && !Object.hasOwn(PROFESSIONS, profession)) throw new Error("Choose a valid profession for each DC modifier.");
    const dc = Number(entry?.dc);
    if (!Number.isInteger(dc) || dc < -20 || dc > 20 || dc === 0) throw new Error("DC modifiers must be whole numbers from −20 to 20 (not 0).");
    return { type, value, profession, dc };
  }).filter(Boolean);
}

/**
 * Sum of DC modifiers matching the conditions and profession, with labels.
 * ignorePenalties (Weatherproof) skips increases; decreases still apply.
 */
export function conditionDcModifier(conditions, profession, { ignorePenalties = false } = {}) {
  let total = 0;
  const parts = [];
  for (const rule of getConditionDc()) {
    if (conditions?.[rule.type]?.key !== rule.value) continue;
    if (rule.profession && professionKey(rule.profession) !== profession) continue;
    if (ignorePenalties && rule.dc > 0) continue;
    total += Number(rule.dc) || 0;
    parts.push(`${conditions[rule.type].label} ${rule.dc > 0 ? "+" : "−"}${Math.abs(rule.dc)}`);
  }
  return { total, parts };
}

/* ---------------------------------------------------------------------- */
/* Table reweighting                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Condition-adjusted weights for a node's table results. relief (Scarcity
 * relief perk, 0–1) softens multipliers below 1; ×0 still blocks.
 * @returns {{entries: Array<{result, weight, multiplier}>, changed: boolean, empty: boolean}}
 */
export function adjustedResults(table, node, conditions, { relief = 0 } = {}) {
  const entries = Array.from(table?.results ?? []).map(result => {
    const item = result.documentUuid ? globalThis.fromUuidSync?.(result.documentUuid) : null;
    const multiplier = item ? relievedMultiplier(weightMultiplier(rulesFor(item, node), conditions), relief) : 1;
    return { result, base: Number(result.weight) || 0, multiplier, weight: (Number(result.weight) || 0) * multiplier };
  });
  return {
    entries,
    changed: entries.some(entry => entry.multiplier !== 1),
    empty: entries.length > 0 && entries.every(entry => entry.weight <= 0)
  };
}

/**
 * Share of a draw that finds nothing: weight lost to conditions (multipliers
 * below 1) becomes a miss, so a node's only material can still turn scarce.
 * Gains above the base only shift odds between materials.
 */
export function missShare(entries) {
  const base = entries.reduce((sum, entry) => sum + (Number(entry.base) || 0), 0);
  const weight = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight) || 0), 0);
  return base > 0 && weight < base ? (base - weight) / base : 0;
}

/**
 * Pick one result using condition-adjusted weights, honouring "drawn" results
 * on tables without replacement. Returns null when nothing can be drawn, and
 * {roll, result: null, miss: true} when the draw lands on the miss share.
 */
export async function weightedPick(table, adjusted) {
  const eligible = adjusted.entries.filter(entry => table.replacement !== false || !entry.result.drawn);
  const pool = eligible.filter(entry => entry.weight > 0);
  if (!pool.length) return null;
  const scaled = pool.map(entry => ({ ...entry, width: Math.max(1, Math.round(entry.weight * 100)) }));
  const hits = scaled.reduce((sum, entry) => sum + entry.width, 0);
  const share = missShare(eligible);
  const missWidth = share > 0 ? Math.round((hits * share) / (1 - share)) : 0;
  const roll = await new Roll(`1d${hits + missWidth}`).evaluate({ allowInteractive: false });
  let cursor = roll.total;
  for (const entry of scaled) {
    cursor -= entry.width;
    if (cursor <= 0) return { roll, result: entry.result };
  }
  return { roll, result: null, miss: true };
}

/**
 * While `task` runs, make table.draw() use condition-adjusted weights.
 * Gatherer keeps its own flow (pulls, drawn flags, quantities).
 */
const drawQueues = new WeakMap();

export async function withAdjustedDraw(table, adjusted, task) {
  if (!table) return task();
  const previousTask = drawQueues.get(table) ?? Promise.resolve();
  let release;
  const currentTask = new Promise(resolve => { release = resolve; });
  drawQueues.set(table, currentTask);
  await previousTask;
  try {
    if (!adjusted?.changed) return await task();
    const hadOwn = Object.hasOwn(table, "draw");
    const previous = table.draw;
    table.draw = async () => {
      const pick = await weightedPick(table, adjusted);
      if (pick?.miss) adjusted.missed = true;
      return { roll: pick?.roll ?? null, results: pick?.result ? [pick.result] : [] };
    };
    try { return await task(); }
    finally {
      if (hadOwn) table.draw = previous;
      else delete table.draw;
    }
  } finally {
    if (drawQueues.get(table) === currentTask) drawQueues.delete(table);
    release();
  }
}
