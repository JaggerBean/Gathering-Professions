import assert from "node:assert/strict";
import { getDegreeOfSuccess, calculateGatheringYield, gatheringXp } from "../scripts/gathering.js";
import { materialRule, checkFormula, rankForXp, rankForActor, selectedProfession, professionFlag, activeRules } from "../scripts/rules.js";
import { openMaterialEditor, openMaterialManager, saveRulesValues, openProgressEditor, openProfessionMenu, openSkillTree, registerSceneControls } from "../scripts/ui.js";

// Isolated integration doubles; no world data is touched. evaluateSync deliberately
// throws, and every asynchronous roll must match an explicit expectation.
const hooks = new Map();
const posted = [];
const gathered = [];
const errors = [];
const rolls = [];
const delay = () => new Promise(resolve => setImmediate(resolve));
let dialogValues;
const confirmAnswers = [];
const confirmPrompts = [];
let dialogHtml = "";
let savedRules = {};
// worldContentVersion 2: skip the ready-time world content setup in this suite.
// Content/bootstrap coverage lives in world.mjs; do not run it with incomplete
// folder/import doubles in this check-and-gather integration suite.
const settingsStore = { worldContentVersion: 3, refiningVersion: 1 };
class Item {
  constructor(name, material, folder = "Wkx8ircLDt9noLvA") {
    Object.assign(this, { name, material, id: name, img: "stone.webp", _source: { folder } });
  }
  getFlag() { return this.material; }
  async setFlag(_module, _key, value) { this.material = { ...this.material, ...value }; }
  toObject() { return { name: this.name, system: {} }; }
}
const gatherCalls = [];
class GathererSheet {
  async toChat(things) { gathered.push(...things.map(thing => ({ ...thing }))); }
  async _onGather(...args) { gatherCalls.push(args); return "gathered"; }
}
globalThis.gatherer = GathererSheet;
const completions = [];
globalThis.Hooks = {
  on(name, callback) {
    if (!hooks.has(name)) {
      const callbacks = [];
      const dispatch = (...args) => { for (const fn of [...callbacks]) fn(...args); };
      dispatch.callbacks = callbacks;
      hooks.set(name, dispatch);
    }
    hooks.get(name).callbacks.push(callback);
    return callback;
  },
  off(name, callback) { const list = hooks.get(name)?.callbacks; if (list?.includes(callback)) list.splice(list.indexOf(callback), 1); },
  callAll(name, payload) { if (name === "gatheringProfessionsGatherComplete") completions.push(payload); hooks.get(name)?.(payload); },
  once(name, callback) { hooks.set(name, callback); }
};
globalThis.CONFIG = { Item: { documentClass: { implementation: Item } } };
globalThis.document = { createElement() { return { innerHTML: "" }; } };
globalThis.foundry = {
  utils: {
    getProperty(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); },
    randomID: () => Math.random().toString(36).slice(2, 18),
    deepClone: value => structuredClone(value),
    setProperty(object, path, value) {
      const keys = path.split(".");
      const final = keys.pop();
      const target = keys.reduce((current, key) => current[key] ??= {}, object);
      target[final] = value;
    }
  },
  applications: { api: { DialogV2: {
    async input(options) { dialogHtml = options.content.innerHTML; return dialogValues; },
    async prompt(options) { dialogHtml = options.content.innerHTML; },
    // Second Look asks the player; tests queue answers (default: no).
    async confirm(options) { confirmPrompts.push(options); return confirmAnswers.length ? confirmAnswers.shift() : false; }
  } } }
};
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.game = {
  settings: {
    get(namespace, key) {
      if (namespace === "gatherer") return "quantity";
      return key === "rules" ? { gatherAttemptsPerRest: 0, ...savedRules } : settingsStore[key];
    },
    async set(_namespace, key, value) {
      if (key === "rules") savedRules = value;
      else settingsStore[key] = value;
    }
  },
  modules: new Map([["gatherer", { active: true }], ["gathering-professions", {}]]),
  user: { isGM: true }, items: [], actors: []
};
globalThis.ui = { notifications: { info() {}, warn() {}, error(message) { errors.push(message); } } };
globalThis.ChatMessage = {
  getSpeaker() { return {}; }, async create(message) { posted.push(message); }
};
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  static validate(formula) { return /^(?:\d+d\d+|\d+)(?:\s*\+\s*\d+)?$/.test(formula); }
  evaluateSync() { throw Error("Synchronous dice evaluation is forbidden"); }
  async evaluate(options = {}) {
    const expected = rolls.shift();
    assert.ok(expected, `Unexpected roll: ${this.formula}`);
    assert.equal(this.formula, expected.formula);
    assert.deepEqual(options, expected.options ?? {});
    await delay();
    this.total = expected.total;
    this.result = String(this.total);
    // The d20 is never a natural 20 unless the expectation says so (d20: 20).
    const d20 = expected.d20 ?? Math.max(1, Math.min(19, this.total - 1));
    this.dice = [{ total: d20 }, { total: Math.max(1, this.total - d20) }];
    return this;
  }
  async toMessage(message) { posted.push(message); }
};

function makeActor(initialXp = 0, profession = "mining", modifier = 0) {
  const inventory = [];
  const xp = { [profession]: initialXp };
  const ranks = {};
  const flags = {};
  return {
    name: "Test gatherer", id: "test-actor", type: "character", isOwner: true, selected: profession, inventory, xp, ranks,
    system: { abilities: { str: { mod: modifier }, dex: { mod: modifier }, wis: { mod: modifier } } },
    flags,
    getFlag(_module, key) {
      if (key === "selectedProfession") return this.selected;
      const [kind, professionName] = key.split(".");
      if (kind === "rank" || kind === "xp") return (kind === "rank" ? ranks : xp)[professionName];
      return foundry.utils.getProperty(flags, key);
    },
    async setFlag(_module, key, value) {
      await delay();
      if (key === "selectedProfession") { this.selected = value; return; }
      const [kind, professionName] = key.split(".");
      if (kind === "rank" || kind === "xp") (kind === "rank" ? ranks : xp)[professionName] = value;
      else foundry.utils.setProperty(flags, key, value);
    },
    async unsetFlag(_module, key) { delete flags[key]; },
    async update(changes) {
      await delay();
      for (const [path, value] of Object.entries(changes)) {
        const modulePrefix = "flags.gathering-professions.";
        if (path.startsWith(modulePrefix)) foundry.utils.setProperty(flags, path.slice(modulePrefix.length), value);
        else foundry.utils.setProperty(this, path, value);
      }
      return this;
    },
    items: {
      getName(name) { return inventory.find(item => item.name === name); },
      [Symbol.iterator]() { return inventory[Symbol.iterator](); }
    },
    async createEmbeddedDocuments(_type, items) {
      await delay();
      inventory.push(...items.map(item => ({ ...item,
        async update(patch) { await delay(); this.system = { ...this.system, ...patch.system }; }
      })));
    }
  };
}

await import("../scripts/main.js");
await hooks.get("ready")();
const gather = hooks.get("gathererGather");
const sheet = new GathererSheet();
const api = game.modules.get("gathering-professions").api;
const stone = new Item("Stone", { profession: "mining", tier: 1, baseYield: "1d4" });
function queueGather(actor, item, total, yieldResult, options = {}) {
  const rule = materialRule(item);
  const check = checkFormula(actor, rule.profession, actor.xp[rule.profession] ?? 0, rule.dc, rule);
  rolls.push({ formula: check.formula, total });
  if (yieldResult !== undefined) rolls.push({ formula: rule.baseYield, total: yieldResult, options });
  const data = { actor, things: [{ item, quantity: 99 }] };
  gather(data);
  assert.equal(data.things.length, 0, "Configured items must wait for the asynchronous check");
  lastThings = data.things;
  return data.things;
}
let lastThings;
const gathererLast = () => lastThings;

const boundaries = [
  [-30, "failed"], [-5, "failed"], [-4, "partial"], [-1, "partial"],
  [0, "successful"], [4, "successful"], [5, "excellent"], [9, "excellent"],
  [10, "masterful"], [50, "masterful"]
];
for (const [margin, id] of boundaries) {
  const degree = getDegreeOfSuccess(30 + margin, 30);
  assert.equal(degree.id, id);
  assert.equal(degree.margin, margin);
  assert.equal(gatheringXp({ xp: 7 }, degree), ["failed", "partial"].includes(id) ? 0 : 7);
}
assert.throws(() => getDegreeOfSuccess(NaN, 10), /finite/);

// Realistic Rank 1 checks at all category edges, with deliberately high Gatherer
// quantity to prove the material configuration is the sole quantity source.
for (const [total, quantity, expectedXp, label, yieldResult] of [
  [5, 0, 0, "Failed", undefined], [6, 1, 0, "Partial", undefined],
  [9, 1, 0, "Partial", undefined], [10, 3, 5, "Successful", 3],
  [14, 2, 5, "Successful", 2], [15, 4, 5, "Excellent", 3],
  [19, 3, 5, "Excellent", 2], [20, 5, 5, "Masterful", 4]
]) {
  const actor = makeActor();
  const before = gathered.length;
  const things = queueGather(actor, stone, total, yieldResult,
    label === "Masterful" ? { maximize: true, allowInteractive: false } : {});
  await sheet.toChat(things, actor);
  assert.equal(actor.inventory[0]?.system.quantity ?? 0, quantity, label);
  assert.equal(actor.xp.mining, expectedXp, label);
  assert.equal(gathered.length - before, quantity > 0 ? 1 : 0);
  const card = posted.at(-1).flavor;
  assert.ok(card.includes(`${label} Extraction`));
  for (const field of ["Rank:", "Profession Die:", "Strength Modifier:", "Base DC:", "Rank Reduction:",
    "Final DC:", "Roll Total:", "Margin:", "Base Yield:", "Yield Bonus:", "Gathered:", "Mining XP:"]) {
    assert.ok(card.includes(field), `Chat card missing ${field}`);
  }
  assert.match(card, /Base Yield: <strong>1d4<\/strong>/);
}

// Fixed, missing, blank and old legacy yield all use the requested baseYield rules.
for (const baseYield of ["1", undefined, ""]) {
  const item = new Item("Stone", { profession: "mining", tier: 1, baseYield, yield: "1d20" });
  assert.equal(materialRule(item).baseYield, "1");
  for (const [total, expected] of [[10, 1], [15, 2], [20, 2]]) {
    const actor = makeActor();
    await sheet.toChat(queueGather(actor, item, total, 1,
      total === 20 ? { maximize: true, allowInteractive: false } : {}), actor);
    assert.equal(actor.inventory[0].system.quantity, expected);
  }
}
assert.equal(materialRule(new Item("Stone", undefined)).baseYield, "1");

// Preserve other profession and rank calculations, including the example rank 3 DC.
const herbalist = makeActor(300, "herbalism", 3);
const herb = new Item("Test Herb", { profession: "herbalism", tier: 1, baseYield: "1d2 + 1" }, null);
assert.deepEqual(checkFormula(herbalist, "herbalism", 300, 10), {
  rank: 3, trained: true, ability: "wis", modifier: 3, die: 8, reduction: 4, tierPenalty: 0, materialPenalty: 0, target: 6,
  formula: "1d20 + 3 + 1d8"
});
await sheet.toChat(queueGather(herbalist, herb, 16, 3, { maximize: true, allowInteractive: false }), herbalist);
assert.equal(herbalist.inventory[0].system.quantity, 4);
assert.equal(herbalist.xp.herbalism, 305);
assert.match(posted.at(-1).flavor, /Wisdom Modifier: \+3/);
assert.match(posted.at(-1).flavor, /Maximum: 3 = 3/);
assert.deepEqual([0, 100, 300, 700, 1500].map(rankForXp), [1, 2, 3, 4, 5]);

