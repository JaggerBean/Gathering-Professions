// Universal skill tree: perk effects, check math, assist, sensing, tree layout.
// In-memory doubles only; no world data is touched.
import assert from "node:assert/strict";

const settings = {};
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((v, k) => v?.[k], o) }, applications: { api: { ApplicationV2: class {} } } };
globalThis.game = {
  settings: { get(_namespace, key) { return settings[key]; }, async set(_namespace, key, value) { settings[key] = value; }, register() {}, registerMenu() {} },
  modules: new Map([["eryndor-professions", { api: {} }]]),
  actors: [], users: [], time: { worldTime: 10000 }, user: { isGM: true }
};

const perks = await import("../scripts/perks.js");
const tree = await import("../scripts/skilltree.js");
const assist = await import("../scripts/assist.js");
const { sensesNode } = await import("../scripts/nodes.js");
const { upgradePartial, getDegreeOfSuccess } = await import("../scripts/gathering.js");
const { successChance } = await import("../scripts/gather-ui.js");

const item = (name, perk) => ({ name, flags: { "eryndor-professions": { perk: { enabled: true, profession: "any", ...perk } } } });
function actor(name, { profession = "mining", xp = 0, perkItems = [], flags = {} } = {}) {
  const store = { selectedProfession: profession, xp: { [profession]: xp }, ...flags };
  return {
    name, id: name, uuid: `Actor.${name}`, type: "character", isOwner: true, items: perkItems,
    getFlag(_scope, key) { return foundry.utils.getProperty(store, key); },
    async setFlag(_scope, key, value) { store[key] = value; },
    async unsetFlag(_scope, key) { delete store[key]; }
  };
}
const skillPerk = key => tree.UNIVERSAL_SKILLS.find(skill => skill.key === key).perk;
const skillItem = key => item(tree.UNIVERSAL_SKILLS.find(skill => skill.key === key).name, skillPerk(key));

// --- normalizePerk -----------------------------------------------------------
const stored = perks.normalizePerk({ profession: "any", checkBonus: "2", checkDie: 4, seeOdds: true, scarcityRelief: 0.5 });
assert.deepEqual([stored.checkBonus, stored.checkDie, stored.seeOdds, stored.scarcityRelief, stored.yieldBonus, stored.rareDouble], [2, 4, true, 0.5, 0, false]);
assert.throws(() => perks.normalizePerk({ profession: "any" }), /at least one effect/);
assert.throws(() => perks.normalizePerk({ profession: "any", checkDie: 5 }), /Bonus die/);
assert.throws(() => perks.normalizePerk({ profession: "any", conserveChance: 95 }), /No-pull chance/);
assert.throws(() => perks.normalizePerk({ profession: "any", untrainedRelief: 2 }), /between 0 and 1/);
assert.throws(() => perks.normalizePerk({ profession: "nope", yieldBonus: 1 }), /valid profession/);
for (const skill of tree.UNIVERSAL_SKILLS) assert.doesNotThrow(() => perks.normalizePerk({ profession: "any", ...skill.perk }), `${skill.name} perk is valid`);

// --- actorPerks: sums, maxima, flags, caps, profession filter -----------------
const loaded = actor("Loaded", { perkItems: [
  skillItem("steadyHands"), skillItem("abundance"), skillItem("masterHarvester"),
  skillItem("lightTouch"), skillItem("conservationist"), skillItem("stewardOfTheWilds"),
  skillItem("expertTechnique"), skillItem("jackOfAllTrades"), skillItem("masterArtisan"),
  item("Herb Only", { profession: "herbalism", yieldBonus: 9 }), item("Off", { enabled: false, yieldBonus: 9 }),
  { name: "Old style", flags: { "eryndor-professions": { perk: { enabled: true, profession: "mining", yieldBonus: 1, rareChance: 5 } } } }
] });
const totals = perks.actorPerks(loaded, "mining");
assert.equal(totals.yieldBonus, 5, "1 + 2 + 1 + old perk 1; herbalism and disabled perks skipped");
assert.equal(totals.extraDraws, 1);
assert.equal(totals.conserveChance, 50);
assert.equal(totals.checkDie, 4);
assert.equal(totals.untrainedRelief, 1, "Fractions keep the largest");
assert.equal(totals.toolDouble, true);
assert.equal(totals.rareChance, 5);
assert.deepEqual(totals.effectSources.conserveChance, ["Light Touch", "Conservationist", "Steward of the Wilds"]);
assert.equal(perks.actorPerks(actor("Capped", { perkItems: [item("A", { conserveChance: 60 }), item("B", { conserveChance: 60 })] }), "mining").conserveChance, perks.MAX_CONSERVE);

