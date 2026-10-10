// Conditions engine and editors, with in-memory doubles. No world data is touched.
import assert from "node:assert/strict";

const settings = { "simple-timekeeping.configuration": { weatherLabel: "🌧️ Rain", dawn: 0.25, dusk: 0.75 } };
const items = new Map();
const rolls = [];
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((v, k) => v?.[k], o) }, applications: { api: { ApplicationV2: class { get state() { return 0; } async render() { return this; } } } } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
globalThis.game = {
  settings: {
    get(namespace, key) { return settings[`${namespace}.${key}`] ?? settings[key]; },
    async set(_namespace, key, value) { settings[key] = value; },
    register() {}, registerMenu() {}
  },
  modules: new Map([["simple-timekeeping", { active: true }], ["gathering-professions", { api: {} }]]),
  i18n: { localize: key => ({ "simple-timekeeping.weather.rain": "Rain", "simple-timekeeping.weather.cloudy": "Cloudy", "simple-timekeeping.weather.partlyCloudy": "Partly Cloudy", "simple-timekeeping.weather.blizzard": "Blizzard", "SEASON.Winter": "Winter" })[key] ?? key },
  time: {
    components: { hour: 22, minute: 0, second: 0, season: 1 },
    calendar: { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 }, seasons: { values: [{ name: "Spring" }, { name: "SEASON.Winter" }] } }
  },
  scenes: [], journal: [], users: [], user: { isGM: true }
};
game.scenes.get = id => game.scenes.find(scene => scene.id === id);
globalThis.fromUuidSync = uuid => items.get(uuid) ?? null;
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { const next = rolls.shift(); assert.ok(next, `Unexpected roll ${this.formula}`); assert.equal(this.formula, next.formula); this.total = next.total; return this; }
};
globalThis.document = { createElement() { return { innerHTML: "" }; } };

const conditions = await import("../scripts/conditions.js");
const ui = await import("../scripts/conditions-ui.js");

// Time of day buckets around dawn/dusk.
assert.equal(conditions.timeBucket(0.25, 0.25, 0.75), "dawn");
assert.equal(conditions.timeBucket(0.5, 0.25, 0.75), "day");
assert.equal(conditions.timeBucket(0.75, 0.25, 0.75), "dusk");
assert.equal(conditions.timeBucket(0.95, 0.25, 0.75), "night");
assert.equal(conditions.timeBucket(0.1, 0.25, 0.75), "night");

// Weather matching: emoji tolerant, longest label wins, placeholder ignored.
assert.equal(conditions.matchWeather("🌧️ Rain").key, "rain");
assert.equal(conditions.matchWeather("⛅ Partly Cloudy").key, "partlyCloudy");
assert.equal(conditions.matchWeather("Click Me"), null);
assert.equal(conditions.matchWeather("Ember Haze").key, "ember-haze", "Unknown weather keeps a slug key");

// Current conditions: Simple Timekeeping, then GM pins, then node/scene biome.
let now = conditions.currentConditions({});
assert.deepEqual([now.season.key, now.weather.key, now.time.key, now.biome], ["winter", "rain", "night", null]);
assert.equal(now.season.label, "Winter");
const scene = { id: "s1", flags: { "gathering-professions": { biome: "forest" } } };
assert.equal(conditions.currentConditions({ scene }).biome.key, "forest");
assert.equal(conditions.currentConditions({ scene, node: { biome: "arctic" } }).biome.source, "node");
settings.conditionOverrides = { season: "spring", weather: "blizzard", time: "" };
now = conditions.currentConditions({ scene });
assert.deepEqual([now.season.key, now.season.source, now.weather.label, now.time.source], ["spring", "override", "Blizzard", "auto"]);
settings.conditionOverrides = {};