// Two rapid gathers into an existing stack must preserve both quantity and XP.
const actor = makeActor();
await actor.createEmbeddedDocuments("Item", [{ name: "Stone", system: { quantity: 10 } }]);
const first = queueGather(actor, stone, 10, 3);
const second = queueGather(actor, stone, 15, 2);
await Promise.all([sheet.toChat(first, actor), sheet.toChat(second, actor), sheet.toChat(first, actor)]);
assert.equal(actor.inventory.length, 1);
assert.equal(actor.inventory[0].system.quantity, 16);
assert.equal(actor.xp.mining, 10);

// Unassigned/disabled materials and text remain in Gatherer's normal path.
for (const item of [new Item("Unassigned", undefined, null),
  new Item("Stone", { enabled: false }), { name: "Text result" }]) {
  const data = { actor, things: [{ item, quantity: 7 }] };
  gather(data);
  assert.equal(data.things.length, 1);
  await sheet.toChat(data.things, actor);
  assert.equal(gathered.at(-1).quantity, 7);
}

// Maximum mode must be explicitly requested; normal modes use asynchronous dice.
for (const [formula, maximum] of [["1d4", 4], ["1d2", 2], ["1d2 + 1", 3], ["1", 1]]) {
  rolls.push({ formula, total: maximum, options: { maximize: true, allowInteractive: false } });
  const result = await calculateGatheringYield({ baseYield: formula }, getDegreeOfSuccess(20, 10));
  assert.equal(result.quantity, maximum + 1);
}
rolls.push({ formula: "1d4", total: NaN });
await assert.rejects(calculateGatheringYield({ baseYield: "1d4" }, getDegreeOfSuccess(10, 10)), /positive whole/);
await assert.rejects(calculateGatheringYield({ baseYield: "bad formula" }, getDegreeOfSuccess(10, 10)), /valid dice/);

const invalidActor = makeActor();
const invalidMaterial = new Item("Invalid Stone", { profession: "mining", tier: 1, baseYield: "bad formula" });
await sheet.toChat(queueGather(invalidActor, invalidMaterial, 10), invalidActor);
assert.equal(invalidActor.inventory.length, 0);
assert.equal(invalidActor.xp.mining, 0);
assert.equal(errors.length, 1);
assert.match(errors.pop(), /valid dice/);

// Exercise both editor entry points through the same save API. Automatic mining
// assignments must retain an edited Base Yield, and cleared overrides must reset.
const editable = new Item("Stone", { profession: "mining", tier: 1, enabled: false, dc: 28, xp: 60 });
dialogValues = { assignment: "mining", tier: "1", dc: "", xp: "", baseYield: " 1d4 " };
assert.equal(await openMaterialEditor(editable), true);
assert.ok(dialogHtml.includes('name="baseYield"'));
assert.deepEqual(materialRule(editable), { profession: "mining", tier: 1, dc: 10, xp: 5, baseYield: "1d4", untrainedDc: 0, rareTable: "", materialRareTable: "", conditions: [] });
dialogValues = { assignment: "automatic", tier: "1", dc: "", xp: "", baseYield: "1d2" };
assert.equal(await openMaterialEditor(editable), true);
assert.equal(materialRule(editable).baseYield, "1d2");
assert.equal(editable.material.profession, null);
game.items = [editable];
{
  // The materials browser (GM hub) lists it under Mining, tier 1, with no node yet.
  const { materialsModel } = await import("../scripts/materials.js");
  const model = materialsModel("mining", game.items, new Map());
  assert.deepEqual(model.gathering[0].materials.map(entry => [entry.name, entry.baseYield, entry.nodes.length]), [["Stone", "1d2", 0]]);
  assert.equal(model.gathering.length, 5);
  assert.equal(model.rare.length, 5);
}
await assert.rejects(api.setMaterial(editable, { profession: "mining", tier: 1, baseYield: "bad formula" }), /valid dice/);
await assert.rejects(api.setMaterial(editable, { profession: "mining", tier: 1, baseYield: 4 }), /stored as text/);
assert.equal(materialRule(editable).baseYield, "1d2", "Invalid saves must preserve the previous formula");

// Milestone advancement: keep accumulated XP, freeze existing ranks, and let
// the GM choose a rank independently of XP. Automatic mode remains available.
function ruleForm(mode) {
  const values = { advancementMode: mode };
  for (let index = 0; index < 5; index++) {
    values[`dc${index}`] = String([10, 14, 18, 23, 28][index]);
    values[`untrainedDc${index}`] = "0";
    values[`tierXp${index}`] = String([5, 10, 20, 35, 60][index]);
    values[`reduction${index}`] = String(index * 2);
    if (index) values[`rankXp${index}`] = String([0, 100, 300, 700, 1500][index]);
  }
  return values;
}
const veteran = makeActor(695);
const thresholdActor = makeActor(95);
await sheet.toChat(queueGather(thresholdActor, stone, 10, 1), thresholdActor);
assert.equal(thresholdActor.xp.mining, 100);
assert.equal(api.getProgress(thresholdActor).mining.rank, 2,
  "Automatic advancement must remain the default behavior");
assert.equal(checkFormula(thresholdActor, "mining", 100, 10).formula, "1d20 + 0 + 1d6");
game.actors = [veteran, thresholdActor];
dialogValues = ruleForm("milestone");
assert.equal(await saveRulesValues(dialogValues), true);
assert.equal(savedRules.milestoneAdvancement, true);
assert.equal(veteran.ranks.mining, 3, "Switching modes must preserve the current XP-derived rank");
assert.equal(thresholdActor.ranks.mining, 2);
assert.equal(veteran.ranks.herbalism, undefined);
assert.equal(rankForActor(veteran, "herbalism", 1500), 0);
assert.equal(rankForActor(veteran, "mining", veteran.xp.mining), 3);

await sheet.toChat(queueGather(veteran, stone, 10, 2), veteran);
assert.equal(veteran.xp.mining, 700);
assert.equal(veteran.ranks.mining, 3, "Reaching the Rank 4 XP threshold cannot auto-promote");
assert.match(posted.at(-1).flavor, /Rank: 3/);
assert.match(posted.at(-1).flavor, /Profession Die: d8/);
assert.equal(api.getProgress(veteran).mining.rank, 3);

dialogValues = {
  mining: "700", herbalism: "0", logging: "0", skinning: "0",
  rank_mining: "4", rank_herbalism: "1", rank_logging: "1", rank_skinning: "1"
};
assert.equal(await openProgressEditor(veteran), true);
assert.match(dialogHtml, /name="rank_mining"/);
assert.match(dialogHtml, /XP continues to accumulate/);
assert.equal(veteran.ranks.mining, 4);
assert.equal(veteran.xp.mining, 700);
assert.equal(api.getProgress(veteran).mining.rank, 4);
assert.equal(checkFormula(veteran, "mining", 700, 10).formula, "1d20 + 0 + 1d10");
assert.equal(checkFormula(veteran, "mining", 700, 10).target, 4);
await sheet.toChat(queueGather(veteran, stone, 10, 2), veteran);
assert.match(posted.at(-1).flavor, /Profession Die: d10/);
assert.match(posted.at(-1).flavor, /Rank Reduction: −6/);
assert.equal(veteran.xp.mining, 705);
assert.equal(veteran.ranks.mining, 4);

const newcomer = makeActor(1500);
assert.equal(rankForActor(newcomer, "mining", newcomer.xp.mining), 1,
  "A character created after enabling milestones must start at Rank 1");
await api.setRank(newcomer, "mining", 5);
assert.equal(rankForActor(newcomer, "mining", newcomer.xp.mining), 5);
const earlyMilestone = makeActor(0);
await api.setRank(earlyMilestone, "mining", 5);
assert.equal(checkFormula(earlyMilestone, "mining", 0, 10).formula, "1d20 + 0 + 1d12",
  "The GM can grant a milestone rank independently of XP");
await assert.rejects(api.setRank(newcomer, "mining", 6), /Rank must be/);
game.user.isGM = false;
await assert.rejects(api.setRank(newcomer, "mining", 4), /Only the GM/);
assert.equal(await openProgressEditor(veteran), false);
assert.doesNotMatch(dialogHtml, /name="rank_mining"/);
game.user.isGM = true;

dialogValues = ruleForm("automatic");
assert.equal(await saveRulesValues(dialogValues), true);
assert.equal(savedRules.milestoneAdvancement, false);
assert.equal(rankForActor(newcomer, "mining", 1500), 5);
assert.equal(rankForActor(veteran, "mining", 705), 4);
await api.setRank(veteran, "mining", 5).then(
  () => assert.fail("Manual ranks must be locked in automatic mode"),
  error => assert.match(error.message, /Enable GM-controlled ranks/)
);
dialogValues = ruleForm("milestone");
assert.equal(await saveRulesValues(dialogValues), true);
assert.equal(veteran.ranks.mining, 4, "Re-enabling milestones snapshots the current automatic rank");

// Only the chosen profession grants bonuses, even with banked XP and an old rank.
const untrained = makeActor(1495, "mining", 3);
untrained.selected = "herbalism";
untrained.ranks.mining = 5;
savedRules.tierUntrainedDc = [2, 4, 6, 8, 10];
const hardStone = new Item("Stone", { profession: "mining", tier: 2, dc: 17, untrainedDc: 3, baseYield: "1d2" });
assert.deepEqual(checkFormula(untrained, "mining", 1495, 17, materialRule(hardStone)), {
  rank: 0, trained: false, ability: "str", modifier: 3, die: null, reduction: 0,
  tierPenalty: 4, materialPenalty: 3, target: 24, formula: "1d20 + 3"
});
await sheet.toChat(queueGather(untrained, hardStone, 24, 2), untrained);
assert.equal(untrained.inventory[0].system.quantity, 2);
assert.equal(untrained.xp.mining, 1505, "Untrained successes must bank material XP");
assert.equal(api.getProgress(untrained).mining.rank, 0);
assert.equal(api.getProgress(untrained).mining.nextRankXp, null);
assert.match(posted.at(-1).flavor, /Untrained Tier DC: \+4/);
assert.match(posted.at(-1).flavor, /Untrained Material DC: \+3/);
assert.match(posted.at(-1).flavor, /Profession Die: None/);
assert.match(posted.at(-1).flavor, /banked; no rank/);
assert.doesNotMatch(posted.at(-1).flavor, /dnull|dundefined/);
const trainedCheck = checkFormula(veteran, "mining", 705, 17, materialRule(hardStone));
assert.equal(trainedCheck.target, 11);
assert.equal(trainedCheck.tierPenalty + trainedCheck.materialPenalty, 0);
await assert.rejects(api.setRank(untrained, "mining", 4), /Only the selected/);

// Material and tier editors persist both additive penalties, including zero reset.
dialogValues = { assignment: "mining", tier: "2", dc: "17", xp: "", baseYield: "1d2", untrainedDc: "3" };
assert.equal(await openMaterialEditor(editable), true);
assert.equal(materialRule(editable).untrainedDc, 3);
assert.match(dialogHtml, /Extra untrained DC/);
await assert.rejects(api.setMaterial(editable, { profession: "mining", tier: 1, untrainedDc: -1 }), /Extra untrained DC/);
dialogValues.untrainedDc = "0";
assert.equal(await openMaterialEditor(editable), true);
assert.equal(materialRule(editable).untrainedDc, 0);
dialogValues = ruleForm("milestone");
dialogValues.untrainedDc2 = "7";
assert.equal(await saveRulesValues(dialogValues), true);
assert.equal(savedRules.tierUntrainedDc[2], 7);

