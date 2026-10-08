// Tiered rare finds: entry, tier climbing, story discoveries, tables, default
// catalogue, and the Fortune skill rebalance. In-memory doubles only.
import assert from "node:assert/strict";

const settings = {};
const rolls = [];
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((v, k) => v?.[k], o), deepClone: structuredClone }, applications: { api: { ApplicationV2: class {} } } };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    const next = rolls.shift();
    assert.ok(next, `Unexpected roll ${this.formula}`);
    assert.equal(this.formula, next.formula);
    this.total = next.total;
    return this;
  }
};
const ItemClass = class { constructor(name) { this.name = name; } };
globalThis.CONFIG = { Item: { documentClass: { implementation: ItemClass } } };
const tables = {};
const table = (uuid, names) => { tables[uuid] = { name: uuid, async roll() { return { results: names.map(name => ({ documentUuid: `Item.${name}` })) }; } }; };
for (let tier = 1; tier <= 5; tier++) table(`RollTable.mining${tier}`, [`Mining T${tier} find`]);
table("RollTable.anyTier", ["Any-tier find"]);
table("RollTable.node", ["Node find"]);
table("RollTable.material", ["Material find"]);
globalThis.fromUuid = async uuid => tables[uuid] ?? (uuid.startsWith("Item.") ? new ItemClass(uuid.slice(5)) : null);
globalThis.fromUuidSync = uuid => tables[uuid] ?? null;
globalThis.game = {
  settings: { get(_namespace, key) { return settings[key]; }, async set(_namespace, key, value) { settings[key] = value; }, register() {}, registerMenu() {} },
  modules: new Map([["eryndor-professions", { api: {} }]]), user: { isGM: true }, actors: [], items: []
};

const rules = await import("../scripts/rules.js");
const rare = await import("../scripts/rarefinds.js");
const catalogue = await import("../scripts/rareitems.js");
const tree = await import("../scripts/skilltree.js");
const { naturalMasterful, getDegreeOfSuccess } = await import("../scripts/gathering.js");

settings.professions = [
  { key: "mining", label: "Mining", ability: "str", rareTable: "RollTable.anyTier", rareTables: ["RollTable.mining1", "RollTable.mining2", "", "RollTable.mining4", "RollTable.mining5"] },
  { key: "herbalism", label: "Herbalism", ability: "wis", rareTable: "" }
];
settings.rules = {};
const degree = id => ({ ...getDegreeOfSuccess({ failed: -9, partial: -2, successful: 0, excellent: 6, masterful: 12 }[id], 0) });
const rule = (tier, extra = {}) => ({ profession: "mining", tier, materialRareTable: "", ...extra });
const names = result => result.items.map(item => item.name);

// --- profession settings keep five tier tables -------------------------------------
assert.deepEqual(rules.getProfessions().mining.rareTables, ["RollTable.mining1", "RollTable.mining2", "", "RollTable.mining4", "RollTable.mining5"]);
assert.deepEqual(rules.getProfessions().herbalism.rareTables, ["", "", "", "", ""]);
assert.equal(rules.activeRules().excellentRareBonus, 10, "Default Excellent bonus");

// --- table resolution ---------------------------------------------------------------
assert.equal(rare.professionRareTable("mining", 2), "RollTable.mining2");
assert.equal(rare.professionRareTable("mining", 3), "RollTable.anyTier", "Empty tier uses the any-tier table");
assert.equal(rare.professionRareTable("herbalism", 1), "");
assert.equal(rare.startingRareTable(rule(1), { rareTable: "RollTable.node" }), "RollTable.node");
assert.equal(rare.startingRareTable(rule(1, { materialRareTable: "RollTable.material" })), "RollTable.material");
assert.equal(rare.startingRareTable(rule(4)), "RollTable.mining4");
assert.equal(rare.climbThreshold({}), 20);
assert.equal(rare.climbThreshold({ climbExpand: 1 }), 19, "Discerning Eye");