// Dawn/dusk follow Simple Timekeeping's calendar (per-month values) over its config.
assert.deepEqual(conditions.dawnDusk(), { dawn: 0.25, dusk: 0.75 }, "Config used when calendar has no dawn/dusk");
game.time.calendar.dawn = 0.291666; game.time.calendar.dusk = 0.708333;
assert.deepEqual(conditions.dawnDusk(), { dawn: 0.291666, dusk: 0.708333 });
game.time.components.hour = 19; // after month dusk (17:00 ± 1h), before config dusk (18:00)
assert.equal(conditions.currentConditions({}).time.key, "night");
game.time.components.hour = 5; // before month dawn window (07:00 ± 1h), after config dawn (06:00)
assert.equal(conditions.currentConditions({}).time.key, "night");
game.time.calendar.dawn = 0.8; // invalid (dawn after dusk) falls back to config
assert.deepEqual(conditions.dawnDusk(), { dawn: 0.25, dusk: 0.75 });
delete game.time.calendar.dawn; delete game.time.calendar.dusk;
game.time.components.hour = 22;
assert.equal(conditions.nodeScene({ parent: { getFlag: () => "s1" } }, () => []), null, "Unknown scene id resolves to nothing");
game.scenes.push(scene);
assert.equal(conditions.nodeScene({ parent: { getFlag: () => "s1" } }, () => []), scene);

// Biomes and scene biome.
assert.equal(conditions.getBiomes().length, 10);
assert.deepEqual(conditions.normalizeBiomes([{ label: "Blight Shore", color: "#aa3344" }, { label: "" }]), [{ key: "blight-shore", label: "Blight Shore", color: "#aa3344" }]);
assert.throws(() => conditions.normalizeBiomes([{ label: "A", key: "x" }, { label: "B", key: "x" }]), /Two biomes/);
assert.throws(() => conditions.normalizeBiomes([{ label: "A", color: "red" }]), /color/);

// Rules and multipliers.
assert.throws(() => conditions.normalizeRules([{ type: "moon", value: "full", multiplier: 2 }]), /condition type/);
assert.throws(() => conditions.normalizeRules([{ type: "time", value: "night", multiplier: 11 }]), /between 0 and 10/);
const nightFlower = conditions.normalizeRules([
  { type: "time", value: "night", multiplier: 3 }, { type: "season", value: "winter", multiplier: 0 },
  { type: "weather", value: "rain", multiplier: 1.5 }, { type: "", value: "" }
]);
assert.equal(nightFlower.length, 3);
const springRainNight = { season: { key: "spring" }, weather: { key: "rain" }, time: { key: "night" } };
assert.equal(conditions.weightMultiplier(nightFlower, springRainNight), 4.5, "2 × 3 × 1.5 example: multiplier 4.5");
assert.equal(conditions.weightMultiplier(nightFlower, { ...springRainNight, season: { key: "winter" } }), 0);
assert.equal(conditions.weightMultiplier(nightFlower, {}), 1);
assert.deepEqual([conditions.abundance(0).key, conditions.abundance(0.5).key, conditions.abundance(1).key, conditions.abundance(3).key], ["none", "scarce", "normal", "abundant"]);

const moonpetal = { uuid: "Item.moon", name: "Moonpetal", flags: { "gathering-professions": { material: { conditions: nightFlower } } } };
const stone = { uuid: "Item.stone", name: "Stone", flags: {} };
items.set(moonpetal.uuid, moonpetal);
items.set(stone.uuid, stone);
assert.equal(conditions.rulesFor(moonpetal, null), nightFlower);
const override = { materialRules: { "Item.moon": [{ type: "time", value: "day", multiplier: 2 }] } };
assert.deepEqual(conditions.rulesFor(moonpetal, override), [{ type: "time", value: "day", multiplier: 2 }], "Node override replaces material rules");
assert.deepEqual(conditions.rulesFor(moonpetal, { materialRules: { "Item.moon": [] } }), [], "Empty override = no rules on this node");