// --- rare chance, scarcity relief --------------------------------------------
assert.equal(perks.rareChanceTotal({ rareChance: 12, rareDouble: true }, 5), 34);
assert.equal(perks.rareChanceTotal({ rareChance: 70, rareDouble: true }), 100);
assert.equal(perks.relievedMultiplier(0.5, 0.5), 0.75);
assert.equal(perks.relievedMultiplier(0.5, 1), 1);
assert.equal(perks.relievedMultiplier(0, 1), 0, "×0 stays a block");
assert.equal(perks.relievedMultiplier(3, 1), 3, "Gains unchanged");

// --- applyPerksToCheck --------------------------------------------------------
const base = { modifier: 2, trained: true, die: 6, target: 14, tierPenalty: 0, materialPenalty: 0, toolBonus: 0, toolName: "", skill: null };
let check = perks.applyPerksToCheck(base, { checkBonus: 1, dcReduction: 2, checkDie: 4 });
assert.equal(check.formula, "1d20 + 2 + 1d6 + 1 + 1d4");
assert.equal(check.target, 12);
check = perks.applyPerksToCheck({ ...base, toolName: "Pick", toolBonus: 2, toolProficiency: 2 }, { toolBonus: 1, toolDouble: true });
assert.equal(check.toolBonus, 5, "Doubled proficiency + Toolwise");
check = perks.applyPerksToCheck({ ...base, toolName: "Pick", toolBonus: 0, toolProficiency: 2, skill: "ath" }, {});
assert.equal(check.toolBonus, 0, "Skill nodes ignore tools by default");
check = perks.applyPerksToCheck({ ...base, toolName: "Pick", toolBonus: 0, toolProficiency: 2, skill: "ath" }, { toolWithSkill: true });
assert.equal(check.toolBonus, 2, "Masterwork Handling");
check = perks.applyPerksToCheck({ ...base, trained: false, die: null, tierPenalty: 3, materialPenalty: 2, target: 20 }, { untrainedRelief: 0.5 }, { bonus: 4, die: 4, untrainedRelief: 1 });
assert.equal(check.untrainedRelief, 5, "Assist relief (all) beats the perk's half");
assert.equal(check.target, 15);
assert.equal(check.formula, "1d20 + 2 + 4 + 1d4");
assert.equal(perks.applyPerksToCheck(base, null).formula, "1d20 + 2 + 1d6", "No perks: unchanged formula");

// --- rest uses ---------------------------------------------------------------
const rester = actor("Rester");
assert.equal(perks.rerollsLeft(rester, { rerolls: 1 }), 1);
await perks.spendReroll(rester);
assert.equal(perks.rerollsLeft(rester, { rerolls: 1 }), 0);
await perks.resetRestUses(rester);
assert.equal(perks.rerollsLeft(rester, { rerolls: 1 }), 1);

// --- degrees -----------------------------------------------------------------
assert.equal(upgradePartial(getDegreeOfSuccess(8, 10)).id, "successful");
assert.equal(upgradePartial(getDegreeOfSuccess(8, 10)).margin, -2);
assert.equal(upgradePartial(getDegreeOfSuccess(2, 10)).id, "failed");

// --- success chance with extra dice ------------------------------------------
assert.equal(successChance(0, 0, 11), 0.5);
assert.ok(successChance(0, 0, 11, [4]) > 0.5);
assert.equal(successChance(0, 0, 25, [4]), 0, "d20 + d4 never reaches 25");
assert.equal(successChance(0, 0, 24, [4]), 1 / 80);