// Choice is once per owned character. Existing progress is retained, not erased.
const chooser = makeActor(300);
chooser.selected = null;
chooser.ranks.mining = 3;
assert.ok(Object.values(api.getProgress(chooser)).every(entry => entry.rank === 0));
game.user.isGM = false;
dialogValues = { selectedProfession: "mining", mining: "999999", rank_mining: "5" };
assert.equal(await openProgressEditor(chooser), true);
assert.equal(chooser.selected, "mining");
assert.equal(chooser.xp.mining, 300, "Player selection cannot edit XP");
assert.equal(rankForActor(chooser, "mining"), 3);
await assert.rejects(api.selectProfession(chooser, "logging"), /choose a profession once/);
await assert.rejects(api.selectProfession(chooser, null), /choose a profession once/);
assert.equal(await openProgressEditor(chooser), false);
assert.doesNotMatch(dialogHtml, /name="selectedProfession"/);
assert.match(dialogHtml, /Gathering profession: Mining/);
assert.doesNotMatch(dialogHtml, /Next.rank|Next-rank XP guide/);
assert.match(dialogHtml, /This profession grants your rank and profession die/);
assert.doesNotMatch(dialogHtml, /Other attempts use|Successful untrained|Ranks are awarded by the GM/);
chooser.isOwner = false;
assert.equal(await openProgressEditor(chooser), false);
await assert.rejects(api.selectProfession(chooser, "logging"), /character you own/);
chooser.isOwner = true;
const fresh = makeActor();
fresh.selected = null;
await api.selectProfession(fresh, "logging");
assert.equal(rankForActor(fresh, "logging"), 1);
assert.equal(rankForActor(fresh, "mining"), 0);
const racing = makeActor();
racing.selected = null;
const selections = await Promise.allSettled([api.selectProfession(racing, "mining"), api.selectProfession(racing, "logging")]);
assert.deepEqual(selections.map(result => result.status), ["fulfilled", "rejected"]);
assert.equal(racing.selected, "mining");
game.user.isGM = true;
await api.selectProfession(chooser, "herbalism");
assert.equal(rankForActor(chooser, "mining"), 0);
await api.selectProfession(chooser, "mining");
assert.equal(rankForActor(chooser, "mining"), 3);
assert.equal(chooser.xp.mining, 300);
await api.selectProfession(chooser, null);
assert.ok(Object.values(api.getProgress(chooser)).every(entry => entry.rank === 0));

// Scene control is present; player shortcut resolves the selected owned token,
// otherwise the assigned character. Reading the menu does not alter progress.
game.user.isGM = false;
game.user.character = fresh;
dialogValues = undefined;
registerSceneControls();
const controls = { tokens: { tools: {} } };
hooks.get("getSceneControlButtons")(controls);
assert.equal(controls.tokens.tools["gp-professions"].button, true);
assert.equal(typeof controls.tokens.tools["gp-professions"].onChange, "function");
assert.equal(controls.tokens.tools["gp-skill-tree"].button, true);
assert.equal(controls.tokens.tools["gp-skill-tree"].order, controls.tokens.tools["gp-professions"].order + 1);
await openProfessionMenu();
assert.match(dialogHtml, /Gathering profession: Logging/);
globalThis.canvas = { tokens: { controlled: [{ actor: racing }] } };
await openProfessionMenu();
assert.match(dialogHtml, /Gathering profession: Mining/);
assert.equal(racing.xp.mining, 0);
globalThis.canvas.tokens.controlled = [];
game.user.isGM = true;


// ---------------------------------------------------------------------------
// 0.5.0: GM-defined professions, Skill Tree points, perks, and rare finds.
// ---------------------------------------------------------------------------
// Older suites predate the Excellent rare bonus (0.10.0 tests set it explicitly).
savedRules = { excellentRareBonus: 0 };
game.user.isGM = true;

// Custom profession list: add Fishing (Dexterity) and keep the originals.
const professionList = [
  { key: "mining", label: "Mining", ability: "str", rareTable: "RollTable.rareOre" },
  { key: "herbalism", label: "Herbalism", ability: "wis" },
  { key: "logging", label: "Logging", ability: "str" },
  { key: "skinning", label: "Skinning", ability: "wis" },
  { label: "Fishing", ability: "dex" }
];
await api.setProfessions(professionList);
assert.deepEqual(Object.keys(api.professions), ["mining", "herbalism", "logging", "skinning", "fishing"]);
assert.equal(api.professions.fishing.ability, "dex");
settingsStore.professions = [{ key: "harvesting", label: "Harvesting", ability: "wis" }];
const legacySkinner = makeActor(35, "harvesting");
assert.equal(api.professions.skinning.label, "Skinning", "Saved profession uses the new name and key");
assert.equal(selectedProfession(legacySkinner), "skinning", "Old selections stay trained");
assert.equal(professionFlag(legacySkinner, "xp", "skinning"), 35, "Old XP remains visible");
assert.equal(materialRule(new Item("Hide", { profession: "harvesting", tier: 1 }, null)).profession, "skinning",
  "Old material assignments still use Skinning checks");
await api.setProfessions(professionList);
await assert.rejects(api.setProfessions([{ label: "Mining" }, { key: "mining", label: "Again", ability: "str" }]), /ability|Two professions/);
await assert.rejects(api.setProfessions([{ key: "selectedProfession", label: "Bad", ability: "str" }]), /must start|reserved/);
await assert.rejects(api.setProfessions([{ key: "rank_x", label: "Bad", ability: "str" }]), /must start/);
await assert.rejects(api.setProfessions([{ key: "assignment", label: "Bad", ability: "str" }]), /reserved/);
await assert.rejects(api.setProfessions([]), /at least one/);
await assert.rejects(api.setProfessions([{ label: "Cooking", ability: "luck" }]), /valid ability/);
assert.equal(Object.keys(api.professions).length, 5, "Rejected saves keep the previous list");

const fisher = makeActor(0, "fishing", 2);
const trout = new Item("Trout", { profession: "fishing", tier: 1, baseYield: "1" }, null);
assert.equal(materialRule(trout).profession, "fishing");
assert.equal(checkFormula(fisher, "fishing", 0, 10).formula, "1d20 + 2 + 1d4");
await sheet.toChat(queueGather(fisher, trout, 12, 1), fisher);
assert.match(posted.at(-1).flavor, /Fishing — Trout/);
assert.match(posted.at(-1).flavor, /Dexterity Modifier: \+2/);
assert.equal(fisher.xp.fishing, 5);

// Professions (GM hub): rename, add, and remove.
await api.setProfessions([
  { key: "mining", label: "Mining", ability: "str", rareTable: "RollTable.rareOre" },
  { key: "herbalism", label: "Herbalism", ability: "wis", rareTable: "" },
  { key: "logging", label: "Woodcutting", ability: "str", rareTable: "" },
  { key: "fishing", label: "Fishing", ability: "dex", rareTable: "" },
  { key: "", label: "Foraging", ability: "dex", rareTable: "" }
]);
assert.equal(typeof api.openProfessionsEditor, "function");
assert.deepEqual(Object.keys(api.professions), ["mining", "herbalism", "logging", "fishing", "foraging"]);
assert.equal(api.professions.logging.label, "Woodcutting");
assert.equal(materialRule(new Item("Hide", { profession: "skinning", tier: 1 }, null)), null,
  "Removed professions fall back to Gatherer's normal awards");
await api.setProfessions(professionList);

// Skill Tree: one shared tree, points per rank-up, catch-up on first sync.
const granted = [];
const tree = { name: "Gathering Tree", uuid: "JournalEntry.tree", getFlag: (_m, key) => key === "isSkillTree" };
tree.testUserPermission = () => true;
game.journal = [tree];
globalThis.fromUuidSync = uuid => uuid === tree.uuid ? tree : null;
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
const openedTrees = [];
game.modules.set("skill-tree", { active: true, API: {
  apps: { SkillTreeActor: class {
    constructor(actor) { this.actor = actor; }
    render(force) { openedTrees.push({ actor: this.actor, force }); return this; }
  } },
  async grantSkillPoints(target, points, options) { granted.push({ actor: target.name, points, tree: options.skillTree?.name }); }
} });
await api.setSkillTreeConfig({ uuid: tree.uuid, pointsPerRank: 2, startingPoints: 1 });
game.user.isGM = false;
game.user.character = fresh;
globalThis.canvas.tokens.controlled = [];
assert.equal(await openSkillTree(), true);
assert.deepEqual(openedTrees.at(-1), { actor: fresh, force: true });
assert.equal(fresh.getFlag("skill-tree", "selectedSkillTree"), tree.uuid);
globalThis.canvas.tokens.controlled = [{ actor: racing }];
assert.equal(await openSkillTree(), true);
assert.equal(openedTrees.at(-1).actor, racing, "Selected owned token takes precedence");
globalThis.canvas.tokens.controlled = [];
game.user.isGM = true;
await assert.rejects(api.setSkillTreeConfig({ uuid: tree.uuid, pointsPerRank: -1 }), /Points per rank/);

const climber = makeActor(95);
climber.name = "Climber";
assert.deepEqual(await api.syncActor(climber), { granted: 1 }, "Rank 1 grants starting points only");
assert.equal(climber.flags.treePoints.tree, 1, "Points are recorded per tree");
assert.equal(climber.flags.effectiveRank.mining, 1);
assert.equal(climber.flags.effectiveRank.herbalism, 0);
await sheet.toChat(queueGather(climber, stone, 10, 1), climber);
assert.equal(api.getProgress(climber).mining.rank, 2);
assert.equal(climber.flags.effectiveRank.mining, 2, "Rank mirror updates on rank-up");
assert.deepEqual(granted.at(-1), { actor: "Climber", points: 2, tree: "Gathering Tree" });
assert.deepEqual(await api.syncActor(climber), { granted: 0 }, "Points are never granted twice");

const veteranMiner = makeActor(750);
veteranMiner.name = "Veteran";
game.actors = [veteranMiner];
assert.equal(await api.syncAllActors(), 1 + 3 * 2, "Catch-up grants starting points plus ranks 2–4");
await api.setXp(veteranMiner, "mining", 0);
assert.equal(veteranMiner.flags.effectiveRank.mining, 1);
assert.equal(veteranMiner.flags.treePoints.tree, 7, "Lowering a rank never removes points");
const beforeMilestone = granted.length;
savedRules.milestoneAdvancement = true;
await api.setRank(veteranMiner, "mining", 5);
assert.deepEqual(granted.at(-1), { actor: "Veteran", points: 2, tree: "Gathering Tree" }, "Milestone promotion past the old best grants points");
assert.equal(granted.length, beforeMilestone + 1);
savedRules.milestoneAdvancement = false;

const switcher = makeActor(0);
switcher.selected = null;
await api.selectProfession(switcher, "fishing");
assert.equal(switcher.flags.effectiveRank.fishing, 1);
assert.equal(switcher.flags.treePoints.tree, 1);

// A higher points setting tops characters up by the difference.
await api.setSkillTreeConfig({ uuid: tree.uuid, pointsPerRank: 3, startingPoints: 1 });
assert.deepEqual(await api.syncActor(climber), { granted: 1 }, "Rank 2 at 1 + 3 = 4, had 3");
assert.equal(climber.flags.treePoints.tree, 4);
// A new tree: the first sync counts points already held or spent there.
const tree2 = { name: "Second Tree", id: "tree2", uuid: "JournalEntry.tree2", getFlag: (_m, key) => key === "isSkillTree" };
game.journal.push(tree2);
globalThis.fromUuidSync = uuid => uuid === tree.uuid ? tree : uuid === tree2.uuid ? tree2 : null;
game.modules.get("skill-tree").API.getSkillTreePoints = (target, skillTree) => ({ total: skillTree === tree2 && target === climber ? 3 : 0 });
await api.setSkillTreeConfig({ uuid: tree2.uuid, pointsPerRank: 3, startingPoints: 1 });
assert.deepEqual(await api.syncActor(climber), { granted: 1 }, "Owed 4, already 3 in the new tree");
assert.equal(climber.flags.treePoints.tree2, 4);
assert.deepEqual(await api.syncActor(climber), { granted: 0 });
delete game.modules.get("skill-tree").API.getSkillTreePoints;
await api.setSkillTreeConfig({ uuid: tree.uuid, pointsPerRank: 2, startingPoints: 1 });