// Table reweighting, empty detection, weighted pick, and draw restore.
const results = [{ id: "r1", documentUuid: "Item.moon", weight: 2 }, { id: "r2", documentUuid: "Item.stone", weight: 1 }, { id: "r3", name: "Text", weight: 1 }];
const table = { replacement: true, results, async draw() { return "original"; } };
const winterNight = { season: { key: "winter" }, time: { key: "night" } };
let adjusted = conditions.adjustedResults(table, null, springRainNight);
assert.deepEqual(adjusted.entries.map(entry => entry.weight), [9, 1, 1]);
assert.equal(adjusted.changed, true);
assert.equal(adjusted.empty, false);
assert.equal(conditions.adjustedResults({ results: [results[0]] }, null, winterNight).empty, true);
assert.equal(conditions.adjustedResults({ results: [results[1]] }, null, winterNight).changed, false);
rolls.push({ formula: "1d1100", total: 900 }, { formula: "1d1100", total: 901 }, { formula: "1d1100", total: 1100 });
assert.equal((await conditions.weightedPick(table, adjusted)).result.id, "r1");
assert.equal((await conditions.weightedPick(table, adjusted)).result.id, "r2");
assert.equal((await conditions.weightedPick(table, adjusted)).result.id, "r3");
const noReplace = { replacement: false, results: [{ id: "a", documentUuid: "Item.stone", weight: 1, drawn: true }, { id: "b", documentUuid: "Item.moon", weight: 1 }] };
rolls.push({ formula: "1d450", total: 1 });
assert.equal((await conditions.weightedPick(noReplace, conditions.adjustedResults(noReplace, null, springRainNight))).result.id, "b", "Drawn results are skipped without replacement");
rolls.push({ formula: "1d1100", total: 50 });
const drawn = await conditions.withAdjustedDraw(table, adjusted, () => table.draw());
assert.equal(drawn.results[0].id, "r1");
assert.equal(await table.draw(), "original", "Original draw restored");
assert.equal(Object.hasOwn(table, "draw"), true, "Own draw property restored, not deleted");
const proto = { async draw() { return "proto"; } };
const inherited = Object.create(proto);
inherited.results = results;
rolls.push({ formula: "1d1100", total: 1 });
await conditions.withAdjustedDraw(inherited, conditions.adjustedResults(inherited, null, springRainNight), () => inherited.draw());
assert.equal(Object.hasOwn(inherited, "draw"), false);
assert.equal(await conditions.withAdjustedDraw(table, { changed: false }, () => "untouched"), "untouched");
// Careful Selection: the first draw picks twice and keeps the chosen result.
rolls.push({ formula: "1d1100", total: 50 }, { formula: "1d1100", total: 1100 });
const offered = [];
const careful = await conditions.withAdjustedDraw(table, adjusted, () => table.draw(), { choose: async (first, second) => { offered.push(first.result.id, second.result.id); return second; } });
assert.deepEqual([offered, careful.results[0].id], [["r1", "r3"], "r3"], "Careful Selection keeps the chosen draw");
assert.equal(await table.draw(), "original", "Original draw restored after a careful draw");
let releaseFirst;
const firstWait = new Promise(resolve => { releaseFirst = resolve; });
let firstStarted;
const firstReady = new Promise(resolve => { firstStarted = resolve; });
let secondStarted = false;
rolls.push({ formula: "1d1100", total: 1 }, { formula: "1d1100", total: 1 });
const firstGather = conditions.withAdjustedDraw(table, adjusted, async () => {
  firstStarted();
  await firstWait;
  return table.draw();
});
await firstReady;
const secondGather = conditions.withAdjustedDraw(table, adjusted, async () => {
  secondStarted = true;
  return table.draw();
});
assert.equal(secondStarted, false, "A second gather waits before replacing the same table draw");
releaseFirst();
assert.equal((await firstGather).results[0].id, "r1");
assert.equal((await secondGather).results[0].id, "r1");
assert.equal(await table.draw(), "original", "Concurrent gathers restore the original draw");

// A node's only material turning scarce (×0.5) becomes a 50% chance to find nothing.
const halfDay = [{ type: "time", value: "day", multiplier: 0.5 }];
const dayPetal = { uuid: "Item.dayPetal", name: "Day Petal", flags: { "gathering-professions": { material: { conditions: halfDay } } } };
items.set(dayPetal.uuid, dayPetal);
const solo = { replacement: true, results: [{ id: "p", documentUuid: "Item.dayPetal", weight: 1 }], async draw() { return "original"; } };
const soloDay = conditions.adjustedResults(solo, null, { time: { key: "day" } });
assert.equal(soloDay.changed, true);
assert.equal(conditions.missShare(soloDay.entries), 0.5);
rolls.push({ formula: "1d100", total: 50 }, { formula: "1d100", total: 51 });
assert.equal((await conditions.weightedPick(solo, soloDay)).result.id, "p");
const missed = await conditions.weightedPick(solo, soloDay);
assert.deepEqual([missed.result, missed.miss], [null, true]);
rolls.push({ formula: "1d100", total: 99 });
const missDraw = await conditions.withAdjustedDraw(solo, soloDay, () => solo.draw());
assert.deepEqual(missDraw.results, [], "A miss draws no result");
assert.equal(soloDay.missed, true);
assert.equal(conditions.missShare(conditions.adjustedResults(solo, null, { time: { key: "night" } }).entries), 0, "No miss when nothing scales down");
assert.equal(conditions.missShare(adjusted.entries), 0, "Gains elsewhere hide no miss chance");

