// Audit fixes: prices, cyclic recipes, stale skill purchases, state races and
// exhaustion bridges. All documents are in-memory doubles; no world writes.
import assert from "node:assert/strict";
const GP = "gathering-professions", CP = "crafting-professions";
const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
const set = (o, p, v) => {
  const keys = p.split("."), last = keys.pop();
  keys.reduce((v, k) => v[k] ??= {}, o)[last] = structuredClone(v);
};
globalThis.foundry = { utils: { getProperty: get, setProperty: set, randomID: () => "request1", escapeHTML: String } };
const values = new Map();
globalThis.game = { user: { id: "gm", isGM: true }, users: [], actors: [], items: [], modules: new Map(),
  settings: { get: (m, k) => values.get(`${m}.${k}`), set: async (m, k, v) => values.set(`${m}.${k}`, v) } };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
class Actor {
  constructor(id) { this.id = id; this.uuid = `Actor.${id}`; this.name = id; this.type = "character"; this.documentName = "Actor";
    this.isOwner = true; this.flags = {}; this.items = []; this.system = { attributes: { exhaustion: 0 } }; }
  getFlag(m, k) { return get(this.flags[m], k); }
  async setFlag(m, k, v) { await new Promise(r => setTimeout(r, 2)); set(this.flags, `${m}.${k}`, v); return this; }
  async update(changes) { await new Promise(r => setTimeout(r, 2)); for (const [k, v] of Object.entries(changes)) set(this, k, v); return this; }
}
const pricing = await import("../scripts/pricing.js");
const perks = await import("../../crafting-professions/scripts/perks.js");
const make = data => ({ data, updateSource(changes) { for (const [k, v] of Object.entries(changes)) set(data, k, v); } });
const base = { name: "Dagger", type: "weapon", system: { price: { value: 1.3, denomination: "gp" } }, flags: { [GP]: { campaignPrice: { approved: 1.3 } } } };
for (const kind of ["masterwork", "ornate", "both"]) {
  const item = make(structuredClone(base));
  if (kind !== "ornate") perks.applyMasterwork(item.data, 2);
  if (kind !== "masterwork") perks.applyPerk(item.data, { name: "Ornate", description: "Double value.", effects: { value: 2 } });
  const before = structuredClone(item.data.system.price);
  pricing.priceOnCreate(item, item.data);
  assert.deepEqual(item.data.system.price, before, `${kind} premium survives creation`);
  assert.equal(pricing.itemPriceProfile(item.data).name, "Dagger");
  assert.equal(pricing.itemPriceProfile(item.data).multiplier, kind === "both" ? 4 : 2);
}
assert.throws(() => pricing.recipeCosts([{ output: "A", quantity: 1, inputs: [["B", 1]] },
  { output: "B", quantity: 1, inputs: [["A", 1]] }], new Map([["A", 1], ["B", 1]])), /Recipe cycle/);
const world = { ...structuredClone(base), id: "dagger", getFlag(m, k) { return get(this.flags[m], k); } };
world.system.price.value = 2;
world.flags[GP].campaignPrice.approved = 2;
game.items = [world];
const plain = make(structuredClone(base));
pricing.priceOnCreate(plain, plain.data);
assert.equal(plain.data.system.price.value, 2, "Current recipe floor wins over stale base approval");
const owner = new Actor("prices");
owner.items = [{ name: "Masterwork Dagger", system: { price: { value: 2, denomination: "gp" } }, flags: { [CP]: { masterwork: true }, [GP]: { campaignPrice: { approved: 1 } } },
  getFlag(m, k) { return get(this.flags[m], k); } }];