// No tree linked, or module inactive: ranks still mirror, no points.
game.modules.set("skill-tree", { active: false, API: game.modules.get("skill-tree").API });
const quiet = makeActor(300);
const grantCount = granted.length;
assert.deepEqual(await api.syncActor(quiet), { granted: 0 });
assert.equal(quiet.flags.effectiveRank.mining, 3);
assert.equal(granted.length, grantCount);
game.modules.set("skill-tree", { active: true, API: game.modules.get("skill-tree").API });

// Perks: yield bonus on full successes only; rare-find chance rolls d100.
const rareGem = new Item("Star Sapphire", undefined, null);
const tables = {
  "RollTable.rareOre": { async roll() {
    return { results: [{ documentUuid: "Item.starSapphire" }, { name: "A glittering vein" }] };
  } }
};
globalThis.fromUuid = async uuid => uuid === "Item.starSapphire" ? rareGem : tables[uuid] ?? null;
function perkItem(name, perk) {
  return { name, system: {}, flags: { "gathering-professions": { perk } } };
}
const perkMiner = makeActor(0);
perkMiner.inventory.push(perkItem("Prospector's Eye", { enabled: true, profession: "mining", yieldBonus: 2, rareChance: 30 }));
perkMiner.inventory.push(perkItem("Lucky Charm", { enabled: true, profession: "any", yieldBonus: 0, rareChance: 15 }));
perkMiner.inventory.push(perkItem("Angler's Knot", { enabled: true, profession: "fishing", yieldBonus: 5, rareChance: 50 }));
perkMiner.inventory.push(perkItem("Disabled", { enabled: false, profession: "mining", yieldBonus: 9 }));
const minerPerks = api.actorPerks(perkMiner, "mining");
assert.deepEqual({ yieldBonus: minerPerks.yieldBonus, rareChance: minerPerks.rareChance, sources: minerPerks.sources,
  yieldSources: minerPerks.yieldSources, rareSources: minerPerks.rareSources }, { yieldBonus: 2, rareChance: 45, sources: ["Prospector's Eye", "Lucky Charm"],
  yieldSources: ["Prospector's Eye"], rareSources: ["Prospector's Eye", "Lucky Charm"] });
assert.equal(minerPerks.checkBonus, 0, "Old perks carry no new effects");

// Success: 3 + 2 perk; d100 = 40 ≤ 45 → rare draw.
queueGather(perkMiner, stone, 10, 3);
rolls.push({ formula: "1d100", total: 40 });
await sheet.toChat(gathererLast(), perkMiner);
const stack = name => perkMiner.inventory.find(item => item.name === name)?.system.quantity ?? 0;
assert.equal(stack("Stone"), 5);
assert.equal(stack("Star Sapphire"), 1);
assert.match(posted.at(-1).flavor, /Perk Bonus: \+2 \(Prospector&#39;s Eye\)/);
assert.match(posted.at(-1).flavor, /Rare Find!.*Rare roll 40 ≤ 45%/s);
assert.match(posted.at(-1).flavor, /A glittering vein/);

// Success, d100 miss: no rare draw.
queueGather(perkMiner, stone, 10, 1);
rolls.push({ formula: "1d100", total: 46 });
await sheet.toChat(gathererLast(), perkMiner);
assert.equal(stack("Stone"), 8);
assert.equal(stack("Star Sapphire"), 1);
assert.match(posted.at(-1).flavor, /Rare-find roll: 46 vs 45% — no rare find/);

// Partial: exactly 1, no perk yield, no d100.
queueGather(perkMiner, stone, 6);
await sheet.toChat(gathererLast(), perkMiner);
assert.equal(stack("Stone"), 9);
assert.doesNotMatch(posted.at(-1).flavor, /Perk Bonus|Rare/);

// Masterful with the setting on: rare draw without a d100 roll.
savedRules.masterfulRareFind = true;
const plain = makeActor(0);
queueGather(plain, stone, 20, 4, { maximize: true, allowInteractive: false });
await sheet.toChat(gathererLast(), plain);
assert.equal(plain.inventory.find(item => item.name === "Star Sapphire")?.system.quantity, 1);
assert.match(posted.at(-1).flavor, /Rare Find!.*Masterful extraction/s);
savedRules.masterfulRareFind = false;
queueGather(plain, stone, 20, 4, { maximize: true, allowInteractive: false });
await sheet.toChat(gathererLast(), plain);
assert.equal(plain.inventory.find(item => item.name === "Star Sapphire")?.system.quantity, 1, "Setting off: no Masterful rare draw");

// Material override beats the profession table; missing tables report but keep the award.
const brokenOre = new Item("Odd Ore", { profession: "mining", tier: 1, baseYield: "1", rareTable: "RollTable.missing" }, null);
assert.equal(materialRule(brokenOre).rareTable, "RollTable.missing");
assert.equal(materialRule(stone).rareTable, "RollTable.rareOre");
savedRules.masterfulRareFind = true;
const unlucky = makeActor(0);
queueGather(unlucky, brokenOre, 20, 1, { maximize: true, allowInteractive: false });
await sheet.toChat(gathererLast(), unlucky);
assert.equal(unlucky.inventory[0].system.quantity, 2);
assert.match(errors.pop(), /Rare-find table not found/);

// Perk editor saves through the API; "none" disables the perk.
const perkSource = new Item("Prospector's Eye", undefined, null);
dialogValues = { profession: "mining", yieldBonus: "1", rareChance: "10" };
assert.equal(await api.openPerkEditor(perkSource), true);
assert.deepEqual({ enabled: perkSource.material.enabled, profession: perkSource.material.profession, yieldBonus: perkSource.material.yieldBonus, rareChance: perkSource.material.rareChance, checkBonus: perkSource.material.checkBonus, seeOdds: perkSource.material.seeOdds },
  { enabled: true, profession: "mining", yieldBonus: 1, rareChance: 10, checkBonus: 0, seeOdds: false });
dialogValues = { profession: "any", checkDie: "4", seeOdds: true, scarcityRelief: "0.5" };
assert.equal(await api.openPerkEditor(perkSource), true);
assert.deepEqual([perkSource.material.checkDie, perkSource.material.seeOdds, perkSource.material.scarcityRelief, perkSource.material.yieldBonus], [4, true, 0.5, 0]);
dialogValues = { profession: "mining", yieldBonus: "0", rareChance: "0" };
assert.equal(await api.openPerkEditor(perkSource), false);
assert.match(errors.pop(), /at least one effect/);
dialogValues = { profession: "none", yieldBonus: "0", rareChance: "0" };
assert.equal(await api.openPerkEditor(perkSource), true);
assert.equal(perkSource.material.enabled, false);

// ---------------------------------------------------------------------------
// 0.6.0: node overrides (check, tool, DC, yield, rare) and gates.
// ---------------------------------------------------------------------------
savedRules.masterfulRareFind = false;
function nodePage(node) {
  return { type: "gatherer.gatherer", name: "Test Node", flags: { "gathering-professions": { node }, gatherer: { draws: "5" } } };
}
function nodeSheet(node) {
  const sheet = new GathererSheet();
  sheet.document = nodePage(node);
  return sheet;
}
function gatherOnNode(actor, item, sheetForNode, total, yieldResult, expectedFormula) {
  rolls.push({ formula: expectedFormula, total });
  if (yieldResult !== undefined) rolls.push({ formula: materialRule(item).baseYield, total: yieldResult, options: {} });
  const data = { actor, things: [{ item, quantity: 1 }] };
  gather(data);
  return sheetForNode.toChat(data.things, actor);
}
const nodeActor = () => {
  const actor = makeActor(0, "mining", 1);
  actor.system.abilities.dex = { mod: 3 };
  actor.system.attributes = { prof: 2 };
  actor.system.skills = { ath: { total: 6, ability: "str" }, sur: { total: 4, ability: "wis" } };
  return actor;
};
const plainStone = new Item("Stone", { profession: "mining", tier: 1, baseYield: "1d4" });

// Skill override: full skill bonus + profession die; node DC modifier raises the target.
let digger = nodeActor();
await gatherOnNode(digger, plainStone, nodeSheet({ profession: "mining", checkType: "skill", checkKey: "ath", dcModifier: 2 }), 12, 2, "1d20 + 6 + 1d4");
assert.equal(digger.inventory[0].system.quantity, 2, "12 vs DC 12 is a success");
assert.match(posted.at(-1).flavor, /ath Modifier: \+6/);
assert.match(posted.at(-1).flavor, /Node DC Modifier: \+2/);
assert.match(posted.at(-1).flavor, /Final DC: <strong>12<\/strong>/);

// Ability override + proficient tool adds proficiency bonus.
digger = nodeActor();
digger.inventory.push({ name: "Miner's Pick", system: { proficient: 1 } });
await gatherOnNode(digger, plainStone, nodeSheet({ checkType: "ability", checkKey: "dex", toolName: "miner's pick" }), 10, 3, "1d20 + 3 + 2 + 1d4");
assert.match(posted.at(-1).flavor, /Dexterity Modifier: \+3/);
assert.match(posted.at(-1).flavor, /Tool: Miner's Pick \+2 \(proficient\)|Tool: Miner&#39;s Pick \+2 \(proficient\)/);
// Not proficient: tool is only a gate.
digger = nodeActor();
digger.inventory.push({ name: "Miner's Pick", system: { proficient: 0 } });
await gatherOnNode(digger, plainStone, nodeSheet({ toolName: "Miner's Pick" }), 10, 3, "1d20 + 1 + 1d4");
assert.match(posted.at(-1).flavor, /not proficient/);
// A skill check never stacks the tool bonus.
digger = nodeActor();
digger.inventory.push({ name: "Miner's Pick", system: { proficient: 1 } });
await gatherOnNode(digger, plainStone, nodeSheet({ checkType: "skill", checkKey: "sur", toolName: "Miner's Pick" }), 10, 1, "1d20 + 4 + 1d4");

// Yield modifier on full successes only, never below 1.
digger = nodeActor();
await gatherOnNode(digger, plainStone, nodeSheet({ yieldModifier: 2 }), 11, 3, "1d20 + 1 + 1d4");
assert.equal(digger.inventory[0].system.quantity, 5);
assert.match(posted.at(-1).flavor, /Node Yield: \+2/);
await gatherOnNode(digger, plainStone, nodeSheet({ yieldModifier: -5 }), 11, 3, "1d20 + 1 + 1d4");
assert.equal(digger.inventory[0].system.quantity, 6, "Negative node yield floors at 1");
await gatherOnNode(digger, plainStone, nodeSheet({ yieldModifier: 3 }), 7, undefined, "1d20 + 1 + 1d4");
assert.equal(digger.inventory[0].system.quantity, 7, "Partial stays exactly 1");

// Node rare bonus and node rare table.
tables["RollTable.nodeRare"] = { async roll() { return { results: [{ name: "Ancient fossil" }] }; } };
digger = nodeActor();
rolls.push({ formula: "1d20 + 1 + 1d4", total: 10 }, { formula: "1d4", total: 1, options: {} }, { formula: "1d100", total: 30 });
{
  const data = { actor: digger, things: [{ item: plainStone, quantity: 1 }] };
  gather(data);
  await nodeSheet({ rareChance: 30, rareTable: "RollTable.nodeRare" }).toChat(data.things, digger);
}
assert.match(posted.at(-1).flavor, /Rare roll 30 ≤ 30%.*Ancient fossil/s);

// Gates run before Gatherer's pull: minimum rank and required tool.
globalThis.canvas = { tokens: { controlled: [] } };
const novice = nodeActor();
const gateSheet = nodeSheet({ profession: "mining", minRank: 2, toolName: "Miner's Pick" });
const warnings = [];
ui.notifications.warn = message => warnings.push(message);
const callsBefore = gatherCalls.length;
assert.equal(await gateSheet._onGather(true, null, novice), undefined);
assert.match(warnings.pop(), /Mining rank 2 required/);
novice.xp.mining = 100;
assert.equal(await gateSheet._onGather(true, null, novice), undefined);
assert.match(warnings.pop(), /You need Miner's Pick/);
novice.inventory.push({ name: "Miner's Pick", system: {} });
assert.equal(await gateSheet._onGather(true, null, novice), "gathered");
assert.equal(gatherCalls.length, callsBefore + 1, "Only the passing attempt reaches Gatherer");
assert.equal(await nodeSheet(undefined)._onGather(true, null, makeActor()), "gathered", "Pages without node settings are untouched");

// Gathering allowance is per character, across pages and professions. Each
// over-limit attempt requires confirmation and stacks dnd5e exhaustion.
{
  const previousUsers = game.users;
  game.users = [{ active: true, isGM: true }];
  savedRules.gatherAttemptsPerRest = 5;
  const gatherLimits = await import("../scripts/gather-limits.js");
  const originalRules = savedRules;
  const configured = { advancementMode: "automatic", masterfulRareFind: false, excellentRareBonus: 0,
    toolDurability: 10, gatherAttemptsPerRest: 3 };
  const active = activeRules();
  for (let index = 0; index < 5; index++) {
    configured[`dc${index}`] = active.tierDc[index];
    configured[`untrainedDc${index}`] = active.tierUntrainedDc[index];
    configured[`tierXp${index}`] = active.tierXp[index];
    configured[`reduction${index}`] = active.rankDcReduction[index];
    if (index) configured[`rankXp${index}`] = active.rankXp[index];
  }
  assert.equal(await saveRulesValues(configured), true);
  assert.equal(activeRules().gatherAttemptsPerRest, 3, "Rules editor saves the limit");
  savedRules = originalRules;
  const budgetActor = makeActor();
  budgetActor.system.attributes = { exhaustion: 1 };
  const otherActor = makeActor();
  otherActor.system.attributes = { exhaustion: 0 };
  const firstPage = nodeSheet(undefined);
  const secondPage = nodeSheet({ profession: "herbalism" });
  firstPage.table = {};
  secondPage.table = {};
  const blockedPage = nodeSheet({ profession: "mining", minRank: 5 });
  blockedPage.table = {};
  assert.equal(await blockedPage._onGather(true, null, budgetActor), undefined);
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 0, "Rank-gated action costs no attempt");
  const missingToolPage = nodeSheet(undefined);
  missingToolPage.table = {};
  missingToolPage.REQUIRE = ["A tool not carried"];
  await missingToolPage._onGather(true, null, budgetActor);
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 0, "Missing Gatherer requirement costs no attempt");
  const depletedPage = nodeSheet(undefined);
  depletedPage.table = {};
  depletedPage.hasDraws = true;
  depletedPage.MAX_DRAWS = 1;
  depletedPage.document.getFlag = () => ({ drawsUsed: 1 });
  await depletedPage._onGather(true, null, budgetActor);
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 0, "Depleted page costs no attempt");
  const saveFailure = makeActor();
  saveFailure.update = async () => { throw new Error("save failed"); };
  const callsBeforeFailure = gatherCalls.length;
  assert.equal(await firstPage._onGather(true, null, saveFailure), undefined);
  assert.equal(gatherCalls.length, callsBeforeFailure, "A failed counter save prevents gathering");
  assert.equal(gatherLimits.gatheringAllowance(saveFailure).used, 0);
  assert.match(errors.pop(), /save failed/);
  for (let index = 0; index < 5; index++) {
    const page = index % 2 ? secondPage : firstPage;
    assert.equal(await page._onGather(true, null, budgetActor), "gathered");
  }
  assert.deepEqual(gatherLimits.gatheringAllowance(budgetActor).remaining, 0);
  assert.equal(gatherLimits.gatheringAllowance(otherActor).remaining, 5, "Another character keeps their own allowance");
  await assert.rejects(saveRulesValues({ advancementMode: "automatic", gatherAttemptsPerRest: 101 }), /whole number from 0 to 100/);
  const beforeCancel = gatherCalls.length;
  assert.equal(await secondPage._onGather(true, null, budgetActor), undefined);
  assert.equal(gatherCalls.length, beforeCancel, "Cancel does not reach Gatherer");
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 5);
  assert.equal(budgetActor.system.attributes.exhaustion, 1);
  assert.match(confirmPrompts.at(-1).content, /exhaustion from <strong>1<\/strong> to <strong>2<\/strong>/);
  confirmAnswers.push(true, true);
  assert.equal(await firstPage._onGather(true, null, budgetActor), "gathered");
  assert.equal(await secondPage._onGather(true, null, budgetActor), "gathered");
  assert.deepEqual([gatherLimits.gatheringAllowance(budgetActor).used, budgetActor.system.attributes.exhaustion], [7, 3]);
  confirmAnswers.push(true, true);
  await Promise.all([firstPage._onGather(true, null, budgetActor), secondPage._onGather(true, null, budgetActor)]);
  assert.deepEqual([gatherLimits.gatheringAllowance(budgetActor).used, budgetActor.system.attributes.exhaustion], [9, 5],
    "Rapid attempts serialize their counter and exhaustion changes");
  const laggingEffectActor = makeActor();
  laggingEffectActor.system.attributes = { exhaustion: 2 };
  await laggingEffectActor.setFlag("gathering-professions", "gatherAttemptsUsed", 5);
  laggingEffectActor.update = async changes => {
    await laggingEffectActor.setFlag("gathering-professions", "gatherAttemptsUsed", changes["flags.gathering-professions.gatherAttemptsUsed"]);
    return laggingEffectActor; // dnd5e's derived exhaustion has not refreshed yet
  };
  confirmAnswers.push(true, true);
  assert.equal(await gatherLimits.reserveGatherAttempt(laggingEffectActor), true);
  assert.equal(gatherLimits.gatheringAllowance(laggingEffectActor).exhaustion, 3, "Pending dnd5e effect does not lose the new level");
  assert.equal(await gatherLimits.reserveGatherAttempt(laggingEffectActor), true);
  assert.equal(gatherLimits.gatheringAllowance(laggingEffectActor).exhaustion, 4, "Next confirmation stacks on the pending level");
  budgetActor.system.attributes.exhaustion = 6;
  assert.equal(await firstPage._onGather(true, null, budgetActor), undefined, "Maximum exhaustion blocks gathering");
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 9);
  budgetActor.system.attributes.exhaustion = 3;
  hooks.get("dnd5e.restCompleted")(budgetActor, { longRest: true });
  await delay(); await delay();
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 0, "Long rest restores free attempts");
  assert.equal(budgetActor.system.attributes.exhaustion, 3, "Module does not clear existing exhaustion");
  await budgetActor.setFlag("gathering-professions", "gatherAttemptsUsed", 5);
  const originalConfirm = foundry.applications.api.DialogV2.confirm;
  foundry.applications.api.DialogV2.confirm = async () => {
    await gatherLimits.resetGatherAttempts(budgetActor);
    return true;
  };
  assert.equal(await gatherLimits.reserveGatherAttempt(budgetActor), true);
  foundry.applications.api.DialogV2.confirm = originalConfirm;
  assert.deepEqual([gatherLimits.gatheringAllowance(budgetActor).used, budgetActor.system.attributes.exhaustion], [1, 3],
    "A rest during the prompt makes the attempt free rather than adding exhaustion");
  savedRules.gatherAttemptsPerRest = 0;
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).remaining, null, "Zero setting means unlimited");
  budgetActor.system.attributes.exhaustion = 6;
  assert.equal(await firstPage._onGather(true, null, budgetActor), "gathered", "Disabling the limit also disables its exhaustion gate");
  assert.equal(gatherLimits.gatheringAllowance(budgetActor).used, 1, "Unlimited mode does not spend another attempt");
  game.users = previousUsers;
}