// DC modifiers by condition and profession.
assert.throws(() => conditions.normalizeConditionDc([{ type: "weather", value: "blizzard", dc: 0 }]), /not 0/);
assert.throws(() => conditions.normalizeConditionDc([{ type: "weather", value: "", dc: 2 }]), /needs a condition/);
settings.conditionDc = conditions.normalizeConditionDc([
  { type: "weather", value: "blizzard", profession: "", dc: 5 },
  { type: "time", value: "night", profession: "mining", dc: 2 },
  { type: "time", value: "night", profession: "herbalism", dc: -1 }
]);
const blizzardNight = { weather: { key: "blizzard", label: "Blizzard" }, time: { key: "night", label: "Night" } };
assert.deepEqual(conditions.conditionDcModifier(blizzardNight, "mining"), { total: 7, parts: ["Blizzard +5", "Night +2"] });
assert.deepEqual(conditions.conditionDcModifier(blizzardNight, "herbalism"), { total: 4, parts: ["Blizzard +5", "Night −1"] });
assert.deepEqual(conditions.conditionDcModifier({}, "mining"), { total: 0, parts: [] });

// Editors render.
const editorHtml = ui.rulesEditorHtml(nightFlower, "conditions");
assert.match(editorHtml, /name="conditions"/);
assert.equal((editorHtml.match(/class="gp-rule-row"/g) ?? []).length, 3);
assert.match(editorHtml, /value="night" selected/);
assert.deepEqual(ui.parseRules('[{"type":"time","value":"day","multiplier":2}]'), [{ type: "time", value: "day", multiplier: 2 }]);
assert.deepEqual(ui.parseRules("not json"), []);
assert.match(ui.rulesSummary(nightFlower), /Night ×3, Winter ×0, Rain ×1.5/);
for (const tab of ["now", "biomes", "dc"]) {
  const html = ui.renderConditionsWindow({ tab });
  assert.match(html, /gp-hub-subtabs/);
  if (tab === "now") assert.match(html, /Pin a value/);
  if (tab === "biomes") assert.match(html, /Scene default biome/);
  if (tab === "dc") {
    // Every condition has a grid input; profession-specific rows are listed below.
    const expected = ["season", "time", "weather", "biome"].reduce((sum, type) => sum + conditions.conditionOptions(type).length, 0);
    assert.equal((html.match(/data-dc-grid/g) ?? []).length, expected);
    assert.match(html, /name="dcg_weather__blizzard"[^>]*value="5"/);
    assert.match(html, /name="dcg_time__night"[^>]*value="0"/, "Profession rows stay out of the grid");
    assert.equal((html.match(/class="gp-hub-row gp-dc-row"/g) ?? []).length, 2);
  }
}
// Recommended values: moderate, penalties only, every profession.
const defaults = conditions.defaultConditionDcRows();
assert.ok(defaults.every(row => row.dc > 0 && row.profession === ""));
assert.ok(defaults.some(row => row.type === "weather" && row.value === "blizzard" && row.dc === 5));
assert.ok(defaults.every(row => row.type !== "weather" || conditions.WEATHER_KEYS.includes(row.value)), "Only known weather keys");
assert.doesNotThrow(() => conditions.normalizeConditionDc(defaults));
// The grid reads back non-zero values plus profession rows.
const gridRoot = { querySelectorAll(selector) {
  if (selector === "[data-dc-grid]") return [{ name: "dcg_weather__rain", value: "2" }, { name: "dcg_time__dawn", value: "0" }];
  return [];
} };
assert.deepEqual(ui.readDcRows(gridRoot), [{ type: "weather", value: "rain", profession: "", dc: 2 }]);

console.log("PASS: conditions — time, weather, season, biome, pins, rules, multipliers, overrides, reweighted draws, DC modifiers, and editors.");