game.actors = [owner];
const { repriceWorld } = await import("../scripts/repricing.js");
const plan = await repriceWorld({ dryRun: true });
assert.equal(plan.actors.find(row => row.name === "prices: Masterwork Dagger").to, 4, "Inventory retry works after world price already changed");
const state = await import("../../crafting-professions/scripts/state.js");
const scholar = new Actor("scholar");
await Promise.all([state.learn(scholar, ["recipe-a"]), state.learn(scholar, ["recipe-b"])]);
assert.deepEqual(scholar.getFlag(CP, "known"), ["recipe-a", "recipe-b"]);
const { CRAFTING_PROFESSIONS } = await import("../../crafting-professions/scripts/professions.js");
await scholar.setFlag(CP, "professions.blacksmith", { rank: 2, xp: 100, talents: [] });
const talents = CRAFTING_PROFESSIONS.blacksmith.talents.slice(0, 2).map(row => row.id);
await Promise.all(talents.map(id => state.chooseTalent(scholar, "blacksmith", id)));
assert.deepEqual(state.talentsOf(scholar, "blacksmith"), talents);
const beginner = new Actor("beginner");
const setFlag = beginner.setFlag.bind(beginner);
beginner.unsetFlag = async (m, k) => { const keys = k.split("."), last = keys.pop(); delete keys.reduce((v, key) => v?.[key], beginner.flags[m])[last]; };
beginner.setFlag = async (m, k, value) => {
  if (m === GP && k === "actionRequest") {
    if (value.operation === "release") delete beginner.flags[GP].actionLease;
    else set(beginner.flags, `${GP}.actionLease`, { id: value.id, user: "player", expires: Date.now() + 120000 });
    return beginner;
  }
  return setFlag(m, k, value);
};
game.users.activeGM = { id: "gm", isGM: true };
game.user = { id: "player", isGM: false };
const selections = await Promise.allSettled([state.chooseProfession(beginner, "blacksmith"), state.chooseProfession(beginner, "cook")]);
assert.equal(selections.filter(row => row.status === "fulfilled").length, 1, "Concurrent player selection grants only one profession");
assert.equal(Object.keys(state.actorProfessions(beginner)).length, 1);
delete game.users.activeGM;
game.user = { id: "gm", isGM: true };

// Cached dependency models must be rebuilt inside the action before spending.
const tree = { id: "tree", uuid: "JournalEntry.tree", pages: [], getFlag(m, k) { return k === "independentSkillPoints"; } };
tree.pages = ["a", "b"].map(id => ({ id, uuid: `${tree.uuid}.JournalEntryPage.${id}`, parent: tree }));
values.set(`${GP}.skillTree`, { uuid: tree.uuid });
globalThis.fromUuidSync = uuid => uuid === tree.uuid ? tree : null;
class Skill {
  constructor(page, actor, all) { this.skill = page; this.skillTree = tree; this.actor = actor; this.allSkills = all;
    this.actorSkills = structuredClone(actor.getFlag("skill-tree", "skills") ?? []);
    this.skillData = { connectedSkills: [], allowIncompleteProgression: 0 }; }
  get points() { return { value: this.actorSkills.find(row => row.uuid === this.skill.uuid)?.points ?? 0, max: 1 }; }
  get isUnlocked() { return this.points.value === 1; }
  async computeCanBeUnlocked() { this.canBeUnlocked = ![...this.allSkills.values()].some(row => row !== this && row.isUnlocked); }
  playSound() {} async updateItems() {} async executeUnlockScript() {}
}
const { purchaseSkill } = await import("../scripts/skill-purchases.js");
const pupil = new Actor("pupil");
await pupil.setFlag("skill-tree", "skillTreeSkillPoints.tree", 2);
const cached = tree.pages.map(page => new Skill(page, pupil, new Map()));
assert.equal(await purchaseSkill(cached[0], 1), true);
assert.equal(await purchaseSkill(cached[1], 1), false, "Stale mutually exclusive purchase refused");
assert.equal(pupil.getFlag("skill-tree", "skillTreeSkillPoints.tree"), 1);
assert.equal(pupil.getFlag("skill-tree", "skills").length, 1);

const limits = await import("../scripts/gather-limits.js");
values.set(`${GP}.rules`, { gatherAttemptsPerRest: 5 });
globalThis.CONFIG = { DND5E: { conditionTypes: { exhaustion: { levels: 6 } } } };
globalThis.foundry.applications = { api: { DialogV2: { confirm: async () => true } } };
const gatherer = new Actor("gatherer");
await gatherer.setFlag(GP, "gatherAttemptsUsed", 5);
assert.equal(await limits.reserveGatherAttempt(gatherer), true);
gatherer.system.attributes.exhaustion = 0;
const realNow = Date.now;
try { Date.now = () => realNow() + 6000;
  assert.equal(limits.gatheringAllowance(gatherer).exhaustion, 0, "Pending exhaustion expires");
} finally { Date.now = realNow; }
gatherer.system.attributes.exhaustion = 6;
gatherer.items = [{ flags: { [GP]: { perk: { enabled: true, profession: "any", secondWind: 1 } } }, getFlag(m, k) { return get(this.flags[m], k); } }];
assert.ok(limits.gatheringAllowance(gatherer).secondWind > 0);
assert.equal(await limits.reserveGatherAttempt(gatherer), false, "Maximum exhaustion blocks gathering");
console.log("PASS: audit core — quality premiums, repricing recovery, recipe cycles, state concurrency, stale tree purchases and exhaustion expiry.");