// 0.7.0: every gather announces a summary for the gathering window.
{
  const reveal = nodeActor();
  const before = completions.length;
  await gatherOnNode(reveal, plainStone, nodeSheet({ yieldModifier: 1 }), 15, 2, "1d20 + 1 + 1d4");
  const summary = completions.at(-1);
  assert.equal(completions.length, before + 1);
  assert.equal(summary.actor, reveal);
  assert.equal(summary.page.name, "Test Node");
  const [entry] = summary.results;
  assert.equal(entry.type, "profession");
  assert.equal(entry.item.name, "Stone");
  assert.equal(entry.quantity, 4, "2 + 1 Excellent + 1 node");
  assert.equal(entry.degree.id, "excellent");
  assert.equal(entry.total, 15);
  assert.equal(entry.target, 10);
  assert.equal(entry.xp, 5);
  assert.equal(entry.die, 4);
  assert.deepEqual(entry.xpBar, { from: 0, to: 5, label: "5 / 100 XP to rank 2" });
  const plainData = { actor: reveal, things: [{ item: new Item("Unassigned Twig", undefined, null), quantity: 3 }] };
  gather(plainData);
  await new GathererSheet().toChat(plainData.things, reveal);
  assert.deepEqual(completions.at(-1).results, [{ type: "plain", item: { name: "Unassigned Twig", img: "stone.webp", uuid: undefined }, quantity: 3 }]);
}

// 0.8.0: condition DC modifiers and condition-emptied nodes.
{
  settingsStore.conditionOverrides = { season: "", weather: "blizzard", time: "night" };
  settingsStore.conditionDc = [{ type: "weather", value: "blizzard", profession: "", dc: 5 }];
  const cold = nodeActor();
  await gatherOnNode(cold, plainStone, nodeSheet({}), 15, 2, "1d20 + 1 + 1d4");
  assert.match(posted.at(-1).flavor, /Conditions: Blizzard \+5/);
  assert.match(posted.at(-1).flavor, /Final DC: <strong>15<\/strong>/);
  assert.equal(completions.at(-1).results[0].target, 15);
  const sunbloom = new Item("Sunbloom", { profession: "herbalism", tier: 1, conditions: [{ type: "time", value: "night", multiplier: 0 }] }, null);
  sunbloom.uuid = "Item.Sunbloom";
  globalThis.fromUuidSync = uuid => (uuid === sunbloom.uuid ? sunbloom : null);
  const nightSheet = nodeSheet(undefined);
  nightSheet.table = { replacement: true, results: [{ documentUuid: sunbloom.uuid, weight: 1 }] };
  const before = gatherCalls.length;
  assert.equal(await nightSheet._onGather(true, null, cold), undefined);
  assert.match(warnings.pop(), /Nothing can be gathered here right now \(Blizzard, Night\)/);
  assert.equal(gatherCalls.length, before, "No pull is used");
  settingsStore.conditionOverrides = { time: "day" };
  assert.equal(await nightSheet._onGather(true, null, cold), "gathered", "Daytime: unchanged weights pass through");
  settingsStore.conditionOverrides = {};
  settingsStore.conditionDc = [];
}