// --- entry ------------------------------------------------------------------------------
assert.equal(await rare.rareEntry({ degree: degree("partial"), natural20: false, trained: true, perks: { rareChance: 50 } }), null);
assert.equal((await rare.rareEntry({ degree: naturalMasterful(degree("failed")), natural20: true, trained: false, perks: {} })).trigger, "Natural 20", "Nat 20 works untrained");
assert.equal((await rare.rareEntry({ degree: degree("masterful"), trained: false, perks: {} })).trigger, "Masterful extraction");
settings.rules = { masterfulRareFind: false, excellentRareBonus: 10 };
assert.equal(await rare.rareEntry({ degree: degree("masterful"), trained: false, perks: {} }), null, "Rule off, untrained: nothing");
settings.rules = { excellentRareBonus: 10 };
assert.equal(await rare.rareEntry({ degree: degree("excellent"), trained: false, perks: { rareChance: 30 } }), null, "Untrained: no d100");
assert.equal(await rare.rareEntry({ degree: degree("successful"), trained: true, perks: {} }), null, "No chance: no roll");
rolls.push({ formula: "1d100", total: 19 });
let entry = await rare.rareEntry({ degree: degree("excellent"), trained: true, perks: { rareChance: 6 }, node: { rareChance: 3 } });
assert.equal(entry.chance, 19, "Skills 6 + node 3 + Excellent 10");
assert.match(entry.trigger, /Rare roll 19 ≤ 19%, Excellent \+10%/);
rolls.push({ formula: "1d100", total: 20 });
entry = await rare.rareEntry({ degree: degree("excellent"), trained: true, perks: { rareChance: 6 }, node: { rareChance: 3 } });
assert.equal(entry.trigger, null);
rolls.push({ formula: "1d100", total: 10 });
assert.equal((await rare.rareEntry({ degree: degree("successful"), trained: true, perks: { rareChance: 6 } })).chance, 6, "No Excellent bonus on Successful");
settings.rules = { excellentRareBonus: 25 };
rolls.push({ formula: "1d100", total: 99 });
assert.equal((await rare.rareEntry({ degree: degree("excellent"), trained: true, perks: {} })).chance, 25, "GM setting");
settings.rules = {};

// --- climbing: the check's nat 20 is one step; then the PLAYER rolls ----------------------
// Nat 20 never rolls a Fortune die by itself: the find waits.
const nat20 = (tier, perks = {}, node = null) => rare.resolveRareFind({ rule: rule(tier), degree: naturalMasterful(degree("successful")), natural20: true, perks, node });
let pending = await nat20(2);
assert.deepEqual([pending.pending, pending.tier, pending.steps, pending.items.length], [true, 3, [{ from: 2, to: 3, roll: null }], 0], "Nat 20: tier 3, waiting for the player");
assert.equal(rolls.length, 0, "No automatic climb roll");
const state = rare.climbState(pending);
assert.deepEqual(JSON.parse(JSON.stringify(state)), state, "Pending state is plain data (stored on the actor)");
rolls.push({ formula: "1d20", total: 7 });
let step = await rare.rollClimb(state);
assert.deepEqual([step.climbs, state.pending, state.tier, state.lastRoll], [false, false, 3, 7], "Player rolls 7: stays at tier 3");
await assert.rejects(rare.rollClimb(state), /no climb roll waiting/, "Cannot roll twice");
let found = await rare.finishRareFind(state);
assert.deepEqual([found.tier, names(found)], [3, ["Any-tier find"]], "Empty tier 3 uses the any-tier table");

// Chained 20s climb 1 → 4.
const chain = rare.climbState(await nat20(1));
rolls.push({ formula: "1d20", total: 20 }, { formula: "1d20", total: 20 }, { formula: "1d20", total: 3 });
while (chain.pending) await rare.rollClimb(chain);
assert.deepEqual([chain.tier, chain.steps.map(entry => entry.roll)], [4, [null, 20, 20]]);
// 19 climbs only with Discerning Eye; Fortune's Favour rolls 2d20kh.
let plain = rare.climbState(await nat20(1));
rolls.push({ formula: "1d20", total: 19 });
await rare.rollClimb(plain);
assert.equal(plain.tier, 2, "19 does not climb without Discerning Eye");
plain = rare.climbState(await nat20(1, { climbExpand: 1 }));
rolls.push({ formula: "1d20", total: 19 }, { formula: "1d20", total: 18 });
while (plain.pending) await rare.rollClimb(plain);
assert.equal(plain.tier, 3, "Discerning Eye climbs on 19");
plain = rare.climbState(await nat20(1, { climbAdvantage: true }));
rolls.push({ formula: "2d20kh", total: 12 });
await rare.rollClimb(plain);
assert.equal(plain.tier, 2);
// Past tier 5.
found = await nat20(5);
assert.deepEqual([found.pending, found.story, found.tier, names(found)], [false, true, 5, ["Mining T5 find"]], "Tier 5 material + nat 20: story at once, no roll");
const top = rare.climbState(await nat20(4));
rolls.push({ formula: "1d20", total: 20 });
await rare.rollClimb(top);
assert.deepEqual([top.pending, top.story, top.tier, top.steps.length], [false, true, 5, 2], "Climb to 5, then the player's 20 goes beyond");
assert.deepEqual(names(await rare.finishRareFind(top)), ["Mining T5 find"]);