// --- tree layout ---------------------------------------------------------------
assert.equal(tree.UNIVERSAL_SKILLS.length, tree.THEMES.length * tree.TIERS);
assert.equal(new Set(tree.UNIVERSAL_SKILLS.map(skill => skill.name)).size, 30, "Unique names");
const named = key => tree.UNIVERSAL_SKILLS.find(skill => skill.key === key);
assert.deepEqual(tree.prerequisites(named("keenEye")), []);
assert.deepEqual(tree.prerequisites(named("reliablePartner")).map(skill => skill.key).sort(), ["bountiful", "fieldHand", "pathfinder"]);
assert.deepEqual(tree.prerequisites(named("practicedTechnique")).map(skill => skill.key).sort(), ["discerningEye", "jackOfAllTrades", "secondLook"]);
assert.deepEqual(tree.prerequisites(named("conservationist")).map(skill => skill.key).sort(), ["lightTouch", "readerOfSeasons", "reliablePartner"], "Bridge wraps from Fellowship to Bounty");
assert.deepEqual(tree.prerequisites(named("readerOfSeasons")).map(skill => skill.key).sort(), ["conservationist", "masterworkHandling", "trailSense"], "Reader of Seasons opens from Conservationist");
for (const bridge of tree.UNIVERSAL_SKILLS.filter(skill => skill.row === tree.BRIDGE_ROW)) {
  for (const neighbour of tree.prerequisites(bridge).filter(skill => skill.col !== bridge.col)) {
    assert.ok(tree.prerequisites(neighbour).includes(bridge), `${bridge.name} and ${neighbour.name} connect both ways`);
  }
}
assert.deepEqual(tree.neighbourSpokes(0), [5, 1]);
// Radial grid: unique cells, inner ring around the centre, capstones at the tips.
const cells = tree.UNIVERSAL_SKILLS.map(skill => tree.gridPosition(skill));
assert.equal(new Set(cells.map(cell => `${cell.row},${cell.col}`)).size, 30);
assert.ok(cells.every(cell => cell.row >= 0 && cell.col >= 0 && cell.row < tree.GRID_SIZE && cell.col < tree.GRID_SIZE));
const centre = (tree.GRID_SIZE - 1) / 2;
const reach = cell => Math.hypot(cell.row - centre, cell.col - centre);
const ring = tier => tree.UNIVERSAL_SKILLS.filter(skill => skill.row === tier).map(skill => reach(tree.gridPosition(skill)));
assert.ok(Math.max(...ring(0)) < Math.min(...ring(1)) && Math.max(...ring(3)) < Math.min(...ring(4)), "Tiers grow outward");
assert.equal(tree.UNIVERSAL_SKILLS.filter(tree.isCapstone).length, 6);
// 10 points (2 at rank 1 plus 2 per rank to 5) buy a capstone path and a few side skills.
const fullCost = tree.UNIVERSAL_SKILLS.reduce((sum, skill) => sum + (tree.isCapstone(skill) ? tree.CAPSTONE_POINTS : 1), 0);
assert.ok(fullCost > 10 * 3, "The tree forces choices");

// --- sensing ------------------------------------------------------------------
settings.rules = { rankXp: [0, 100, 300, 700, 1500] };
const scout = actor("Scout", { xp: 100, perkItems: [skillItem("trailSense")] }); // mining rank 2
const hiddenNode = { hidden: true, senseRank: 3, profession: "mining" };
assert.equal(sensesNode(scout, hiddenNode), true, "Rank 2 + Trail Sense meets sense rank 3");
assert.equal(sensesNode(actor("Plain", { xp: 100 }), hiddenNode), false);
assert.equal(sensesNode(scout, { ...hiddenNode, profession: "herbalism" }), false, "Other profession: rank 0");
assert.equal(sensesNode(actor("Wanderer", { perkItems: [skillItem("wayfarer")] }), { ...hiddenNode, profession: "herbalism", senseRank: 5 }), true, "Wayfarer senses any sensable node");
assert.equal(sensesNode(actor("Wanderer2", { perkItems: [skillItem("wayfarer")] }), { ...hiddenNode, senseRank: 0 }), false, "GM-only hidden nodes stay hidden");

// --- assist --------------------------------------------------------------------
const page = { uuid: "JournalEntry.n.JournalEntryPage.p" };
const helper = actor("Helper", { perkItems: [skillItem("fieldHand"), skillItem("reliablePartner"), skillItem("mentor")] });
const gatherer = actor("Gatherer");
game.actors.push(helper, gatherer);
assert.deepEqual(assist.assistPower(helper), { bonus: 4, die: 4, untrainedRelief: 0.5 });
assert.equal(assist.assistLabel(assist.assistPower(helper)), "+4, +1d4, half untrained penalty");
assert.equal(assist.assistPower(gatherer), null);
await assert.rejects(assist.offerAssist(gatherer, page), /no assist skills/);
assert.equal(assist.findAssist(gatherer, page), null);
await assist.offerAssist(helper, page);
assert.equal(assist.findAssist(gatherer, page).helper, helper);
assert.equal(assist.findAssist(helper, page), null, "Cannot assist yourself");
assert.equal(assist.findAssist(gatherer, { uuid: "other" }), null, "Only at the offered node");
game.time.worldTime += 3601;
assert.equal(assist.findAssist(gatherer, page), null, "Offers expire after an hour");
game.time.worldTime -= 3601;
await assist.consumeAssist(helper, page);
assert.equal(assist.findAssist(gatherer, page), null, "Used up");

console.log("PASS: perks — validation, totals, caps, check math, rest uses, degrees, odds, tree layout, sensing, assist.");