// 0.9.0: universal skill tree perks in the chat-card flow.
{
  const skilled = list => {
    const actor = nodeActor();
    actor.unsetFlag = async (_module, key) => { delete actor.flags[key]; };
    actor.inventory.push(...list.map(([name, perk]) => perkItem(name, { enabled: true, profession: "any", ...perk })));
    return actor;
  };
  const amount = (actor, name) => actor.inventory.find(entry => entry.name === name)?.system.quantity ?? 0;

  // Check bonus, DC reduction, and bonus die.
  let actor = skilled([["Proficient Gatherer", { checkBonus: 1 }], ["Practiced Technique", { dcReduction: 2 }], ["Expert Technique", { checkDie: 4 }]]);
  await gatherOnNode(actor, plainStone, nodeSheet({}), 8, 2, "1d20 + 1 + 1d4 + 1 + 1d4");
  assert.equal(amount(actor, "Stone"), 2, "8 vs DC 8 succeeds");
  assert.match(posted.at(-1).flavor, /Final DC: <strong>8<\/strong>/);
  assert.match(posted.at(-1).flavor, /DC reduction: −2 \(Practiced Technique\)/);
  assert.match(posted.at(-1).flavor, /Check bonus: \+1 \(Proficient Gatherer\)/);

  // Second Look: on a failure the player is asked; declining keeps the use.
  actor = skilled([["Second Look", { rerolls: 1 }]]);
  const promptsBefore = confirmPrompts.length;
  confirmAnswers.push(false);
  await gatherOnNode(actor, plainStone, nodeSheet({}), 3, undefined, "1d20 + 1 + 1d4");
  assert.equal(confirmPrompts.length, promptsBefore + 1, "Asked once");
  assert.match(confirmPrompts.at(-1).content, /gather failed: <strong>3<\/strong> against DC <strong>10<\/strong>/);
  assert.equal(completions.at(-1).results[0].degree.id, "failed", "Declined: the failure stands");
  assert.equal(actor.flags.rerollsUsed, undefined, "Declined: the use is kept");
  // A success never asks.
  await gatherOnNode(actor, plainStone, nodeSheet({}), 12, 1, "1d20 + 1 + 1d4");
  assert.equal(confirmPrompts.length, promptsBefore + 1);
  // Accepting rerolls and spends the use.
  confirmAnswers.push(true);
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 3 });
  await gatherOnNode(actor, plainStone, nodeSheet({}), 12, 1, "1d20 + 1 + 1d4");
  assert.equal(amount(actor, "Stone"), 2);
  assert.equal(actor.flags.rerollsUsed, 1);
  assert.match(posted.at(-1).flavor, /Rerolled a failed 3 \(Second Look\)/);
  assert.deepEqual(completions.at(-1).results[0].notes, ["Second Look: rerolled 3"]);
  const asked = confirmPrompts.length;
  await gatherOnNode(actor, plainStone, nodeSheet({}), 3, undefined, "1d20 + 1 + 1d4");
  assert.equal(completions.at(-1).results[0].degree.id, "failed", "No uses left: the failure stands");
  assert.equal(confirmPrompts.length, asked, "No uses left: not asked");
  hooks.get("dnd5e.restCompleted")(actor, { longRest: true });
  await delay(); await delay();
  assert.equal(actor.flags.rerollsUsed, undefined, "Long rest refreshes Second Look");

  // Grandmaster's Touch (0.13.0): chosen before gathering, once per long rest, an
  // automatic Masterful with no check roll; the rare find waits for the Fortune die.
  actor = skilled([["Grandmaster's Touch", { masterfulUses: 1 }]]);
  Object.assign(actor, { uuid: "Actor.grandmaster" });
  assert.equal(api.gather.masterfulLeft(actor), 1);
  api.gather.setIntent(actor, { masterful: true });
  rolls.push({ formula: "1d4", total: 4, options: { maximize: true, allowInteractive: false } });
  const touchData = { actor, things: [{ item: plainStone, quantity: 1 }] };
  gather(touchData);
  await nodeSheet({ dcModifier: 40 }).toChat(touchData.things, actor);
  assert.equal(amount(actor, "Stone"), 5, "Maximized 4 + Masterful 1, whatever the DC");
  const touchCard = posted.at(-1);
  assert.match(touchCard.content, /automatic Masterful extraction\. No check was rolled/);
  const summary = completions.at(-1).results[0];
  assert.deepEqual([summary.degree.id, summary.auto, summary.d20, summary.rare?.trigger, summary.rare?.pending, summary.rare?.tier],
    ["masterful", true, null, "Grandmaster's Touch", true, 1], "Guaranteed rare on the material tier, waiting for the Fortune die");
  assert.match(touchCard.content, /data-gp-climb="[^"]+" data-gp-actor="Actor.grandmaster"/);
  assert.equal(actor.flags.masterfulUsed, 1);
  assert.equal(api.gather.masterfulLeft(actor), 0);
  // The player's Fortune die: a 20 climbs from tier 1 to 2.
  rolls.push({ formula: "1d20", total: 20 });
  const climbed = await api.rareFinds.climb(actor, summary.rare.climbId);
  assert.deepEqual([climbed.tier, climbed.pending], [2, true]);
  rolls.push({ formula: "1d20", total: 5 });
  assert.equal((await api.rareFinds.climb(actor, summary.rare.climbId)).tier, 2);
  // No uses left: the choice is ignored and the check is rolled as normal.
  api.gather.setIntent(actor, { masterful: true });
  await gatherOnNode(actor, plainStone, nodeSheet({}), 12, 1, "1d20 + 1 + 1d4");
  assert.equal(completions.at(-1).results[0].auto, false);
  // Without a choice, nothing automatic happens; a long rest refreshes the use.
  hooks.get("dnd5e.restCompleted")(actor, { longRest: true });
  await delay(); await delay();
  assert.equal(api.gather.masterfulLeft(actor), 1);
  await gatherOnNode(actor, plainStone, nodeSheet({}), 12, 1, "1d20 + 1 + 1d4");
  assert.equal(completions.at(-1).results[0].auto, false, "Only when chosen");
  assert.equal(api.gather.masterfulLeft(actor), 1);

  // A custom perk can still make Partial count as Successful.
  actor = skilled([["Old Touch", { partialAsFull: true }]]);
  await gatherOnNode(actor, plainStone, nodeSheet({}), 7, 2, "1d20 + 1 + 1d4");
  assert.equal(amount(actor, "Stone"), 2);
  assert.equal(completions.at(-1).results[0].degree.id, "successful");
  assert.match(posted.at(-1).flavor, /Partial counted as Successful/);

  // Bountiful: an Excellent extraction draws one extra result from the node.
  const extraOre = new Item("Extra Ore", { profession: "mining", tier: 1, baseYield: "1d4" });
  extraOre.uuid = "Item.extraOre";
  const previousFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === extraOre.uuid ? extraOre : previousFromUuid(uuid);
  const bountySheet = nodeSheet({});
  bountySheet.table = { replacement: true, results: [{ documentUuid: extraOre.uuid, weight: 1 }] };
  actor = skilled([["Bountiful", { extraDraws: 1 }]]);
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 15 }, { formula: "1d4", total: 2, options: {} },
    { formula: "1d100", total: 40, options: { allowInteractive: false } }, { formula: "1d4", total: 3, options: {} });
  let data = { actor, things: [{ item: plainStone, quantity: 1 }] };
  gather(data);
  await bountySheet.toChat(data.things, actor);
  assert.equal(amount(actor, "Stone"), 3, "Excellent: 2 + 1");
  assert.equal(amount(actor, "Extra Ore"), 3);
  assert.equal(completions.at(-1).results.length, 2);
  assert.equal(completions.at(-1).results[1].extra, true);
  assert.match(posted.at(-1).flavor, /Extra draw: Extra Ore ×3 \(Bountiful\)/);
  globalThis.fromUuid = previousFromUuid;

  // Fortune: doubled chance, roll twice keep the better, extra rare draw.
  actor = skilled([["Keen Eye", { rareChance: 10 }], ["Treasure Hunter", { rareAdvantage: true }], ["Rich Find", { rareDraws: 1 }], ["Fortune's Favour", { rareDouble: true }]]);
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 10 }, { formula: "1d4", total: 2, options: {} }, { formula: "2d100kl", total: 15 });
  data = { actor, things: [{ item: plainStone, quantity: 1 }] };
  gather(data);
  await nodeSheet({}).toChat(data.things, actor);
  assert.equal(amount(actor, "Star Sapphire"), 2, "Rich Find draws twice");
  assert.match(posted.at(-1).flavor, /Rare roll 15 ≤ 20%/);

  // Assist: the next gather at the node gets the helper's bonus, then the offer is used up.
  const assistSheet = nodeSheet({});
  assistSheet.document.uuid = "JournalEntry.nodes.JournalEntryPage.assist";
  const helper = skilled([["Field Hand", { assistBonus: 2 }], ["Mentor", { assistDie: 4, assistUntrainedRelief: 0.5 }]]);
  Object.assign(helper, { id: "helper", name: "Helper" });
  helper.flags.assist = { pageUuid: assistSheet.document.uuid, at: 0 };
  game.actors.push(helper);
  actor = skilled([]);
  await gatherOnNode(actor, plainStone, assistSheet, 12, 2, "1d20 + 1 + 1d4 + 2 + 1d4");
  assert.match(posted.at(-1).flavor, /Assisted by Helper: \+2, \+1d4, half untrained penalty/);
  assert.deepEqual(completions.at(-1).results[0].notes, ["Assisted by Helper"]);
  await delay(); await delay();
  assert.equal(helper.flags.assist, undefined, "Assist used up");
  await gatherOnNode(actor, plainStone, assistSheet, 12, 2, "1d20 + 1 + 1d4");
  game.actors.splice(game.actors.indexOf(helper), 1);
}