// --- full resolution -------------------------------------------------------------------------
assert.equal(await rare.resolveRareFind({ rule: { profession: "herbalism", tier: 1, materialRareTable: "" }, degree: degree("masterful"), perks: {} }), null, "No tables: no rare");
assert.equal(await rare.resolveRareFind({ rule: { profession: "herbalism", tier: 1 }, degree: naturalMasterful(degree("successful")), natural20: true }), null,
  "Natural 20 does not promise a rare when no table exists");
assert.equal(await rare.resolveRareFind({ rule: { profession: "herbalism", tier: 1 }, degree: degree("masterful"), fortuneDie: true }), null,
  "Grandmaster's Touch does not promise an empty rare");
found = await rare.resolveRareFind({ rule: rule(1), degree: degree("masterful"), trained: true, perks: {} });
assert.deepEqual([found.tier, found.pending, names(found)], [1, false, ["Mining T1 find"]], "Masterful without nat 20 draws now on the material tier");
const rich = rare.climbState(await nat20(1, { rareDraws: 1 }));
rolls.push({ formula: "1d20", total: 4 });
await rare.rollClimb(rich);
assert.deepEqual(names(await rare.finishRareFind(rich)), ["Mining T2 find", "Mining T2 find"], "Rich Find draws twice from the final table");
const viaNode = rare.climbState(await nat20(1, {}, { rareTable: "RollTable.node" }));
rolls.push({ formula: "1d20", total: 1 });
await rare.rollClimb(viaNode);
assert.deepEqual(names(await rare.finishRareFind(viaNode)), ["Mining T2 find"], "Node table only replaces the starting table; climbs use the ladder");
found = await rare.resolveRareFind({ rule: rule(1), degree: degree("masterful"), perks: {}, node: { rareTable: "RollTable.node" } });
assert.deepEqual(names(found), ["Node find"]);
found = await nat20(5);

// Story whisper goes to GMs only.
const created = [];
globalThis.ChatMessage = { getWhisperRecipients: () => [{ id: "gm1" }], async create(message) { created.push(message); } };
await rare.whisperStoryFind({ actor: { name: "Lucien <b>" }, item: { name: "Mithril" }, page: { name: "Deep Vein" }, rare: found });
assert.deepEqual(created[0].whisper, ["gm1"]);
assert.match(created[0].content, /Lucien &lt;b&gt; climbed past the tier 5 rare table while gathering Mithril at Deep Vein/);

// --- default catalogue -------------------------------------------------------------------------
const all = Object.values(catalogue.RARE_FINDS).flat(2);
assert.deepEqual(Object.keys(catalogue.RARE_FINDS), ["mining", "herbalism", "logging", "skinning"]);
for (const tiers of Object.values(catalogue.RARE_FINDS)) {
  assert.equal(tiers.length, 5);
  for (const finds of tiers) assert.equal(finds.length, 3, "Three finds per tier");
}
assert.equal(all.length, 60);
assert.equal(new Set(all.map(entry => entry.name)).size, 60, "Every rare find is unique");
assert.ok(all.every(entry => entry.img.startsWith("icons/") && entry.text.length > 20));

// Builder: items, tables, and links; existing tier tables are kept.
const docs = { items: [], tables: [], folders: [] };
let nextId = 1;
const docClass = kind => ({ async create(data) {
  const list = (Array.isArray(data) ? data : [data]).map(entry => ({ ...entry, id: `${kind}${nextId}`, uuid: `${kind}.${kind}${nextId++}` }));
  docs[{ Item: "items", RollTable: "tables", Folder: "folders" }[kind]].push(...list);
  return Array.isArray(data) ? list : list[0];
} });
globalThis.Item = { implementation: docClass("Item") };
globalThis.RollTable = { implementation: docClass("RollTable") };
globalThis.Folder = { implementation: docClass("Folder") };
game.modules.get("eryndor-professions").api.setProfessions = async list => { settings.professions = rules.normalizeProfessions(list); return settings.professions; };
settings.professions = [
  { key: "mining", label: "Mining", ability: "str", rareTables: ["RollTable.keep", "", "", "", ""] },
  { key: "herbalism", label: "Herbalism", ability: "wis" },
  { key: "fishing", label: "Fishing", ability: "dex" }
];
assert.deepEqual(catalogue.rareFindProfessions(), ["mining", "herbalism"], "Only professions with a catalogue that exist here");
const built = await catalogue.buildRareFinds();
assert.deepEqual(built, { tables: 9, items: 27 }, "Mining tiers 2–5 + Herbalism 1–5");
const mining = rules.getProfessions().mining;
assert.equal(mining.rareTables[0], "RollTable.keep", "Existing tier table kept");
assert.ok(mining.rareTables.slice(1).every(uuid => uuid.startsWith("RollTable.")));
const t5 = docs.tables.find(entry => entry.name === "Herbalism Rare Finds — Tier 5");
assert.equal(t5.results.length, 3);
assert.equal(t5.formula, "1d3");
const seed = docs.items.find(entry => entry.name === "Seed of the World Tree");
assert.deepEqual(seed.flags["eryndor-professions"].rareFind, { profession: "herbalism", tier: 5 });
assert.equal(seed.system.rarity, "artifact");
assert.equal(rules.getProfessions().fishing.rareTables.join(""), "", "Custom professions untouched");