// 0.10.0: tiered rare finds through the chat-card flow.
{
  const tierGem = new Item("Tier Two Gem", undefined, null);
  const crown = new Item("Crown Gem", undefined, null);
  tables["RollTable.tier2"] = { name: "Mining Rare Finds — Tier 2", async roll() { return { results: [{ documentUuid: "Item.tierTwo" }] }; } };
  tables["RollTable.tier5"] = { name: "Mining Rare Finds — Tier 5", async roll() { return { results: [{ documentUuid: "Item.crown" }] }; } };
  const previousFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === "Item.tierTwo" ? tierGem : uuid === "Item.crown" ? crown : previousFromUuid(uuid);
  await api.setProfessions(professionList.map(entry => entry.key === "mining"
    ? { ...entry, rareTables: ["RollTable.rareOre", "RollTable.tier2", "", "", "RollTable.tier5"] } : entry));
  savedRules.excellentRareBonus = 10;

  // A natural 20 is Masterful whatever the DC and moves the find to tier 2;
  // the owner then requests a Fortune die; it is never rolled automatically.
  const lucky = nodeActor();
  lucky.uuid = "Actor.lucky";
  lucky.unsetFlag = async (_module, key) => { foundry.utils.setProperty(lucky.flags, key, undefined); };
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 22, d20: 20 }, { formula: "1d4", total: 4, options: { maximize: true, allowInteractive: false } });
  let data = { actor: lucky, things: [{ item: plainStone, quantity: 1 }] };
  gather(data);
  await nodeSheet({ dcModifier: 30 }).toChat(data.things, lucky);
  let card = posted.at(-1).flavor;
  assert.match(card, /Masterful Extraction<\/strong> \(natural 20\)/, "Nat 20 beats DC 40");
  assert.match(card, /Rare Find!<\/strong> \(Natural 20\)/);
  assert.match(card, /Natural 20 on the check: tier 1 → 2/);
  assert.match(card, /data-gp-climb="([^"]+)" data-gp-actor="Actor.lucky"/, "Fortune die button for the player");
  assert.equal(lucky.inventory.find(entry => entry.name === "Tier Two Gem"), undefined, "Nothing drawn before the player rolls");
  const result = completions.at(-1).results[0];
  assert.deepEqual([result.rare.tier, result.rare.pending, result.degree.id], [2, true, "masterful"]);
  assert.ok(result.notes.includes("Natural 20: Masterful extraction"));
  const climbId = result.rare.climbId;
  assert.deepEqual(Object.keys(api.rareFinds.pending(lucky)), [climbId]);
  assert.equal(lucky.inventory.find(entry => entry.name === "Stone").system.quantity, 5, "Maximized 4 + Masterful 1");
  // A Fortune die of 6 stays at tier 2 and draws.
  const savedHTMLElement = globalThis.HTMLElement;
  const savedResolver = globalThis.fromUuidSync;
  globalThis.HTMLElement = class {};
  globalThis.fromUuidSync = uuid => uuid === lucky.uuid ? lucky : savedResolver?.(uuid);
  let clickFortune;
  const fortuneButton = { dataset: { gpActor: lucky.uuid, gpClimb: climbId }, addEventListener(_event, callback) { clickFortune = callback; } };
  hooks.get("renderChatMessageHTML")({}, [{ querySelectorAll: () => [fortuneButton] }]);
  assert.equal(fortuneButton.disabled, false, "The actual chat handler resolves the current gp datasets");
  rolls.push({ formula: "1d20", total: 6 });
  clickFortune({ preventDefault() {} });
  for (let wait = 0; wait < 100 && !lucky.inventory.some(entry => entry.name === "Tier Two Gem"); wait++) await delay();
  assert.equal(api.rareFinds.pending(lucky)[climbId], undefined, "Clicking the chat button settles its pending climb");
  globalThis.HTMLElement = savedHTMLElement;
  globalThis.fromUuidSync = savedResolver;
  assert.equal(lucky.inventory.find(entry => entry.name === "Tier Two Gem").system.quantity, 1);
  assert.match(posted.at(-1).flavor, /Rare Find!<\/strong> · Tier 2 \(Mining Rare Finds — Tier 2\)/);
  assert.match(posted.at(-1).flavor, /Fortune die 6: stays at tier 2 \(needs 20\+\)/);
  assert.deepEqual(api.rareFinds.pending(lucky), {}, "Pending climb cleared");
  assert.equal(await api.rareFinds.climb(lucky, climbId), null, "A rolled die cannot be rolled again");
  // A climb that keeps going asks for another roll.
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 22, d20: 20 }, { formula: "1d4", total: 4, options: { maximize: true, allowInteractive: false } });
  data = { actor: lucky, things: [{ item: plainStone, quantity: 1 }] };
  gather(data);
  await nodeSheet({}).toChat(data.things, lucky);
  const again = completions.at(-1).results[0].rare.climbId;
  rolls.push({ formula: "1d20", total: 20 });
  const [higher, duplicate] = await Promise.all([api.rareFinds.climb(lucky, again), api.rareFinds.climb(lucky, again)]);
  assert.equal(duplicate, null, "A simultaneous Fortune request cannot roll or award twice");
  assert.deepEqual([higher.tier, higher.pending], [3, true]);
  assert.match(posted.at(-1).flavor, /Fortune die — climbs!.*Fortune die 20: tier 2 → 3.*data-gp-climb/s);
  rolls.push({ formula: "1d20", total: 2 });
  assert.equal((await api.rareFinds.climb(lucky, again)).tier, 3);

  const lockedId = "failedAward";
  await lucky.setFlag("gathering-professions", `rareClimbs.${lockedId}`,
    { ...higher, pending: true, startTier: 2, tier: 2, startTable: "RollTable.tier2", steps: [], rareDraws: 1 });
  const awardedGem = lucky.inventory.find(entry => entry.name === "Tier Two Gem");
  const originalUpdate = awardedGem.update;
  let awardAttempts = 0;
  awardedGem.update = async function (patch) {
    if (++awardAttempts === 2) throw new Error("Simulated second award failure");
    return originalUpdate.call(this, patch);
  };
  rolls.push({ formula: "1d20", total: 4 });
  await assert.rejects(api.rareFinds.climb(lucky, lockedId), /locked for GM review/);
  assert.equal(lucky.getFlag("gathering-professions", `rareClimbs.${lockedId}`).settling, true);
  assert.equal(await api.rareFinds.climb(lucky, lockedId), null, "A partial award cannot be retried automatically");
  assert.equal(awardAttempts, 2, "The first item was not awarded twice");
  awardedGem.update = originalUpdate;

  await lucky.setFlag("gathering-professions", "rareClimbs.remote",
    { ...higher, pending: true, startTier: 2, tier: 2, startTable: "RollTable.tier2", steps: [], rareDraws: 0 });
  const savedUser = game.user;
  const savedUsers = game.users;
  const savedSetFlag = lucky.setFlag;
  lucky.testUserPermission = (user, level) => user.id === "player1" && level === "OWNER";
  game.users = { activeGM: { id: "gm" }, get: id => ({ gm: { id: "gm", isGM: true }, player1: { id: "player1", isGM: false } })[id] };
  lucky.setFlag = async function (scope, key, value) {
    await savedSetFlag.call(this, scope, key, value);
    if (key !== "climbRequest") return;
    game.user = { id: "gm", isGM: true };
    hooks.get("updateActor")(this, { flags: { "gathering-professions": { climbRequest: value } } }, {}, "player1");
    game.user = { id: "player1", isGM: false };
  };
  game.user = { id: "player1", isGM: false };
  rolls.push({ formula: "1d20", total: 4 });
  const remoteResult = await api.rareFinds.climb(lucky, "remote");
  assert.deepEqual({ tier: remoteResult.tier, pending: remoteResult.pending }, { tier: 2, pending: false }, "Owner request resolves through the active GM");
  assert.ok("tableUuid" in remoteResult && Array.isArray(remoteResult.itemUuids), "The answer carries the find for Appraiser's Eye");
  assert.equal(lucky.getFlag("gathering-professions", "rareClimbs.remote"), undefined);
  lucky.setFlag = savedSetFlag;
  game.user = savedUser;
  game.users = savedUsers;

  // Tier 5 material + nat 20: no roll needed; tier 5 find plus a story discovery whispered to the GM.
  const crownOre = new Item("Crown Ore", { profession: "mining", tier: 5, baseYield: "1" });
  const finder = nodeActor();
  const before = posted.length;
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 22, d20: 20 }, { formula: "1", total: 1, options: { maximize: true, allowInteractive: false } });
  data = { actor: finder, things: [{ item: crownOre, quantity: 1 }] };
  gather(data);
  await nodeSheet({}).toChat(data.things, finder);
  const story = posted.slice(before).find(message => message.flags?.["gathering-professions"]?.storyFind);
  assert.ok(story, "GM story whisper posted");
  assert.match(story.content, /climbed past the tier 5 rare table while gathering Crown Ore/);
  assert.match(posted.at(-1).flavor, /Something more lies hidden here/);
  assert.equal(finder.inventory.find(entry => entry.name === "Crown Gem").system.quantity, 1);
  assert.equal(completions.at(-1).results[0].rare.story, true);

  // Excellent extraction: the GM bonus is the trained gatherer's whole chance here.
  const sharp = nodeActor();
  rolls.push({ formula: "1d20 + 1 + 1d4", total: 16 }, { formula: "1d4", total: 2, options: {} }, { formula: "1d100", total: 10 });
  data = { actor: sharp, things: [{ item: plainStone, quantity: 1 }] };
  gather(data);
  await nodeSheet({}).toChat(data.things, sharp);
  assert.match(posted.at(-1).flavor, /Rare roll 10 ≤ 10%, Excellent \+10%\) · Tier 1/);

  globalThis.fromUuid = previousFromUuid;
  savedRules.excellentRareBonus = 0;
  await api.setProfessions(professionList);
}

// 0.12.0: tool durability — natural 1s with a node's tool cost 1 durability.
{
  const makeTool = (name, durability) => ({ name, system: { proficient: 1 }, flags: { "gathering-professions": durability ? { durability } : {} },
    getFlag(_module, key) { return this.flags["gathering-professions"][key]; },
    async setFlag(_module, key, value) { this.flags["gathering-professions"][key] = { ...(this.flags["gathering-professions"][key] ?? {}), ...value }; } });
  const durability = await import("../scripts/durability.js");
  const nodesLib = await import("../scripts/nodes.js");
  savedRules.toolDurability = 2;
  const pick = makeTool("Miner's Pick");
  assert.deepEqual(durability.toolDurability(pick), { value: 2, max: 2, unbreakable: false, broken: false }, "World default maximum, full when unset");
  const miner = nodeActor();
  miner.inventory.push(pick);
  const pickNode = { toolName: "Miner's Pick" };
  // d20 of 1 (total 2): failed, and the pick loses 1.
  await gatherOnNode(miner, plainStone, nodeSheet(pickNode), 2, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(pick.flags["gathering-professions"].durability.value, 1);
  assert.match(posted.at(-1).flavor, /Natural 1!<\/strong> Miner(?:'|&#39;)s Pick loses 1 durability \(1\/2\)/);
  assert.ok(completions.at(-1).results[0].notes.includes("Natural 1: Miner's Pick 1/2"));
  // A low roll that is not a natural 1 costs nothing.
  await gatherOnNode(miner, plainStone, nodeSheet(pickNode), 3, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(pick.flags["gathering-professions"].durability.value, 1);
  assert.match(posted.at(-1).flavor, /Tool: Miner(?:'|&#39;)s Pick \+2 \(proficient\) · durability 1\/2/);
  // The next natural 1 breaks it; a broken tool no longer meets the node's tool gate.
  await gatherOnNode(miner, plainStone, nodeSheet(pickNode), 2, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(durability.isBroken(pick), true);
  assert.match(posted.at(-1).flavor, /Miner(?:'|&#39;)s Pick breaks!/);
  const gate = nodesLib.nodeGate(miner, pickNode);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /Miner's Pick is broken/);
  assert.equal(nodesLib.bestTool(miner, pickNode), null);
  // A spare unbroken pick is used instead.
  const spare = makeTool("Miner's Pick", { value: 5, max: 5 });
  miner.inventory.push(spare);
  assert.equal(nodesLib.bestTool(miner, pickNode).item, spare);
  // Second Look: both natural 1s (the roll and its reroll) wear the tool.
  const careful = nodeActor();
  careful.unsetFlag = async () => {};
  const rope = makeTool("Miner's Pick", { value: 5, max: 5 });
  careful.inventory.push(rope, perkItem("Second Look", { enabled: true, profession: "any", rerolls: 1 }));
  confirmAnswers.push(true);
  rolls.push({ formula: "1d20 + 1 + 2 + 1d4", total: 2 });
  await gatherOnNode(careful, plainStone, nodeSheet(pickNode), 2, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(rope.flags["gathering-professions"].durability.value, 3);
  assert.match(posted.at(-1).flavor, /loses 2 durability \(3\/5\)/);
  // Maximum 0 never wears; no tool means nothing to wear.
  const everlasting = makeTool("Miner's Pick", { max: 0 });
  const steady = nodeActor();
  steady.inventory.push(everlasting);
  await gatherOnNode(steady, plainStone, nodeSheet(pickNode), 2, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(everlasting.flags["gathering-professions"].durability.value, undefined);
  assert.doesNotMatch(posted.at(-1).flavor, /Natural 1!/);
  // GM editor validation and repair.
  assert.throws(() => durability.normalizeDurability({ value: 9, max: 5 }), /above the maximum/);
  assert.throws(() => durability.normalizeDurability({ max: -1 }), /Maximum durability/);
  await api.durability.repair(pick);
  assert.deepEqual(durability.toolDurability(pick), { value: 2, max: 2, unbreakable: false, broken: false }, "Repaired to full");
  savedRules.toolDurability = 10;
}

// A stale refund snapshot must not roll back someone else's pull, and a ticket
// can only be claimed once. Exercise the actual authenticated GM handler.
{
  const refundActor = nodeActor();
  refundActor.uuid = "Actor.refundReview";
  refundActor.inventory.push(new Item("Conservationist", { enabled: true, profession: "any", conserveChance: 100 }, null));
  refundActor.unsetFlag = async (_scope, key) => {
    const parts = key.split("."); const leaf = parts.pop();
    const parent = parts.reduce((value, part) => value?.[part], refundActor.flags);
    if (parent) delete parent[leaf];
  };
  const refundPage = { uuid: "JournalEntry.review.JournalEntryPage.refund", type: "gatherer.gatherer",
    flags: { gatherer: { draws: "5", data: { drawsUsed: 3 } } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async update(changes) { this.flags.gatherer.data.drawsUsed = changes["flags.gatherer.data.drawsUsed"]; } };
  const previousResolver = globalThis.fromUuid;
  const previousUser = game.user;
  const previousUsers = game.users;
  globalThis.fromUuid = async uuid => uuid === refundPage.uuid ? refundPage : uuid === refundActor.uuid ? refundActor : previousResolver(uuid);
  game.user = { id: "gm", isGM: true };
  game.users = [{ id: "gm", isGM: true }];
  await refundActor.setFlag("gathering-professions", "gatherTickets.reviewRefund", { pageUuid: refundPage.uuid, expires: Date.now() + 120000 });
  const request = { actorUuid: refundActor.uuid, pageUuid: refundPage.uuid, ticket: "reviewRefund", before: 1 };
  rolls.push({ formula: "1d100", total: 1, options: { allowInteractive: false } });
  hooks.get("updateActor")(refundActor, { flags: { "gathering-professions": { refundRequest: request } } }, {}, "gm");
  for (let wait = 0; wait < 100 && refundPage.flags.gatherer.data.drawsUsed !== 2; wait++) await delay();
  assert.equal(refundPage.flags.gatherer.data.drawsUsed, 2, "Refund removes only its own pull, not all pulls since the snapshot");
  hooks.get("updateActor")(refundActor, { flags: { "gathering-professions": { refundRequest: request } } }, {}, "gm");
  await delay(); await delay();
  assert.equal(refundPage.flags.gatherer.data.drawsUsed, 2, "Replaying a claimed ticket cannot refund again");
  globalThis.fromUuid = previousResolver; game.user = previousUser; game.users = previousUsers;
}

// 0.31.0 skill tree expansion in the real gather flow.
{
  const limitsLib = await import("../scripts/gather-limits.js");
  const effects = await import("../scripts/skill-effects.js");
  // Momentum: an Excellent gather adds +1 to the next check, which spends it.
  const swift = makeActor();
  swift.inventory.push(perkItem("Momentum", { enabled: true, profession: "any", momentumBonus: 1 }));
  queueGather(swift, stone, 15, 3);
  await sheet.toChat(gathererLast(), swift);
  assert.equal(swift.flags.momentum?.bonus, 1, "Excellent gather stores Momentum");
  const stoneRule = materialRule(stone);
  const swiftBase = checkFormula(swift, "mining", swift.xp.mining ?? 0, stoneRule.dc, stoneRule).formula;
  rolls.push({ formula: `${swiftBase} + 1`, total: 12 }, { formula: stoneRule.baseYield, total: 2, options: {} });
  const swiftData = { actor: swift, things: [{ item: stone, quantity: 1 }] };
  gather(swiftData);
  await sheet.toChat(swiftData.things, swift);
  assert.equal(swift.flags.momentum, undefined, "Momentum is spent on the next check");
  assert.match(posted.at(-1).flavor, /Momentum: \+1/);
  assert.ok(completions.at(-1).results[0].notes.includes("Momentum +1"));

  // Tool Steward: the first natural 1 each long rest leaves the tool alone.
  const makeTool = (name, durability) => ({ name, system: { proficient: 1 }, flags: { "gathering-professions": durability ? { durability } : {} },
    getFlag(_module, key) { return this.flags["gathering-professions"][key]; },
    async setFlag(_module, key, value) { this.flags["gathering-professions"][key] = { ...(this.flags["gathering-professions"][key] ?? {}), ...value }; } });
  const keeper = nodeActor();
  const keeperPick = makeTool("Miner's Pick", { value: 4, max: 4 });
  keeper.inventory.push(keeperPick, perkItem("Tool Steward", { enabled: true, profession: "any", toolSteward: 1 }));
  const pickNode = { toolName: "Miner's Pick" };
  await gatherOnNode(keeper, plainStone, nodeSheet(pickNode), 2, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(keeperPick.flags["gathering-professions"].durability.value, 4, "Tool Steward saves the first natural 1");
  assert.equal(keeper.flags.restUses?.toolSteward, 1);
  assert.match(posted.at(-1).flavor, /did not wear the tool/);
  await gatherOnNode(keeper, plainStone, nodeSheet(pickNode), 2, undefined, "1d20 + 1 + 2 + 1d4");
  assert.equal(keeperPick.flags["gathering-professions"].durability.value, 3, "The next natural 1 wears it");

  // Field Repair: 1d4 back on a worn tool, once per long rest.
  keeper.inventory.push(perkItem("Field Repair", { enabled: true, profession: "any", fieldRepairs: 1 }));
  keeperPick.parent = keeper;
  rolls.push({ formula: "1d4", total: 3 });
  assert.deepEqual(await effects.fieldRepair(keeper, keeperPick), { before: 3, after: 4, max: 4 }, "Capped at the maximum");
  keeperPick.flags["gathering-professions"].durability.value = 1;
  await assert.rejects(effects.fieldRepair(keeper, keeperPick), /no Field Repair left/);

  // Deep Reserves adds a free attempt; Second Wind makes one extra attempt exhaustion-free.
  const previousUsers = game.users;
  game.users = [{ active: true, isGM: true }];
  savedRules.gatherAttemptsPerRest = 2;
  const reserve = makeActor();
  reserve.system.attributes = { exhaustion: 0 };
  reserve.inventory.push(perkItem("Deep Reserves", { enabled: true, profession: "any", extraAttempts: 1 }),
    perkItem("Second Wind", { enabled: true, profession: "any", secondWind: 1 }));
  assert.equal(limitsLib.gatheringAllowance(reserve).limit, 3, "Deep Reserves: +1 free attempt");
  await reserve.setFlag("gathering-professions", "gatherAttemptsUsed", 3);
  confirmAnswers.push(true);
  assert.equal(await limitsLib.reserveGatherAttempt(reserve), true);
  assert.match(confirmPrompts.at(-1).window.title, /Second Wind/);
  assert.deepEqual([limitsLib.gatheringAllowance(reserve).used, reserve.system.attributes.exhaustion, limitsLib.gatheringAllowance(reserve).secondWind], [4, 0, 0],
    "Second Wind: no exhaustion, use spent");
  confirmAnswers.push(true);
  assert.equal(await limitsLib.reserveGatherAttempt(reserve), true);
  assert.equal(reserve.system.attributes.exhaustion, 1, "Without Second Wind the next attempt adds exhaustion");
  savedRules.gatherAttemptsPerRest = 0;
  game.users = previousUsers;

  // Familiar Ground: the owner chooses once; the GM may change it.
  const local = makeActor();
  local.inventory.push(perkItem("Familiar Ground", { enabled: true, profession: "any", familiarDc: 2 }));
  local.unsetFlag = async (_scope, key) => { delete local.flags[key]; };
  const previousUser = game.user;
  game.user = { id: "player1", isGM: false };
  await effects.setFamiliarBiome(local, "forest");
  assert.equal(local.flags.familiarBiome, "forest");
  await assert.rejects(effects.setFamiliarBiome(local, "swamp"), /Only the GM/);
  await assert.rejects(effects.setFamiliarBiome(makeActor(), "forest"), /does not have Familiar Ground/);
  game.user = { id: "gm", isGM: true };
  await effects.setFamiliarBiome(local, "swamp");
  assert.equal(local.flags.familiarBiome, "swamp");
  await assert.rejects(effects.setFamiliarBiome(local, "moon"), /biome from the list/);
  game.user = previousUser;

  // GM requests: Last Pull reopens one pull for the asker; Timekeeper marks an exhausted node.
  const nodesLib = await import("../scripts/nodes.js");
  const node = { uuid: "JournalEntry.skills.JournalEntryPage.node", type: "gatherer.gatherer", name: "Old Vein",
    flags: { gatherer: { draws: "2", time: "8", table: "RollTable.skillNode", data: { drawsUsed: 2, firstDrawTime: 0 } }, "gathering-professions": {} },
    getFlag(scope, key) { return foundry.utils.getProperty(this.flags[scope] ?? {}, key); },
    async setFlag(scope, key, value) { foundry.utils.setProperty(this.flags[scope] ??= {}, key, value); },
    testUserPermission: () => true,
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split("."); const leaf = parts.at(-1);
        if (leaf.startsWith("-=")) delete foundry.utils.getProperty(this, parts.slice(0, -1).join("."))?.[leaf.slice(2)];
        else if (value && typeof value === "object" && !Array.isArray(value)) foundry.utils.setProperty(this, path, { ...(foundry.utils.getProperty(this, path) ?? {}), ...value });
        else foundry.utils.setProperty(this, path, value);
      }
    } };
  const finder = nodeActor();
  finder.uuid = "Actor.finder";
  finder.testUserPermission = () => true;
  finder.inventory.push(perkItem("Last Pull", { enabled: true, profession: "any", lastPulls: 1 }), perkItem("Timekeeper", { enabled: true, profession: "any", refillCut: 25 }));
  const previousResolver = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === node.uuid ? node : uuid === "RollTable.skillNode" ? { results: [{ documentUuid: plainStone.uuid }] } : uuid === finder.uuid ? finder : previousResolver(uuid);
  const gmUser = { id: "gm", isGM: true };
  await effects.handleGmRequest(finder, { type: "lastPull", data: { pageUuid: node.uuid } }, gmUser);
  assert.equal(node.flags.gatherer.data.drawsUsed, 1, "Last Pull reopens one pull");
  assert.equal(nodesLib.lastPullHolder(node), finder.uuid, "Reserved for the asker");
  assert.equal(finder.flags.restUses?.lastPulls, 1);
  await assert.rejects(effects.handleGmRequest(finder, { type: "lastPull", data: { pageUuid: node.uuid } }, gmUser), /no Last Pull left/);
  node.flags.gatherer.data.drawsUsed = 2;
  assert.deepEqual(await effects.handleGmRequest(finder, { type: "refillCut", data: { pageUuid: node.uuid } }, gmUser), { cut: 25 });
  assert.equal(nodesLib.nodeUsage(node).time, 6, "Timekeeper: 8 h becomes 6 h");
  await nodesLib.resetNodes([node]);
  assert.deepEqual([node.flags.gatherer.data.drawsUsed, node.flags["gathering-professions"].refillCut, nodesLib.lastPullHolder(node)], [0, undefined, ""], "A refill clears Timekeeper and Last Pull");

  // Shared Haul: the GM gives the helper the material when the gatherer cannot.
  const helper = makeActor();
  helper.uuid = "Actor.helper"; helper.id = "helper"; helper.isOwner = false;
  helper.inventory.push(perkItem("Shared Haul", { enabled: true, profession: "any", sharedHaul: 1 }));
  globalThis.fromUuid = async uuid => uuid === helper.uuid ? helper : uuid === plainStone.uuid ? plainStone : uuid === node.uuid ? node : uuid === "RollTable.skillNode" ? { results: [{ documentUuid: plainStone.uuid }] } : previousResolver(uuid);
  plainStone.uuid ??= "Item.plainStone";
  await effects.handleGmRequest(finder, { type: "sharedHaul", data: { helperUuid: helper.uuid, itemUuid: plainStone.uuid, pageUuid: node.uuid, profession: "mining" } }, gmUser);
  assert.equal(helper.inventory.find(item => item.name === "Stone")?.system.quantity, 1, "Helper gets 1 Stone");
  await assert.rejects(effects.handleGmRequest(finder, { type: "sharedHaul", data: { helperUuid: helper.uuid, itemUuid: "Item.elsewhere", pageUuid: node.uuid } }, gmUser), /unknown helper or material/);
  globalThis.fromUuid = previousResolver;
}

assert.deepEqual(errors, [], "No hidden integration errors");
assert.equal(rolls.length, 0, "All expected dice rolls were awaited");
console.log("PASS: yields, extraction degrees, banked XP, stacking, editor saves, milestones, single-profession selection, ownership, GM changes, untrained penalties, sidebar routing, custom professions, Skill Tree points, perks, rare finds, node overrides and gates, condition DC and empty nodes, universal skill perks, tool durability, and gathering limits.");