// --- Fortune skill rebalance ---------------------------------------------------------------------
const skill = key => tree.UNIVERSAL_SKILLS.find(entry => entry.key === key).perk;
assert.deepEqual({ ...skill("discerningEye") }, { climbExpand: 1 });
assert.deepEqual({ ...skill("treasureHunter") }, { rareChance: 6 });
assert.deepEqual({ ...skill("fortunesFavour") }, { rareChance: 5, climbAdvantage: true });
assert.deepEqual({ ...tree.UNIVERSAL_SKILLS.find(entry => entry.key === "grandmastersTouch").perk }, { masterfulUses: 1 }, "Grandmaster's Touch: auto-Masterful once per long rest");
settings.professions = [{ key: "mining", label: "Mining", ability: "str", rareTable: "RollTable.anyTier", rareTables: ["RollTable.mining1", "RollTable.mining2", "", "RollTable.mining4", "RollTable.mining5"] }];
// Grandmaster's Touch find: guaranteed, starts on the material tier, waits for the Fortune die there.
const touched = await rare.resolveRareFind({ rule: rule(3), degree: naturalMasterful(degree("successful")), fortuneDie: true, perks: {} });
assert.deepEqual([touched.trigger, touched.pending, touched.tier, touched.steps.length], ["Grandmaster's Touch", true, 3, 0]);
const touchState = rare.climbState(touched);
rolls.push({ formula: "1d20", total: 11 });
await rare.rollClimb(touchState);
assert.deepEqual(names(await rare.finishRareFind(touchState)), ["Any-tier find"], "Stays at tier 3");
const touchedTop = rare.climbState(await rare.resolveRareFind({ rule: rule(5), degree: naturalMasterful(degree("successful")), fortuneDie: true, perks: {} }));
rolls.push({ formula: "1d20", total: 20 });
await rare.rollClimb(touchedTop);
assert.deepEqual([touchedTop.story, touchedTop.tier], [true, 5], "A 20 at tier 5 is the story discovery");
// Stale skill Items (world and on characters) are rewritten; current ones are left alone.
const updates = [];
const skillItem = (id, key, perk) => ({ id, getFlag: (_scope, flag) => ({ universalSkill: key, perk })[flag] });
game.items = [skillItem("w1", "treasureHunter", { enabled: true, profession: "any", rareChance: 5, rareAdvantage: true }), skillItem("w2", "keenEye", { enabled: true, profession: "any", rareChance: 3 })];
Item.implementation.updateDocuments = async list => updates.push(["world", list]);
const holder = { items: [skillItem("a1", "fortunesFavour", { enabled: true, profession: "any", rareDouble: true })], async updateEmbeddedDocuments(_type, list) { updates.push(["actor", list]); } };
game.actors = [holder];
assert.equal(await tree.syncSkillItems(), 2);
assert.deepEqual(updates.map(([where, list]) => [where, list.map(change => change._id)]), [["world", ["w1"]], ["world", ["w1"]], ["actor", ["a1"]], ["actor", ["a1"]]]);
assert.deepEqual(updates[1][1][0]["flags.eryndor-professions.perk"], { enabled: true, profession: "any", rareChance: 6 });
assert.ok("flags.eryndor-professions.-=perk" in updates[0][1][0], "Old perk cleared first, so rareAdvantage does not survive");

assert.equal(rolls.length, 0, "Every expected roll was used");
console.log("PASS: rare finds — tier tables, entry, Excellent bonus, pending nat 20 climbs, Discerning Eye, Fortune's Favour, story discoveries, Rich Find, catalogue, builder, skill rebalance.");
