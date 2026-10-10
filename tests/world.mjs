// Smoke test of a sample world (tests/fixtures/sampleworld.js) with in-memory document doubles.
import assert from "node:assert/strict";

const hooks = new Map();
// worldContentVersion 2: the ready-time setup skips; the test runs it explicitly.
const settings = { worldContentVersion: 3 };
let nextId = 1;
const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((current, key) => current[key] ??= {}, object)[last] = value;
};
const merge = (target, source) => {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) target[key] = merge(target[key] ?? {}, value);
    else target[key] = value;
  }
  return target;
};

const EMBEDDED = { JournalEntryPage: "pages", TableResult: "results", Note: "notes", Item: "items" };
function makeClass(kind, collection) {
  return class Doc {
    constructor(data, parent) {
      Object.assign(this, structuredClone(data));
      this.id = `${kind}${nextId++}`;
      this.uuid = parent ? `${parent.uuid}.${kind}.${this.id}` : `${kind}.${this.id}`;
      this.parent = parent ?? null;
      this.flags ??= {};
      this.documentName = kind;
      if (kind === "JournalEntry") this.pages = (data.pages ?? []).map(page => new (makeClass("JournalEntryPage", null))(page, this));
      if (kind === "RollTable") this.results = (data.results ?? []).map(result => new (makeClass("TableResult", null))(result, this));
      if (kind === "Scene") this.notes = [];
    }
    getFlag(scope, key) { return getProperty(this.flags[scope] ?? {}, key); }
    async setFlag(scope, key, value) { this.flags[scope] ??= {}; setProperty(this.flags[scope], key, structuredClone(value)); }
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key.split(".").at(-1).startsWith("-=")) {
          const path = key.split(".");
          const last = path.pop().slice(2);
          const target = path.reduce((current, part) => current?.[part], this);
          if (target) delete target[last];
        } else if (key.includes(".")) setProperty(this, key, structuredClone(value));
        else if (value && typeof value === "object" && !Array.isArray(value)) this[key] = merge(this[key] ?? {}, structuredClone(value));
        else this[key] = value;
      }
      return this;
    }
    async delete() {
      const list = this.parent ? this.parent.pages : collection;
      list.splice(list.indexOf(this), 1);
    }
    toObject() { const { parent, ...rest } = this; return structuredClone(rest); }
    async createEmbeddedDocuments(type, list) {
      const created = list.map(data => new (makeClass(type, null))(data, this));
      this[EMBEDDED[type]].push(...created);
      return created;
    }
    async deleteEmbeddedDocuments(type, ids) {
      const list = this[EMBEDDED[type]];
      for (const id of ids) list.splice(list.findIndex(doc => doc.id === id), 1);
    }
    async updateEmbeddedDocuments(type, updates) {
      for (const { _id, ...changes } of updates) await this[EMBEDDED[type]].find(doc => doc.id === _id).update(changes);
    }
    static async create(data) {
      const list = Array.isArray(data) ? data : [data];
      const docs = list.map(entry => new this(entry));
      collection.push(...docs);
      return Array.isArray(data) ? docs : docs[0];
    }
    static async updateDocuments(updates) {
      for (const { _id, ...changes } of updates) await collection.find(doc => doc.id === _id).update(changes);
    }
    static async deleteDocuments(ids) {
      for (const id of ids) collection.splice(collection.findIndex(doc => doc.id === id), 1);
    }
  };
}

const items = [], tables = [], journal = [], actors = [], folders = [], scenes = [];
globalThis.Scene = { implementation: makeClass("Scene", scenes) };
const Item = makeClass("Item", items);
globalThis.Item = { implementation: Item };
globalThis.RollTable = { implementation: makeClass("RollTable", tables) };
globalThis.JournalEntry = { implementation: makeClass("JournalEntry", journal) };
globalThis.Actor = { implementation: makeClass("Actor", actors) };
globalThis.Folder = { implementation: makeClass("Folder", folders) };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = { Item: { documentClass: { implementation: Item } } };
globalThis.Hooks = { on(name, fn) { hooks.set(name, fn); }, once(name, fn) { hooks.set(name, fn); }, off() {}, callAll(name, ...args) { hookCalls.push([name, ...args]); } };
const hookCalls = [];
globalThis.ui = { notifications: { info() {}, error(message) { throw new Error(message); }, warn() {} } };
globalThis.foundry = {
  utils: { getProperty, setProperty, deepClone: structuredClone, mergeObject: merge, randomID: () => `r${nextId++}` },
  applications: { api: { DialogV2: {},
    // Mirrors Foundry v14: `state` is a getter-only render state on every application.
    ApplicationV2: class { constructor(options = {}) { this.options = options; } get state() { return 0; } async render() { return this; } } } }
};
globalThis.gatherer = class { async toChat() {} };
const granted = [];
globalThis.game = {
  user: { isGM: true, id: "gm" },
  users: { activeGM: null },
  settings: {
    register(_module, key, options) { if (!(key in settings)) settings[key] = structuredClone(options.default); },
    registerMenu() {},
    get(namespace, key) { return namespace === "gatherer" ? "quantity" : settings[key]; },
    async set(_namespace, key, value) { settings[key] = structuredClone(value); }
  },
  modules: new Map([
    ["gatherer", { active: true }],
    ["gathering-professions", {}],
    ["skill-tree", { active: true, API: {
      async grantSkillPoints(actor, points, { skillTree }) {
        const key = `skillTreeSkillPoints.${skillTree.id}`;
        await actor.setFlag("skill-tree", key, (actor.getFlag("skill-tree", key) ?? 0) + points);
        granted.push([actor.name, points, skillTree.name]);
      },
      getSkillTreePoints(actor, skillTree) {
        const groups = Object.fromEntries((skillTree.getFlag("skill-tree", "groups") ?? []).map(group => [group.id, 0]));
        for (const page of skillTree.pages) {
          const group = page.getFlag("skill-tree", "groupId");
          if (group in groups) groups[group] += (actor.getFlag("skill-tree", "skills") ?? [])
            .find(skill => skill.uuid === page.uuid)?.points ?? 0;
        }
        return { ...groups, total: Object.values(groups).reduce((sum, points) => sum + points, 0)
          + (actor.getFlag("skill-tree", `skillTreeSkillPoints.${skillTree.id}`) ?? 0) };
      }
    } }]
  ]),
  items, tables, journal, actors, folders, scenes, users: [], time: { worldTime: 1000 }
};
game.scenes.get = id => scenes.find(scene => scene.id === id);
game.items.get = id => items.find(item => item.id === id);
globalThis.fromUuidSync = uuid => [...items, ...tables, ...journal, ...actors, ...journal.flatMap(entry => entry.pages)].find(doc => doc.uuid === uuid) ?? null;
globalThis.fromUuid = async uuid => globalThis.fromUuidSync(uuid);

await import("../scripts/main.js");
const fixture = await import("./fixtures/sampleworld.js");
hooks.get("init")();
await hooks.get("ready")();
const api = game.modules.get("gathering-professions").api;
const integrations = await import("../scripts/integrations.js");
game.modules.get("skill-tree").active = false;
assert.deepEqual(integrations.availableSkillTrees(), [], "Inactive Skill Tree has no readable flag scope");
const perksWithoutTree = await import("../scripts/perks.js");
const storedSkill = { uuid: "JournalEntry.test.JournalEntryPage.skill", flags: {
  "gathering-professions": { universalSkill: "steadyHands" }, "skill-tree": { points: 1 } },
  getFlag(scope, key) { if (scope === "skill-tree") throw new Error("Inactive flag scope"); return this.flags[scope]?.[key]; } };
const learnedActor = { flags: { "skill-tree": { skills: [{ uuid: storedSkill.uuid, points: 1 }] } },
  getFlag(scope) { if (scope === "skill-tree") throw new Error("Inactive flag scope"); } };
assert.equal(perksWithoutTree.universalSkillUnlocked(learnedActor, "steadyHands", { pages: [storedSkill] }), true,
  "Stored learned skills remain readable without calling the inactive flag scope");
game.modules.get("skill-tree").active = true;

const [map] = await Scene.implementation.create([{ name: "Test Map", width: 3000, height: 2000 }]);
globalThis.canvas = { scene: map };
assert.equal(fixture.sampleWorldExists(), false);
const result = await fixture.createSampleWorld();
assert.equal(map.notes.length, 3, "Kit pins one note per node on the open scene");
assert.equal(fixture.sampleWorldExists(), true);
await assert.rejects(fixture.createSampleWorld(), /already exists/);

assert.equal(folders.length, 4);
const { UNIVERSAL_SKILLS } = await import("../scripts/skilltree.js");
assert.equal(UNIVERSAL_SKILLS.length, 30);
assert.deepEqual(items.map(item => item.name).sort(), ["Test Copper Ore", "Test Glowcap Truffle", "Test Miner's Pick", "Test Moonpetal", "Test Silver Ore", "Test Star Sapphire",
  ...UNIVERSAL_SKILLS.map(skill => skill.name)].sort());
assert.equal(new Set(UNIVERSAL_SKILLS.map(skill => `${skill.col},${skill.row}`)).size, 30, "Every grid cell is used once");
const copper = items.find(item => item.name === "Test Copper Ore");
assert.deepEqual(api.getProfessions().mining.rareTable, result.rareOre);
const rules = await import("../scripts/rules.js");
assert.equal(rules.materialRule(copper).baseYield, "1d4");
assert.equal(rules.materialRule(copper).rareTable, result.rareOre);
const mining = tables.find(table => table.name === "Test Mining Node");
assert.equal(mining.formula, "1d4");
assert.deepEqual(mining.results.map(r => r.range), [[1, 3], [4, 4]]);
assert.equal(mining.results[0].documentUuid, copper.uuid);

const nodes = journal.find(entry => entry.name === "Gathering Test Nodes");
const vein = nodes.pages.find(page => page.name === "Copper Vein");
assert.equal(vein.type, "gatherer.gatherer");
assert.equal(vein.flags.gatherer.table, mining.uuid);

const tree = journal.find(entry => entry.uuid === result.tree);
assert.equal(tree.flags["skill-tree"].isSkillTree, true);
assert.equal(tree.flags["skill-tree"].groups.length, 1, "One universal group");
assert.equal(tree.flags["skill-tree"].groups[0].id, "gatheringProfessions", "Fixed group id for the radial styles");
assert.equal(tree.flags["skill-tree"].groups[0].name, "", "No yellow group title");
assert.equal(tree.name, "Gathering Skill Tree", "No test suffix in the tree title");
assert.equal(tree.flags["skill-tree"].independentSkillPoints, true, "Own point pool");
assert.equal(tree.flags["gathering-professions"].layoutVersion, 8);
assert.equal(tree.pages.length, 30);
const skillPage = name => tree.pages.find(page => page.name === name);
const st = name => skillPage(name).flags["skill-tree"];
// Radial: spokes outward from the inner ring; tier 3 also opens from neighbouring spokes.
assert.deepEqual(st("Steady Hands").connectedSkills, []);
assert.deepEqual([st("Steady Hands").row, st("Steady Hands").col], [8, 12], "Bounty tier 1 just above the centre");
assert.deepEqual([st("Master Harvester").row, st("Master Harvester").col], [0, 12], "Capstone at the spoke tip");
assert.deepEqual(st("Light Touch").connectedSkills.sort(), [skillPage("Steady Hands").uuid, skillPage("Treasure Hunter").uuid, skillPage("Conservationist").uuid].sort());
assert.deepEqual(st("Bountiful").connectedSkills.sort(), [skillPage("Light Touch").uuid, skillPage("Discerning Eye").uuid, skillPage("Reliable Partner").uuid].sort(), "Bridge wraps around the hexagon");
assert.deepEqual(st("Practiced Technique").connectedSkills.sort(), [skillPage("Discerning Eye").uuid, skillPage("Second Look").uuid, skillPage("Jack of All Trades").uuid].sort());
assert.deepEqual(st("Abundance").connectedSkills, [skillPage("Bountiful").uuid]);
assert.ok(st("Reader of Seasons").connectedSkills.includes(skillPage("Conservationist").uuid), "Conservationist unlocks Reader of Seasons");
assert.ok(st("Conservationist").connectedSkills.includes(skillPage("Reader of Seasons").uuid), "Reader of Seasons unlocks Conservationist");
assert.deepEqual(st("Practiced Technique").requirements, [], "Skills have no profession rank gate");
assert.doesNotMatch(skillPage("Practiced Technique").text.content, /Needs rank/);
assert.equal(st("Proficient Gatherer").points, 1);
assert.equal(st("Proficient Gatherer").itemUuids[0], items.find(item => item.name === "Proficient Gatherer").uuid);
// Capstones: 2 points and lock out the other five.
const capstones = UNIVERSAL_SKILLS.filter(skill => skill.row === 4).map(skill => skill.name);
assert.equal(capstones.length, 6);
for (const name of capstones) {
  assert.equal(st(name).points, 2);
  assert.deepEqual(st(name).requirements, []);
  assert.deepEqual(st(name).lockoutSkills.sort(), capstones.filter(other => other !== name).map(other => skillPage(other).uuid).sort());
}
assert.deepEqual(st("Abundance").lockoutSkills, []);
assert.equal(items.find(item => item.name === "Light Touch").flags["gathering-professions"].perk.conserveChance, 15);
assert.equal(items.find(item => item.name === "Light Touch").flags["gathering-professions"].universalSkill, "lightTouch");
assert.equal(api.skillTreeConfig().uuid, tree.uuid);
assert.deepEqual([api.skillTreeConfig().startingPoints, api.skillTreeConfig().pointsPerRank], [2, 2]);
settings.skillTree = { uuid: tree.uuid, startingPoints: 3, pointsPerRank: 3 };
assert.deepEqual([api.skillTreeConfig().startingPoints, api.skillTreeConfig().pointsPerRank], [2, 2],
  "Previously saved 3/3 settings use the new 2/2 rate");
await api.setSkillTreeConfig({ uuid: tree.uuid, startingPoints: 2, pointsPerRank: 2 });
// Older trees move to the radial layout in place (page UUIDs kept).
const { needsRelayout } = await import("../scripts/skilltree.js");
assert.equal(needsRelayout(tree), false);
await skillPage("Bountiful").update({ "flags.skill-tree.row": 2, "flags.skill-tree.col": 0, "flags.skill-tree.connectedSkills": [] });
await skillPage("Bountiful").update({ "flags.skill-tree.requirements": [{ label: "Profession rank", value: 3 }],
  "text.content": "<p>Needs rank 3 in your profession</p>" });
tree.flags["skill-tree"].groups = [{ id: "oldGroup", name: "Gathering" }];
tree.flags["skill-tree"].independentSkillPoints = false;
tree.flags["gathering-professions"].layoutVersion = 3;
const bountifulUuid = skillPage("Bountiful").uuid;
assert.equal(needsRelayout(tree), true);
// Scramble two links, as trees built before 0.15.0 could be; relayout fixes them.
const lightTouchItem = items.find(item => item.name === "Light Touch").uuid;
const bountifulItem = items.find(item => item.name === "Bountiful").uuid;
await skillPage("Light Touch").update({ "flags.skill-tree.itemUuids": [bountifulItem] });
await skillPage("Bountiful").update({ "flags.skill-tree.itemUuids": [lightTouchItem] });
await api.skillTree.relayout(tree);
assert.deepEqual([st("Light Touch").itemUuids, st("Bountiful").itemUuids], [[lightTouchItem], [bountifulItem]], "Pages re-linked to their own skill Items");
assert.ok(tree.pages.every(page => items.find(item => item.uuid === page.flags["skill-tree"].itemUuids[0])?.name === page.name), "Every page links its own Item");
assert.equal(needsRelayout(tree), false);
assert.equal(skillPage("Bountiful").uuid, bountifulUuid);
assert.deepEqual([st("Bountiful").row, st("Bountiful").col, st("Bountiful").groupId], [4, 12, "gatheringProfessions"]);
assert.equal(st("Bountiful").connectedSkills.length, 3);
assert.deepEqual(st("Bountiful").requirements, [], "Existing tree loses the old rank gate");
assert.doesNotMatch(skillPage("Bountiful").text.content, /Needs rank/);
assert.equal(tree.flags["skill-tree"].groups[0].id, "gatheringProfessions");
assert.equal(tree.flags["skill-tree"].groups[0].name, "");
assert.ok(st("Reader of Seasons").connectedSkills.includes(skillPage("Conservationist").uuid));
assert.equal(tree.flags["skill-tree"].independentSkillPoints, true);

const actor = actors[0];
assert.equal(actor.name, "Test Gatherer");
assert.equal(actor.getFlag("gathering-professions", "effectiveRank").mining, 1);
assert.equal(actor.getFlag("gathering-professions", "professionRank"), 1, "Universal rank mirror");
assert.deepEqual(granted, [["Test Gatherer", 2, "Gathering Skill Tree"]]);
const comboNames = ["Keen Eye", "Treasure Hunter", "Fortune's Favour", "Light Touch", "Conservationist", "Steward of the Wilds"];
const skillItems = comboNames.map(name => items.find(item => item.name === name));
const learned = names => ({ "skill-tree": { skills: names.map(name => ({ uuid: skillPage(name).uuid, points: st(name).points })) } });
// Skill Items only count while their skill is unlocked in the linked tree.
assert.equal(api.actorPerks({ items: skillItems, flags: {} }, "herbalism").rareChance, 0, "Leftover skill Items with nothing learned give nothing");
assert.equal(api.actorPerks({ items: skillItems, flags: learned(["Keen Eye"]) }, "herbalism").rareChance, 3);
assert.equal(api.actorPerks({ items: skillItems, flags: { "skill-tree": { skills: [{ uuid: skillPage("Fortune's Favour").uuid, points: 1 }] } } }, "herbalism").climbAdvantage, false, "A capstone needs both points");
// Perks the GM hands out directly (not tree skills) always count.
const gmPerk = { name: "Blessing of the Deep", parent: {}, flags: { "gathering-professions": { perk: { enabled: true, profession: "any", yieldBonus: 2 } } } };
assert.equal(api.actorPerks({ items: [gmPerk], flags: {} }, "mining").yieldBonus, 2);
const combo = api.actorPerks({ items: skillItems, flags: learned(comboNames) }, "herbalism");
assert.deepEqual([combo.rareChance, combo.rareAdvantage, combo.rareDouble, combo.climbAdvantage, combo.conserveChance], [14, false, false, true, 50], "Keen Eye 3 + Treasure Hunter 6 + Fortune's Favour 5");

// Node Manager view model: grouped by journal, filters, badges, materials, HTML.
const nodeUi = await import("../scripts/node-ui.js");
let groupsModel = nodeUi.buildListModel(api.nodes.all(), {});
assert.deepEqual(groupsModel.map(group => group.name), ["Gathering Test Nodes"]);
assert.deepEqual(groupsModel[0].rows.map(row => row.name), ["Copper Vein", "Deep Silver Seam", "Moonpetal Patch"]);
const seamRow = groupsModel[0].rows.find(row => row.name === "Deep Silver Seam");
assert.deepEqual(seamRow.badges.map(badge => badge.kind), ["hidden", "sense", "check", "rank", "tool", "dc", "yield", "rare"]);
const copperRow = groupsModel[0].rows.find(row => row.name === "Copper Vein");
assert.deepEqual(copperRow.materials.map(material => [material.name, material.percent]), [["Test Copper Ore", 75], ["Test Silver Ore", 25]]);
assert.equal(copperRow.fill, 100);
assert.equal(nodeUi.buildListModel(api.nodes.all(), { profession: "herbalism" })[0].rows.length, 1);
assert.equal(nodeUi.buildListModel(api.nodes.all(), { search: "seam" })[0].rows.length, 1);
assert.equal(nodeUi.buildListModel(api.nodes.all(), { search: "gathering test" })[0].rows.length, 3, "Search matches journal names too");
assert.equal(nodeUi.buildListModel(api.nodes.all(), { scene: map.id })[0].rows.length, 3);
assert.equal(nodeUi.buildListModel(api.nodes.all(), { scene: "elsewhere" }).length, 0);
const listHtml = nodeUi.renderList(groupsModel, { selected: seamRow.uuid, collapsed: new Set(), checked: new Set(), bulk: true });
assert.ok(new RegExp(`gp-nm-row selected[^"]*" data-uuid="${seamRow.uuid}"`).test(listHtml), "Selected row is highlighted");
assert.match(listHtml, /Test Copper Ore — 75%/);
assert.match(listHtml, /gp-nm-bulk/);
const detailHtml = nodeUi.renderDetail(fromUuidSync(seamRow.uuid), { selected: seamRow.uuid, tab: "rules" });
for (const text of ["Deep Silver Seam", "Check &amp; Rules", 'data-panel="rules"', 'name="minRank"', "Test Miner&#39;s Pick", "gp-tool-chip", "data-rare-select", "Test Rare Ores", "data-icon-picker", "Profession sense", "Save changes"]) {
  assert.ok(detailHtml.includes(text), `Detail pane missing ${text}`);
}
assert.match(nodeUi.renderDetail(null, { selected: "new", tab: "basics" }), /Create node/);
assert.match(nodeUi.renderDetail(null, { selected: null }), /Gathering Nodes/);
if (process.env.GP_PREVIEW) {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");
  for (const [name, state] of [["preview-list-detail", { selected: seamRow.uuid, tab: "rules", bulk: false, scroll: true }], ["preview-basics", { selected: copperRow.uuid, tab: "basics", openPicker: true }], ["preview-new", { selected: "new", tab: "materials", bulk: true, checked: new Set([copperRow.uuid]) }]]) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><style>
      body{margin:0;background:#1a1720;color:#efe6d8;font-family:Signika,Arial,sans-serif;font-size:14px}
      .app{width:1080px;height:720px;margin:10px;border:1px solid #4a3f35;border-radius:6px;display:flex;flex-direction:column;background:#211d27}
      .app>header{padding:.4rem .6rem;border-bottom:1px solid #4a3f35;font-weight:600}
      .window-content{flex:1;min-height:0;display:flex;flex-direction:column}
      input,select,button{background:#2b2632;color:inherit;border:1px solid #5a4e43;border-radius:4px;height:28px;font:inherit}
      button{cursor:pointer} h2,h3{font-family:inherit} img{border:none}
      ${css}</style></head><body><div class="app gp-node-manager gathering-professions-ui"><header>Gathering Nodes</header><div class="window-content"><div class="gp-nm"><aside class="gp-nm-list">${nodeUi.renderList(nodeUi.buildListModel(api.nodes.all(), state), { collapsed: new Set(), checked: new Set(), ...state })}</aside><section class="gp-nm-detail">${nodeUi.renderDetail(state.selected === "new" ? null : fromUuidSync(state.selected), state).replace(state.openPicker ? 'class="gp-icon-picker"' : "\u0000", 'class="gp-icon-picker open"')}</section></div></div></div></body></html>`;
    fs.writeFileSync(`${process.env.GP_PREVIEW}/${name}.html`, html);
  }
}

// Icon picker groups material images by profession.
assert.deepEqual(nodeUi.iconGroups().map(group => [group.label, group.icons.length]), [["Herbalism", 1], ["Mining", 2]]);

// Tool library (world setting), any-of tools, source-ID matching, best bonus.
const nodesLib = await import("../scripts/nodes.js");
const pickItem = items.find(item => item.name === "Test Miner's Pick");
const smith = (await Item.create([{ name: "Smith's Tools", type: "tool", img: "smith.webp", system: { proficient: 2 } }]))[0];
assert.deepEqual(api.nodes.getToolLibrary(), []);
await api.nodes.addToolToLibrary(smith.uuid);
await api.nodes.addToolToLibrary(pickItem.uuid);
await api.nodes.addToolToLibrary(pickItem.uuid);
assert.deepEqual(api.nodes.getToolLibrary().map(tool => tool.name), ["Smith's Tools", "Test Miner's Pick"], "Library is sorted and deduplicated");
await assert.rejects(api.nodes.addToolToLibrary(tree.uuid), /Drop an Item/);
const anyOf = { tools: [{ uuid: pickItem.uuid, name: pickItem.name }, { uuid: smith.uuid, name: smith.name }] };
const toolUser = { name: "Tool User", items: [], system: { attributes: { prof: 3 } } };
assert.match(api.nodes.gate(toolUser, anyOf).reason, /You need Test Miner's Pick or Smith's Tools/);
toolUser.items.push({ name: "Renamed Pick", _stats: { compendiumSource: pickItem.uuid }, system: { proficient: 1 } });
assert.equal(api.nodes.gate(toolUser, anyOf).ok, true, "A renamed copy matches by source ID");
toolUser.items.push({ name: "Smith's Tools", system: { proficient: 2 } });
const bestPick = nodesLib.bestTool(toolUser, anyOf);
assert.equal(bestPick.item.name, "Smith's Tools", "Name fallback match; highest bonus wins");
assert.equal(bestPick.bonus, 6);
const adjusted = nodesLib.applyNodeCheck({ ability: "str", modifier: 2, trained: true, die: 6, target: 10 }, toolUser, anyOf);
assert.equal(adjusted.formula, "1d20 + 2 + 6 + 1d6");
assert.equal(adjusted.toolName, "Smith's Tools");
assert.equal(api.nodes.gate(toolUser, { toolName: "Old Name Tool" }).ok, false, "Legacy name-only tools still gate");
assert.throws(() => api.nodes.normalize({ tools: "not json" }), /Tool list/);
assert.equal(api.nodes.normalize({ tools: JSON.stringify(anyOf.tools) }).tools.length, 2);
await api.nodes.removeToolFromLibrary(smith.uuid);
assert.deepEqual(api.nodes.getToolLibrary().map(tool => tool.name), ["Test Miner's Pick"]);
const toolsHtml = nodeUi.toolsSection([{ uuid: smith.uuid, name: "Smith's Tools", img: "smith.webp" }]);
assert.match(toolsHtml, /gp-tool-chip/);
assert.match(toolsHtml, /Add a tool from the library/);
assert.match(toolsHtml, /Tool library \(1\)/);
await Item.deleteDocuments([smith.id]);
await game.settings.set("gathering-professions", "toolLibrary", []);

// Rare table dropdown, preview, and quick-create.
assert.match(nodeUi.rareTableOptions(""), /Default — material/);
assert.match(nodeUi.rareTableOptions(result.rareOre), new RegExp(`value="${result.rareOre}" selected`));
assert.match(nodeUi.rarePreview(result.rareOre), /Test Star Sapphire.*100%/s);
assert.match(nodeUi.rarePreview(""), /each material/);
const quickRare = await api.nodes.createRareTable("Seam Rares", [{ uuid: copper.uuid, weight: 1 }, { uuid: pickItem.uuid, weight: 3 }]);
assert.equal(quickRare.formula, "1d4");
assert.equal(quickRare.getFlag("gathering-professions", "rareTable"), true);
assert.equal(folders.find(folder => folder.id === quickRare.folder).name, "Rare Find Tables");
await assert.rejects(api.nodes.createRareTable("", [{ uuid: copper.uuid, weight: 1 }]), /Name the rare/);
await RollTable.implementation.deleteDocuments([quickRare.id]);
await Folder.implementation.deleteDocuments([quickRare.folder]);

// Gathering window model: discovery, readiness, chances, rendering.
const gatherUi = await import("../scripts/gather-ui.js");
assert.equal(gatherUi.successChance(0, 0, 11), 0.5);
assert.equal(gatherUi.successChance(0, 4, 25), 0);
assert.equal(gatherUi.successChance(5, 4, 7), 1);
assert.ok(Math.abs(gatherUi.successChance(2, 6, 15) - (gatherUi.successChance(2, 6, 15))) < 1e-9);
assert.equal(gatherUi.formatDuration(5 * 3600 + 12 * 60), "5h 12m");
assert.equal(gatherUi.formatDuration(90000), "1d 1h");
game.users.activeGM = { id: "gm" };
const veinPage = nodes.pages.find(page => page.name === "Copper Vein");
const gm = gatherUi.buildGatherModel(veinPage, null, { isGM: true });
assert.equal(gm.knownCount, 2, "GM sees every material");
assert.equal(gm.professionLabel, "Mining");
const playerView = gatherUi.buildGatherModel(veinPage, actor, { isGM: false });
assert.equal(playerView.knownCount, 0, "Nothing discovered yet");
assert.equal(playerView.actor.rank, 1);
assert.equal(playerView.actor.die, 4);
assert.ok(playerView.actor.chanceMin > 0 && playerView.actor.chanceMax <= 1);
assert.equal(playerView.actor.gate.ok, true);
assert.deepEqual([playerView.actor.gatheringAllowance.limit, playerView.actor.gatheringAllowance.remaining], [5, 5]);
let windowHtml = gatherUi.renderGatherWindow(playerView, { characters: [actor] });
assert.match(windowHtml, /Gathering attempts: 5 \/ 5 free before long rest/);
assert.match(windowHtml, /\?\?\?/);
assert.match(windowHtml, /0\/2 known/);
assert.match(windowHtml, /Undiscovered materials appear/);
assert.match(windowHtml, /chance of a full success/);
assert.doesNotMatch(windowHtml, /gp-gw-gm/, "Players get no GM bar");
assert.doesNotMatch(windowHtml, /Test Copper Ore/, "Undiscovered names stay secret");
await gatherUi.recordDiscovery(veinPage, [copper.uuid, copper.uuid]);
assert.deepEqual(veinPage.flags["gathering-professions"].discovered, [copper.uuid]);
windowHtml = gatherUi.renderGatherWindow(gatherUi.buildGatherModel(veinPage, actor), { characters: [actor] });
assert.match(windowHtml, /Test Copper Ore/);
assert.match(windowHtml, /1\/2 known/);
const gmHtml = gatherUi.renderGatherWindow(gm, { characters: [actor] });
assert.match(gmHtml, /gp-gw-gm/);
assert.match(gmHtml, /75% · DC 10/);
// Seam: rank gate and tool requirement shown as missing; button disabled with the reason.
const seamModel = gatherUi.buildGatherModel(nodes.pages.find(page => page.name === "Deep Silver Seam"), actor);
assert.deepEqual(seamModel.actor.requirements.map(req => [req.label, req.ok]), [["Mining rank 2+", false], ["Test Miner's Pick", false]]);
const seamHtml = gatherUi.renderGatherWindow(seamModel, { characters: [actor] });
assert.match(seamHtml, /data-act="gather" disabled/);
assert.match(seamHtml, /Mining rank 2 required/);
// Result reveal markup.
const revealHtml = gatherUi.renderResults([
  { type: "profession", item: { name: "Test Copper Ore", img: "c.webp" }, quantity: 4, professionLabel: "Mining", trained: true, die: 4, modifier: 2, toolBonus: 0,
    d20: 12, dieRoll: 3, total: 17, target: 10, degree: { id: "excellent", label: "Excellent Extraction", margin: 7 }, xp: 5,
    xpBar: { from: 95, to: 100, label: "100 / 300 XP to rank 3" }, rankUp: 2, rare: { trigger: "Rare roll 4 ≤ 25%", items: [{ name: "Test Star Sapphire", img: "s.webp" }], texts: [] } },
  { type: "plain", item: { name: "Twig", img: "t.webp" }, quantity: 2 }
], { name: "Test Gatherer" });
for (const text of ["Excellent Extraction", "margin +7", "×4", "Test Star Sapphire", "Rare find!", "Rank 2!", "+5 Mining XP", "--from:95%;--to:100%", "Twig"]) {
  assert.ok(revealHtml.includes(text), `Reveal missing ${text}`);
}
assert.deepEqual(gatherUi.xpProgress(100, 5, 2), { from: 0, to: 0, label: "100 / 300 XP to rank 3" });
assert.deepEqual(gatherUi.xpProgress(1600, 60, 5), { from: 100, to: 100, label: "Max rank" });
if (process.env.GP_PREVIEW) {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");
  const shell = (body, width) => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#15121a;color:#efe6d8;font-family:Signika,Arial,sans-serif;font-size:14px}
    .app{width:${width}px;margin:10px;border:1px solid #4a3f35;border-radius:6px;background:#211d27}
    .app>header{padding:.4rem .6rem;border-bottom:1px solid #4a3f35;font-weight:600}
    input,select,button,textarea{background:#2b2632;color:inherit;border:1px solid #5a4e43;border-radius:4px;height:28px;font:inherit}
    button{cursor:pointer} img{border:none}
    ${css}</style></head><body><div class="app gp-gathering-window gathering-professions-ui"><header>Gathering</header><div class="window-content">${body}</div></div></body></html>`;
  const flavorModel = gatherUi.buildGatherModel(veinPage, actor);
  flavorModel.flavor = "Green-streaked rock juts from the cliff face. Old pick marks show someone has worked this vein before.";
  fs.writeFileSync(`${process.env.GP_PREVIEW}/gather-window.html`, shell(gatherUi.renderGatherWindow(flavorModel, { characters: [actor], resultHtml: revealHtml }), 470));
  fs.writeFileSync(`${process.env.GP_PREVIEW}/gather-seam.html`, shell(gatherUi.renderGatherWindow(seamModel, { characters: [actor] }), 470));
  fs.writeFileSync(`${process.env.GP_PREVIEW}/gather-gm.html`, shell(gatherUi.renderGatherWindow(gm, { characters: [actor] }), 470));
}

// 0.8.0: conditions in the gathering window (pins via settings).
{
  const moonPage = nodes.pages.find(page => page.name === "Moonpetal Patch");
  const moonItem = items.find(item => item.name === "Test Moonpetal");
  await game.settings.set("gathering-professions", "conditionOverrides", { season: "", weather: "", time: "night" });
  let model = gatherUi.buildGatherModel(moonPage, actor, { isGM: true });
  assert.equal(model.materials[0].multiplier, 3);
  assert.equal(model.materials[0].hint.key, "abundant");
  assert.deepEqual(model.conditions.map(chip => [chip.type, chip.label]), [["time", "Night"]]);
  let html = gatherUi.renderGatherWindow(model, { characters: [actor] });
  assert.match(html, /Abundant now/);
  assert.match(html, /gp-gw-cond[^>]*>.*Night/s);
  assert.match(html, /×3/);
  await gatherUi.recordDiscovery(moonPage, [moonItem.uuid]);
  await game.settings.set("gathering-professions", "conditionOverrides", { season: "winter", weather: "", time: "night" });
  model = gatherUi.buildGatherModel(moonPage, actor, { isGM: false });
  assert.equal(model.empty, true);
  html = gatherUi.renderGatherWindow(model, { characters: [actor] });
  assert.match(html, /Nothing can be gathered here right now \(winter, Night\)/);
  assert.match(html, /Not found now/);
  assert.match(html, /data-act="gather" disabled/);
  if (process.env.GP_PREVIEW) {
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");
    const wrap = (body, width, cls = "gp-gathering-window") => `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#15121a;color:#efe6d8;font-family:Signika,Arial,sans-serif;font-size:14px}
      .app{width:${width}px;margin:10px;border:1px solid #4a3f35;border-radius:6px;background:#211d27}
      .app>header{padding:.4rem .6rem;border-bottom:1px solid #4a3f35;font-weight:600}
      input,select,button,textarea{background:#2b2632;color:inherit;border:1px solid #5a4e43;border-radius:4px;height:28px;font:inherit}
      img{border:none} ${css}</style></head><body><div class="app ${cls} gathering-professions-ui"><header>Window</header><div class="window-content" style="height:auto">${body}</div></div></body></html>`;
    await game.settings.set("gathering-professions", "conditionOverrides", { season: "", weather: "rain", time: "night" });
    const shown = gatherUi.buildGatherModel(moonPage, actor, { isGM: false });
    fs.writeFileSync(`${process.env.GP_PREVIEW}/cond-gather.html`, wrap(gatherUi.renderGatherWindow(shown, { characters: [actor] }), 470));
    const condUi = await import("../scripts/conditions-ui.js");
    await game.settings.set("gathering-professions", "conditionDc", [{ type: "weather", value: "blizzard", profession: "", dc: 5 }, { type: "time", value: "night", profession: "mining", dc: 2 }]);
    fs.writeFileSync(`${process.env.GP_PREVIEW}/cond-window-dc.html`, wrap(condUi.renderConditionsWindow({ tab: "dc" }), 860, "gp-node-manager gp-conditions-window"));
    fs.writeFileSync(`${process.env.GP_PREVIEW}/cond-window-now.html`, wrap(condUi.renderConditionsWindow({ tab: "now" }), 860, "gp-node-manager gp-conditions-window"));
    fs.writeFileSync(`${process.env.GP_PREVIEW}/cond-rules.html`, wrap(`<div style="padding:1rem">${condUi.rulesEditorHtml(moonItem.flags["gathering-professions"].material.conditions, "conditions")}</div>`, 560, "gp-node-manager"));
    await game.settings.set("gathering-professions", "conditionDc", []);
  }
  await game.settings.set("gathering-professions", "conditionOverrides", {});
}

// Windows construct under Foundry's getter-only ApplicationV2#state (0.7.0 regression).
const gatherWindow = await gatherUi.openGatheringWindow(veinPage);
assert.equal(gatherWindow.view.busy, false);
assert.equal(gatherWindow.state, 0, "The render state getter is not overwritten");
// The Node Manager lives in the GM hub (Nodes section).
const managerCore = await nodeUi.openNodeManager({ select: "new" });
assert.equal(managerCore.view.selected, "new");
const hubWindow = (await import("../scripts/hub.js"));
assert.match(hubWindow.renderHub({ ...hubWindow.initialHubView("nodes"), section: "nodes" }), /class="gp-hub-nodes gp-node-manager"/);
// Other modules add hub sections (Crafting Professions → "Crafting").
hubWindow.registerHubSection({ id: "testcraft", label: "Test Craft", group: "Crafting Professions", icon: "fa-hammer", blurb: "Test section.", render: () => '<form class="tc-form"><button type="button" data-tc="go">Go</button></form>' });
const extHub = hubWindow.renderHub({ ...hubWindow.initialHubView("testcraft"), section: "testcraft" });
assert.match(extHub, /Profession<br>GM Hub/, "The hub brand uses the shared GM hub name");
assert.match(extHub, /aria-label="Gathering Professions">[\s\S]*data-section="professions"[\s\S]*<\/div><div class="gp-hub-nav-group" role="group" aria-label="Crafting Professions">/, "Gathering and Crafting have separate sidebar groups");
assert.match(extHub, /aria-label="Crafting Professions">[\s\S]*data-section="testcraft"/, "Crafting links appear in their own group");
assert.match(extHub, /data-section="testcraft">\s*<i class="fas fa-hammer"><\/i><span>Test Craft/, "Added sections appear in the hub navigation");
assert.match(extHub, /<div class="gp-hub-external" data-section="testcraft"><form class="tc-form">/, "Their own markup, not inside the hub form");
assert.ok(hubWindow.hubSections().some(section => section.id === "testcraft"));

// Hidden seam: page ownership NONE for players; revealed nodes OBSERVER.
const seam = nodes.pages.find(page => page.name === "Deep Silver Seam");
assert.equal(seam.ownership.default, 0);
assert.equal(vein.ownership.default, 2);
assert.equal(api.nodes.read(seam).minRank, 2);
assert.match(api.nodes.gate(actor, api.nodes.read(seam)).reason, /Mining rank 2 required/);
assert.equal(api.nodes.read(seam).tools[0].name, "Test Miner's Pick");

// ---- Node Builder, visibility, tint, duplicate, delete -------------------
const player = { id: "player1", isGM: false };
game.users = [player, { id: "gm", isGM: true }];
const playerChar = (await Actor.implementation.create([{ name: "Player Miner", type: "character",
  flags: { "gathering-professions": { selectedProfession: "mining", xp: { mining: 0 } } } }]))[0];
playerChar.testUserPermission = (user, level) => user.id === "player1" && level === "OWNER";
const discoverySilver = items.find(item => item.name === "Test Silver Ore");
playerChar.items = [{ name: discoverySilver.name }];
veinPage.testUserPermission = (user, level) => user.id === "player1" && level === "OBSERVER";
const discoveryRequest = { pageUuid: veinPage.uuid, uuids: [discoverySilver.uuid, pickItem.uuid] };
const updateActor = hooks.get("updateActor");
game.users.push({ id: "intruder", isGM: false });
updateActor(playerChar, { flags: { "gathering-professions": { discoveryRequest } } }, {}, "intruder");
await new Promise(resolve => setImmediate(resolve));
assert.equal(veinPage.getFlag("gathering-professions", "discovered").includes(discoverySilver.uuid), false,
  "A non-owner cannot submit discoveries through the GM");
updateActor(playerChar, { flags: { "gathering-professions": { discoveryRequest } } }, {}, "player1");
await new Promise(resolve => setImmediate(resolve));
assert.equal(veinPage.getFlag("gathering-professions", "discovered").includes(discoverySilver.uuid), true,
  "An owned actor can record a carried material from the page table");
assert.equal(veinPage.getFlag("gathering-professions", "discovered").includes(pickItem.uuid), false,
  "Other Items cannot be marked as discoveries");
const assistLib = await import("../scripts/assist.js");
await actor.setFlag("gathering-professions", "assist", { pageUuid: veinPage.uuid, at: 1000 });
actor.unsetFlag = async (scope, key) => { delete actor.flags[scope][key]; };
const clearRequest = { helperUuid: actor.uuid, pageUuid: veinPage.uuid };
await assistLib.handleClearAssist(clearRequest, game.users.find(user => user.id === "intruder"), playerChar);
assert.ok(actor.getFlag("gathering-professions", "assist"), "A non-owner cannot clear another actor's assist");
await assistLib.handleClearAssist(clearRequest, player, playerChar);
assert.equal(actor.getFlag("gathering-professions", "assist"), undefined, "An owned gatherer can clear a consumed assist");
game.users.pop();
const silver = items.find(item => item.name === "Test Silver Ore");
await assert.rejects(api.nodes.build({ name: "Empty", materials: [{ uuid: copper.uuid, weight: 0 }] }), /at least one material/);
await assert.rejects(api.nodes.build({ name: "Bad", materials: [{ uuid: copper.uuid, weight: 1 }], checkType: "skill", checkKey: "NOPE" }), /valid skill/);
const built = await api.nodes.build({ name: "Iron Ridge", sceneId: map.id, profession: "mining", tier: 2,
  materials: [{ uuid: copper.uuid, weight: 3 }, { uuid: silver.uuid, weight: 1 }, { uuid: "Item.none", weight: 0 }],
  draws: 2, time: 4, checkType: "ability", checkKey: "dex", dcModifier: 1, hidden: true, senseRank: 3 });
assert.equal(built.type, "gatherer.gatherer");
assert.equal(built.parent.name, "Nodes — Test Map");
const builtTable = fromUuidSync(built.flags.gatherer.table);
assert.equal(builtTable.formula, "1d4");
assert.deepEqual(builtTable.results.map(r => r.range), [[1, 3], [4, 4]]);
assert.equal(built.flags.gatherer.draws, "2");
assert.equal(built.flags.gatherer.time, "4");
assert.equal(api.nodes.read(built).icon, copper.img);
assert.deepEqual(built.ownership, { default: 0, player1: 0 }, "Hidden: player cannot see it");
const sameJournal = await api.nodes.build({ name: "Iron Ridge 2", sceneId: map.id, materials: [{ uuid: copper.uuid, weight: 1 }] });
assert.equal(sameJournal.parent, built.parent, "One node journal per scene");

// Profession sense: player's character reaches Mining rank 3 → page visible to that player only.
playerChar.flags["gathering-professions"].xp.mining = 300;
await api.nodes.refreshVisibility([built]);
assert.equal(built.ownership.player1, 2);
assert.equal(built.ownership.default, 0);
await api.nodes.setHidden([built], false);
assert.equal(built.ownership.default, 2, "Revealed to everyone");
await api.nodes.setHidden([built], true);
playerChar.flags["gathering-professions"].xp.mining = 0;
await api.nodes.refreshVisibility([built]);
assert.equal(built.ownership.player1, 0, "Sense is lost when the rank drops");

// Pins and depleted tint.
const pin = await api.nodes.placePin(built, map, 100.4, 200.6);
assert.deepEqual([pin.x, pin.y, pin.pageId, pin.entryId, pin.text], [100, 201, built.id, built.parent.id, "Iron Ridge"]);
await built.setFlag("gatherer", "data", { drawsUsed: 2, firstDrawTime: 1000 });
const nodesModule = await import("../scripts/nodes.js");
await nodesModule.refreshPinTint(built);
assert.equal(pin.texture.tint, "#5a5a5a");
game.time.worldTime = 1000 + 4 * 3600;
assert.equal(await nodesModule.autoResetExpired([built]), 1);
assert.equal(built.flags.gatherer.data.drawsUsed, 0);
await built.setFlag("gatherer", "data", { drawsUsed: 1, firstDrawTime: 0 });
assert.equal(await nodesModule.autoResetExpired([built]), 1, "A first pull at world time zero resets normally");
assert.equal(built.flags.gatherer.data.drawsUsed, 0);
await nodesModule.refreshPinTint(built);
assert.equal(pin.texture.tint, "#ffffff");
await built.setFlag("gatherer", "data", { drawsUsed: 1, firstDrawTime: game.time.worldTime });
await api.nodes.reset([built]);
assert.equal(built.flags.gatherer.data.drawsUsed, 0);

// Edit: new weights rewrite the builder table; name syncs to pins.
await api.nodes.update(built, { name: "Iron Ridge (edited)", materials: [{ uuid: silver.uuid, weight: 2 }], draws: 3, time: 0, yieldModifier: -1, hidden: true });
assert.equal(builtTable.formula, "1d2");
assert.equal(builtTable.results.length, 1);
assert.equal(built.flags.gatherer.draws, "3");
assert.equal(built.flags.gatherer.time, "");
assert.equal(api.nodes.read(built).yieldModifier, -1);
assert.equal(pin.text, "Iron Ridge (edited)");

// Linked placements share one table, but Gatherer tracks pulls on each page.
await built.setFlag("gatherer", "data", { drawsUsed: 2, firstDrawTime: 2000 });
await built.setFlag("gathering-professions", "discovered", [copper.uuid]);
const linkedA = await api.nodes.placeLinked(built, map, 300, 400);
const linkedB = await api.nodes.placeLinked(linkedA, map, 500, 600);
assert.equal(linkedA.flags.gatherer.table, built.flags.gatherer.table);
assert.equal(linkedB.flags.gatherer.table, built.flags.gatherer.table);
assert.equal(nodesLib.nodeUsage(linkedA).used, 0, "Linked placement starts with fresh pulls");
assert.equal(linkedA.getFlag("gathering-professions", "discovered"), undefined, "Linked placement starts with separate discoveries");
assert.equal(nodesLib.nodeUsage(built).used, 2, "Source depletion is unchanged");
assert.equal(api.nodes.read(linkedA).linkGroup, built.uuid);
assert.equal(api.nodes.read(linkedB).linkGroup, built.uuid);
await linkedA.setFlag("gatherer", "data", { drawsUsed: 1, firstDrawTime: 2100 });
assert.equal(nodesLib.nodeUsage(linkedB).used, 0, "Linked placements have independent depletion");
const linkedRows = nodeUi.buildListModel(api.nodes.all(), {})
  .flatMap(group => group.rows).filter(row => row.linkGroup === built.uuid);
assert.deepEqual(linkedRows.map(row => row.placementNumber), [1, 2, 3]);
assert.equal(linkedRows[0].groupSize, 3);
const linkedHtml = nodeUi.renderList(nodeUi.buildListModel(api.nodes.all(), {}), {});
assert.match(linkedHtml, /3 linked placements/);
assert.match(linkedHtml, /gp-nm-linked-collapsed/);
assert.match(nodeUi.renderDetail(built, { selected: built.uuid }), /Add linked placement/);
await api.nodes.update(linkedA, { name: "Iron Ridge East", materials: [{ uuid: silver.uuid, weight: 3 }], draws: 3, time: 0 });
assert.equal(builtTable.formula, "1d3", "Material edits rewrite the shared table");
assert.equal(linkedB.flags.gatherer.table, builtTable.uuid);
const pagesBeforeFailedPin = built.parent.pages.length;
const createNotes = map.createEmbeddedDocuments.bind(map);
map.createEmbeddedDocuments = async (type, data) => {
  if (type === "Note") throw new Error("map blocked");
  return createNotes(type, data);
};
await assert.rejects(api.nodes.placeLinked(built, map, 700, 800), /map blocked/);
map.createEmbeddedDocuments = createNotes;
assert.equal(built.parent.pages.length, pagesBeforeFailedPin, "Failed pin placement leaves no orphan page");
const [manual] = await built.parent.createEmbeddedDocuments("JournalEntryPage", [{
  name: "Manual Hidden Stone", type: "gatherer.gatherer", ownership: { default: 0 },
  flags: { gatherer: { table: seamRow.page.flags.gatherer.table, draws: "2" } }
}]);
const manualLinked = await api.nodes.placeLinked(manual, map, 700, 800);
assert.equal(api.nodes.read(manual), null, "Linking a hand-made page does not add node overrides");
assert.equal(manual.ownership.default, 0, "Hand-made page permissions stay unchanged");
assert.equal(manualLinked.ownership.default, 0);
assert.equal(nodesLib.linkGroupFor(manualLinked), manual.uuid);
await api.nodes.delete(manualLinked);
await api.nodes.delete(manual);

// Duplicate (new table) and delete (removes pin and builder table).
const copy = await api.nodes.duplicate(built);
assert.equal(copy.name, "Iron Ridge (edited) (copy)");
assert.notEqual(copy.flags.gatherer.table, built.flags.gatherer.table);
assert.equal(fromUuidSync(copy.flags.gatherer.table).results[0].weight, 3);
const tablesBefore = tables.length;
await api.nodes.delete(built);
assert.equal(map.notes.some(note => note.id === pin.id), false);
assert.equal(tables.length, tablesBefore, "Shared builder table survives while linked pages use it");
assert.equal(built.parent.pages.includes(built), false);
assert.ok(api.nodes.all().includes(copy));
await api.nodes.delete(linkedA);
assert.equal(tables.length, tablesBefore);
await api.nodes.delete(linkedB);
assert.equal(tables.length, tablesBefore - 1, "Shared builder table is deleted with the last linked page");
await api.nodes.delete(copy);
await api.nodes.delete(sameJournal);
await Actor.implementation.deleteDocuments([playerChar.id]);
for (const entry of journal.filter(entry => entry.getFlag("gathering-professions", "nodeJournal"))) await entry.delete();
for (const folder of folders.filter(folder => folder.getFlag("gathering-professions", "nodeFolder"))) await Folder.implementation.deleteDocuments([folder.id]);

// Existing 3-point characters lose only this tree's choices and receive the
// new budget. The GM button can repeat that reset for one character.
const firstSkill = skillPage("Steady Hands");
const secondSkill = skillPage("Light Touch");
const ownedPerk = new Item({ name: firstSkill.name,
  flags: { "gathering-professions": { universalSkill: "steadyHands", perk: { enabled: true } } } }, actor);
const unrelatedItem = new Item({ name: "Unrelated Item" }, actor);
actor.items = [ownedPerk, unrelatedItem];
const otherTreeSkill = { uuid: "JournalEntry.other.Page.other", points: 1 };
await actor.setFlag("skill-tree", "skills", [{ uuid: firstSkill.uuid, points: 1 }, otherTreeSkill]);
await actor.setFlag("skill-tree", `skillTreeSkillPoints.${tree.id}`, 2);
await actor.setFlag("gathering-professions", `treePoints.${tree.id}`, 3);
await actor.setFlag("gathering-professions", `pointRebalanceVersion.${tree.id}`, null);
assert.deepEqual(await api.syncActor(actor), { granted: 0 });
assert.equal(game.modules.get("skill-tree").API.getSkillTreePoints(actor, tree).total, 2);
assert.deepEqual(actor.getFlag("skill-tree", "skills"), [otherTreeSkill]);
assert.deepEqual(actor.items.map(item => item.name), ["Unrelated Item"]);
assert.equal(actor.getFlag("gathering-professions", `pointRebalanceBackup.${tree.id}`).skills.length, 1);
assert.equal(actor.getFlag("gathering-professions", `treePoints.${tree.id}`), 2);
assert.deepEqual(await api.syncActor(actor), { granted: 0 }, "Rebalance runs once");

const secondPerk = new Item({ name: secondSkill.name,
  flags: { "gathering-professions": { universalSkill: "lightTouch", perk: { enabled: true } } } }, actor);
actor.items.push(secondPerk);
await actor.setFlag("skill-tree", "skills", [{ uuid: secondSkill.uuid, points: 1 }, otherTreeSkill]);
await actor.setFlag("skill-tree", `skillTreeSkillPoints.${tree.id}`, 1);
assert.deepEqual(await api.resetSkills(actor, tree), { points: 2, removedSkills: 1, removedItems: 1 });
assert.equal(game.modules.get("skill-tree").API.getSkillTreePoints(actor, tree).total, 2);
assert.deepEqual(actor.getFlag("skill-tree", "skills"), [otherTreeSkill]);
assert.deepEqual(actor.items.map(item => item.name), ["Unrelated Item"]);
assert.equal(actor.getFlag("gathering-professions", `lastSkillResetBackup.${tree.id}`).skills[0].uuid, secondSkill.uuid);
const retryActor = new Actor.implementation({ name: "Retry Gatherer", type: "character",
  flags: { "gathering-professions": { selectedProfession: "mining", xp: { mining: 95 }, treePoints: { [tree.id]: 3 } },
    "skill-tree": { skills: [{ uuid: firstSkill.uuid, points: 1 }], skillTreeSkillPoints: { [tree.id]: 2 } } } });
retryActor.items = [new Item({ name: firstSkill.name,
  flags: { "gathering-professions": { universalSkill: "steadyHands" } } }, retryActor)];
const deleteItems = retryActor.deleteEmbeddedDocuments.bind(retryActor);
retryActor.deleteEmbeddedDocuments = async () => { throw new Error("temporary item deletion failure"); };
await assert.rejects(api.syncActor(retryActor), /temporary item deletion failure/);
assert.equal(retryActor.getFlag("gathering-professions", `pointRebalanceBackup.${tree.id}`).skills.length, 1);
retryActor.deleteEmbeddedDocuments = deleteItems;
assert.deepEqual(await api.syncActor(retryActor), { granted: 0 }, "Interrupted reset resumes from its backup");
assert.equal(game.modules.get("skill-tree").API.getSkillTreePoints(retryActor, tree).total, 2);
assert.equal(retryActor.items.length, 0);
class FakeSkillTreeActor {}
game.modules.get("skill-tree").API.apps = { SkillTreeActor: FakeSkillTreeActor };
foundry.applications.sidebar = { tabs: { ItemDirectory: class {} } };
foundry.applications.api.DialogV2.confirm = async () => true;
globalThis.document = { createElement: () => ({ addEventListener(name, listener) { this[name] = listener; } }) };
const treeApp = new FakeSkillTreeActor();
treeApp.actor = actor;
treeApp.skillTree = tree;
let rerenders = 0;
treeApp.render = async () => { rerenders++; };
let resetButton;
const nav = { querySelector: () => null, appendChild(button) { resetButton = button; } };
const root = { querySelector: selector => selector === ".standard-form > nav" ? nav : null };
hooks.get("renderApplicationV2")(treeApp, [root]);
assert.equal(resetButton?.textContent, "Reset Skills", "GM sees a reset button in the character tree");
await resetButton.click();
assert.equal(rerenders, 1, "Reset refreshes the character tree");
assert.equal(game.modules.get("skill-tree").API.getSkillTreePoints(actor, tree).total, 2);
game.user.isGM = false;
resetButton = null;
hooks.get("renderApplicationV2")(treeApp, [root]);
assert.equal(resetButton, null, "Players do not see the reset button");
game.user.isGM = true;

// Gathering content: the module links the gathering tree and builds the tiered
// rare tables itself (once per content version, or on demand).
const treeUuid = tree.uuid;
// A rare fallback pointing at a deleted table is cleared.
await api.setProfessions(Object.values(api.getProfessions()).map(entry => entry.key === "logging" ? { ...entry, rareTable: "RollTable.deleted" } : entry));
await game.settings.set("gathering-professions", "skillTree", { uuid: "", pointsPerRank: 2, startingPoints: 2 });
assert.equal(await api.content.ensure(), null, "Already at the content version: nothing to do");
const report = await api.content.ensure({ force: true });
assert.deepEqual([report.built, report.tree, report.clearedFallbacks, report.rareTables, report.tools, report.conditionDc > 30], [false, "Gathering Skill Tree", 1, 20, 4, true]);
// Gathering tools: a basic tool per profession, required for every gather.
const toolLib = await import("../scripts/nodes.js");
const basicPick = items.find(item => item.name === "Miner's Pick");
assert.deepEqual([basicPick.type, basicPick.system.proficient, basicPick.flags["gathering-professions"].defaultTool], ["tool", 0, "mining"], "Basic tool: no proficiency bonus");
assert.deepEqual(api.getProfessions().mining.tools, [{ uuid: basicPick.uuid, name: "Miner's Pick", img: basicPick.img }]);
assert.deepEqual(api.getProfessions().skinning.tools.map(tool => tool.name), ["Skinning Knife"]);
assert.ok(folders.some(folder => folder.name === "Gathering Tools" && folder.type === "Item"));
const copperNode = { ...toolLib.NODE_DEFAULTS, profession: "mining" };
const barehanded = { name: "Barehanded", items: [] };
const carrying = { name: "Carrying", items: [{ name: "Miner's Pick", uuid: "Actor.c.Item.p", _stats: { duplicateSource: basicPick.uuid }, system: { proficient: 0 } }] };
assert.match(toolLib.nodeGate(barehanded, copperNode).reason, /You need Miner's Pick to gather here/, "No tool: cannot gather");
assert.equal(toolLib.nodeGate(carrying, copperNode).ok, true);
assert.equal(toolLib.bestTool(carrying, copperNode).bonus, 0, "Basic tool adds no bonus");
const checked = toolLib.applyNodeCheck({ ability: "str", modifier: 2, trained: true, die: 4, target: 10 }, carrying, copperNode);
assert.deepEqual([checked.toolName, checked.toolBonus, checked.formula], ["Miner's Pick", 0, "1d20 + 2 + 1d4"], "The pick is the tool that wears on a natural 1");
// A node's own list replaces the profession default (a vein that needs a better pick).
const mithrilPick = { uuid: "Item.mithrilPick", name: "Mithril Pick", img: "" };
const deepVein = { ...copperNode, tools: [mithrilPick] };
assert.match(toolLib.nodeGate(carrying, deepVein).reason, /You need Mithril Pick/);
assert.equal(toolLib.nodeGate({ items: [{ name: "Mithril Pick", system: {} }] }, deepVein).ok, true);
// Adding a better tool to the profession list: the best carried one is used.
await api.setProfessions(Object.values(api.getProfessions()).map(entry => entry.key === "mining" ? { ...entry, tools: [...entry.tools, mithrilPick] } : entry));
const both = { items: [...carrying.items, { name: "Mithril Pick", system: { proficient: 1 } }], system: { attributes: { prof: 3 } } };
assert.equal(toolLib.bestTool(both, copperNode).item.name, "Mithril Pick", "The better (proficient) tool wins");
// Plain Gatherer pages (no node data) take the profession from their table's materials.
assert.equal(toolLib.pageProfession({ flags: { gatherer: { table: result.miningTable } } }, null), "mining");
const mixedTable = { flags: { gatherer: { table: "RollTable.mixed" } } };
const mixedResults = { results: [{ documentUuid: copper.uuid }, { documentUuid: items.find(item => item.name === "Test Moonpetal").uuid }] };
const originalFromUuidSync = globalThis.fromUuidSync;
globalThis.fromUuidSync = uuid => uuid === "RollTable.mixed" ? mixedResults : originalFromUuidSync(uuid);
assert.deepEqual(toolLib.pageProfessions(mixedTable, null), ["mining", "herbalism"], "Mixed tables gate every possible profession");
globalThis.fromUuidSync = originalFromUuidSync;
assert.equal(toolLib.nodeGate(barehanded, null, "mining").ok, false, "Plain pages need the tool too");
assert.equal(toolLib.nodeGate(barehanded, null, "fishing").ok, true, "A profession with no tools needs none");
assert.equal(await api.tools.buildDefaults(), 0, "Professions with tools keep them");
assert.equal(api.skillTreeConfig().uuid, treeUuid, "Existing universal tree linked again");
assert.equal(api.getProfessions().logging.rareTable, "", "Missing fallback table cleared");
assert.equal(api.getProfessions().mining.rareTable, result.rareOre, "Existing fallback table kept");
assert.ok(api.getProfessions().skinning.rareTables.every(Boolean), "Tier tables built");
assert.equal(items.filter(item => item.flags["gathering-professions"]?.rareFind).length, 60);
assert.equal((await api.content.ensure({ force: true })).rareTables, 0, "Rerun builds nothing new");
assert.equal(settings.worldContentVersion, 3);
// A world with no tree gets one built, in "Gathering Skill Tree" folders.
journal.splice(0, journal.length);
await game.settings.set("gathering-professions", "skillTree", { uuid: "", pointsPerRank: 2, startingPoints: 2 });
const fresh = await api.content.ensure({ force: true });
assert.deepEqual([fresh.built, fresh.rareTables], [true, 0], "Built tree; rare tables already set");
const builtTree = journal.find(entry => entry.name === "Gathering Skill Tree");
assert.equal(api.skillTreeConfig().uuid, builtTree.uuid);
assert.equal(folders.find(folder => folder.id === builtTree.folder).name, "Gathering Skill Tree");
// 0.15.0: the GM hub renders every section from saved settings.
{
  const hubLib = await import("../scripts/hub.js");
  const draft = hubLib.initialHubView();
  const mining = draft.professions.find(profession => profession.key === "mining");
  const savedMining = api.getProfessions().mining;
  await api.setProfessions(Object.values(api.getProfessions()).map(entry => entry.key === "mining"
    ? { ...entry, tools: [{ uuid: "Item.newPick", name: "New Pick" }], rareTables: ["RollTable.newRare", ...entry.rareTables.slice(1)] } : entry));
  mining.label = "Renamed Mining";
  const merged = hubLib.professionDraftsForSave(draft).find(entry => entry.key === "mining");
  assert.equal(merged.label, "Renamed Mining");
  assert.equal(merged.tools[0].uuid, "Item.newPick", "Saving Professions keeps tools saved in another tab");
  assert.equal(merged.rareTables[0], "RollTable.newRare", "Saving Professions keeps rare tables saved in another tab");
  await api.setProfessions(Object.values(api.getProfessions()).map(entry => entry.key === "mining" ? savedMining : entry));
  await game.settings.set("gathering-professions", "conditionDc", (await import("../scripts/conditions.js")).defaultConditionDcRows());
  const sections = Object.fromEntries(hubLib.HUB_SECTIONS.map(section => [section.id, hubLib.renderHub({ ...hubLib.initialHubView(section.id), section: section.id })]));
  assert.deepEqual(Object.keys(sections), ["professions", "nodes", "materials", "tree", "tools", "rare", "rules", "conditions"]);
  // Materials: each profession's gathering materials by tier (with nodes) and its rare finds.
  assert.match(sections.materials, /data-act="materials-prof" data-prof="mining"/);
  assert.match(sections.materials, /Test Copper Ore/);
  assert.match(sections.materials, /Mining Rare Finds — Tier 1/);
  assert.match(sections.materials, /Sparkvein Quartz/, "Rare finds listed with the profession");
  assert.match(sections.materials, /33% of draws/);
  const materialsLib = await import("../scripts/materials.js");
  // Node lookup: a Gatherer page whose table drops the material (journals were reset above).
  const index = materialsLib.nodeIndex([{ name: "Copper Vein", flags: { gatherer: { table: result.miningTable } } }, { name: "Deep Silver Seam", flags: { gatherer: { table: tables.find(table => table.name === "Test Silver Seam").uuid } } }]);
  const miningModel = materialsLib.materialsModel("mining", undefined, index);
  const copperEntry = miningModel.gathering[0].materials.find(entry => entry.name === "Test Copper Ore");
  assert.deepEqual(copperEntry.nodes, ["Copper Vein"]);
  assert.deepEqual(miningModel.gathering[2].materials.find(entry => entry.name === "Test Silver Ore").nodes.sort(), ["Copper Vein", "Deep Silver Seam"]);
  assert.deepEqual(materialsLib.materialsModel("mining", undefined, new Map()).gathering[0].materials.find(entry => entry.name === "Test Copper Ore").nodes, [], "No node: flagged");
  assert.equal(miningModel.rare[0].entries.length, 3);
  assert.equal(miningModel.rare[0].fallback, false);
  const herbHtml = hubLib.renderHub({ ...hubLib.initialHubView("materials", { profession: "herbalism" }), section: "materials" });
  assert.match(herbHtml, /Test Moonpetal/);
  assert.doesNotMatch(herbHtml, /Test Copper Ore/, "Only the chosen profession");
  // Rare table edits: add an Item to a tier, reweight, remove; ranges and formula stay valid.
  const tierOne = tables.find(table => table.uuid === miningModel.rare[0].tableUuid);
  const gem = items.find(item => item.name === "Test Star Sapphire");
  assert.equal(await materialsLib.addRareItem("mining", 1, gem), true);
  assert.equal(await materialsLib.addRareItem("mining", 1, gem), false, "No duplicates");
  assert.equal(tierOne.results.length, 4);
  assert.equal(tierOne.formula, "1d4");
  assert.deepEqual(gem.flags["gathering-professions"].rareFind, { profession: "mining", tier: 1 });
  const gemResult = tierOne.results.find(result => result.documentUuid === gem.uuid);
  await materialsLib.setRareWeights(tierOne, { [gemResult.id]: 3 });
  assert.equal(tierOne.formula, "1d6");
  assert.deepEqual(tierOne.results.map(result => result.range), [[1, 1], [2, 2], [3, 3], [4, 6]]);
  await assert.rejects(materialsLib.setRareWeights(tierOne, { [gemResult.id]: 0 }), /Weights/);
  await materialsLib.removeRareResult(tierOne, gemResult.id);
  assert.deepEqual([tierOne.results.length, tierOne.formula], [3, "1d3"]);
  // Assign and unassign a world Item as a material from the browser.
  globalThis.Roll ??= class { static validate(formula) { return /^[\d\sd+]+$/.test(formula); } };
  const pickItem = items.find(item => item.name === "Test Miner's Pick");
  await materialsLib.assignMaterial("mining", 2, pickItem);
  assert.equal(materialsLib.materialsModel("mining").gathering[1].materials.some(entry => entry.name === "Test Miner's Pick"), true);
  await materialsLib.unassignMaterial(pickItem);
  assert.equal(materialsLib.materialsModel("mining").gathering[1].materials.some(entry => entry.name === "Test Miner's Pick"), false);
  for (const html of Object.values(sections)) assert.match(html, /gp-hub-nav-item active/);
  assert.match(sections.professions, /name="p_label_0" value="Mining"/);
  assert.match(sections.professions, /data-act="prof-add"/);
  assert.match(sections.tools, /Miner(&#39;|')s Pick/, "Tool tiles show names, not UUIDs");
  assert.doesNotMatch(sections.tools, />Item\./);
  assert.match(sections.rare, /Mining Rare Finds — Tier 1/);
  assert.equal((sections.rare.match(/class="gp-rare-tier"/g) ?? []).length, 5 * Object.keys(api.getProfessions()).length);
  assert.match(sections.rules, /name="excellentRareBonus"/);
  assert.match(sections.rules, /name="gatherAttemptsPerRest"/);
  assert.match(sections.tree, /name="pointsPerRank"/);
  const conditionsHtml = hubLib.renderHub({ ...hubLib.initialHubView("conditions", { conditionsTab: "dc" }), section: "conditions" });
  assert.match(conditionsHtml, /name="dcg_weather__blizzard"[^>]*value="5"/, "Recommended difficulty values shown");
  if (process.env.GP_PREVIEW) {
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");
    const page = (body, title) => `<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
      <style>body{margin:0;background:#0d0b10;font-family:Signika,Arial,sans-serif;font-size:14px;color:#efe6d8}
      .app{width:1080px;height:760px;margin:10px;border:1px solid #4a3f35;border-radius:6px;display:flex;flex-direction:column;overflow:hidden}
      .app>header{padding:.4rem .6rem;background:#1a1620;border-bottom:1px solid #4a3f35;font-weight:600}
      .window-content{flex:1;min-height:0}
      input,select,button{font:inherit;height:28px} img{border:none} ${css}</style></head>
      <body><div class="app gp-hub-window gathering-professions-ui"><header>${title}</header><div class="window-content">${body}</div></div></body></html>`;
    for (const [id, html] of Object.entries(sections)) fs.writeFileSync(`${process.env.GP_PREVIEW}/hub-${id}.html`, page(html, "Gathering Professions"));
    fs.writeFileSync(`${process.env.GP_PREVIEW}/hub-conditions-dc.html`, page(conditionsHtml, "Gathering Professions"));
    const biomesHtml = hubLib.renderHub({ ...hubLib.initialHubView("conditions", { conditionsTab: "biomes" }), section: "conditions" });
    fs.writeFileSync(`${process.env.GP_PREVIEW}/hub-conditions-biomes.html`, page(biomesHtml, "Gathering Professions"));
  }
}
game.modules.get("skill-tree").active = false;
settings.worldContentVersion = 0;
const noTreeSetup = await api.content.ensure({ force: true });
assert.equal(noTreeSetup.tree, "Skill Tree inactive", "Other world setup runs without Skill Tree");
assert.equal(settings.worldContentVersion, 0, "Tree setup remains due when Skill Tree becomes active");
game.modules.get("skill-tree").active = true;
// Material presets (Kris's Trade Goods, Heliana for skinning): 5 per tier, 3 rare per tier (fake packs).
{
  const presetLib = await import("../scripts/presets.js");
  const materialsLib = await import("../scripts/materials.js");
  assert.deepEqual(presetLib.availablePresets(), [], "Needs Kris's Trade Goods");
  game.modules.set("kctg-5e", { active: true });
  const all = key => { const preset = presetLib.MATERIAL_PRESETS[key]; return [...Object.values(preset.materials), ...Object.values(preset.rare)].flat().map(entry => Array.isArray(entry) ? entry[0] : entry); };
  // Materials per tier (mining T1 adds Rock Salt; skinning T1/T2 add Beast Flesh/Fat for cooking).
  const perTier = { herbalism: [5, 5, 5, 5, 5], mining: [6, 5, 5, 5, 5], logging: [4, 4, 4, 4, 4], skinning: [6, 6, 5, 5, 5] };
  for (const [key, counts] of Object.entries(perTier)) {
    const preset = presetLib.MATERIAL_PRESETS[key];
    assert.deepEqual(Object.values(preset.materials).map(tier => tier.length), counts, `${key}: materials per tier`);
    assert.ok(Object.values(preset.rare).every(tier => tier.length === 3), `${key}: 3 rare finds per tier`);
    assert.equal(new Set(all(key)).size, counts.reduce((sum, count) => sum + count, 0) + 15, `${key}: no item listed twice`);
  }
  const { CUSTOM_ITEMS } = await import("../scripts/customitems.js");
  const refiningLib = await import("../scripts/refining.js");
  const refiningNames = Object.values(refiningLib.REFINING).flatMap(entry => entry.recipes.flatMap(row => [row.output, ...row.inputs.map(([name]) => name)]));
  assert.ok(!["Cedar Plank", "Oak Plank", "Walnut Lumber", "Charcoal", "Pine Tar"].some(name => all("logging").includes(name)), "Planks, lumber, Charcoal, and Pine Tar come from milling, not gathering");
  const heliana = name => /^(Beast|Monstrosity|Dragon) (?!Bones|Scales|Talons)/.test(name);
  const fakePack = (id, packNames) => [id, { title: id, async getIndex() { return packNames.map(name => ({ _id: `id-${name}`, name })); },
    async getDocument(entryId) { const name = entryId.slice(3); return { uuid: `Compendium.${id}.Item.${entryId}`, toObject: () => ({ _id: entryId, name, type: "loot", img: "pack.webp", system: {}, flags: {} }) }; } }];
  const kctgNames = [...new Set([...["herbalism", "mining", "logging", "skinning"].flatMap(all), ...refiningNames])].filter(name => !heliana(name) && !CUSTOM_ITEMS[name] && !refiningLib.GENERATED[name]);
  const helianaNames = type => all("skinning").filter(name => name.startsWith(`${type} `) && heliana(name));
  game.packs = new Map([fakePack("kctg-5e.kctg-dnd5e", kctgNames),
    ...["Beast", "Monstrosity", "Dragon"].map(type => fakePack(`helianas-harvest-compendium.${type.toLowerCase()}`, helianaNames(type)))]);
  assert.deepEqual(presetLib.availablePresets().map(entry => entry.key).sort(), ["herbalism", "logging", "mining"], "Skinning also needs Heliana's Harvest");
  game.modules.set("helianas-harvest-compendium", { active: true });
  assert.deepEqual(presetLib.availablePresets().map(entry => entry.key).sort(), ["herbalism", "logging", "mining", "skinning"]);
  // Reuse an existing herb; an old herbalism material not in the preset gets unassigned.
  const [existingClover] = await globalThis.Item.implementation.create([{ name: "Clover", type: "loot", img: "clover.webp", system: {}, flags: {} }]);
  const [oldHerb] = await globalThis.Item.implementation.create([{ name: "Marjoram", type: "loot", img: "m.webp", system: {}, flags: { "gathering-professions": { material: { enabled: true, profession: "herbalism", tier: 1, baseYield: "1" } } } }]);
  const report = await presetLib.applyMaterialPreset("herbalism");
  assert.deepEqual([report.materials, report.rare, report.imported], [25, 15, 39]);
  assert.ok(report.unassigned >= 1);
  assert.equal(oldHerb.flags["gathering-professions"].material.enabled, false, "Leftover unassigned, Item kept");
  assert.ok(items.includes(oldHerb));
  assert.equal(items.filter(item => item.name === "Clover").length, 1, "Existing Clover reused");
  assert.equal(existingClover.flags["gathering-professions"].material.tier, 1);
  const herbModel = materialsLib.materialsModel("herbalism");
  assert.deepEqual(herbModel.gathering.map(group => group.materials.length), [5, 5, 5, 5, 5]);
  assert.deepEqual(herbModel.rare.map(group => group.entries.map(entry => entry.name).sort()), Object.values(presetLib.MATERIAL_PRESETS.herbalism.rare).map(tier => [...tier].sort()));
  assert.equal(folders.find(folder => folder.id === items.find(item => item.name === "Silphium").folder).name, "Herbalism", "Rare finds go to Rare Finds/Herbalism");
  // Mining: the alias reuses a world "Mithril"; other mining materials are unassigned.
  const [mithril] = await globalThis.Item.implementation.create([{ name: "Mithril", type: "loot", img: "mi.webp", system: {}, flags: {} }]);
  const mining = await presetLib.applyMaterialPreset("mining");
  assert.deepEqual([mining.materials, mining.rare], [26, 15]);
  assert.equal(mithril.flags["gathering-professions"].material.tier, 5, "Mithril accepted for Mithral");
  assert.equal(items.filter(item => item.name === "Mithral").length, 0);
  assert.deepEqual(materialsLib.materialsModel("mining").gathering.map(group => group.materials.length), [6, 5, 5, 5, 5], "Only the preset's mining materials remain assigned");
  assert.equal((await presetLib.applyMaterialPreset("mining")).imported, 0, "Second run reuses everything");
  // Logging and skinning; skinning imports from Kris's and three Heliana packs.
  assert.deepEqual([(await presetLib.applyMaterialPreset("logging")).materials, materialsLib.materialsModel("logging").gathering.map(group => group.materials.length)], [20, [4, 4, 4, 4, 4]]);
  const seed = items.find(item => item.name === "Seed of the Old Grove");
  assert.equal(seed.flags["gathering-professions"].customItem, "Seed of the Old Grove", "Forest finds are created by the module");
  assert.equal(seed.img, CUSTOM_ITEMS["Seed of the Old Grove"].img);
  assert.equal(seed.flags["gathering-professions"].rareFind.tier, 5);
  const skinning = await presetLib.applyMaterialPreset("skinning");
  assert.deepEqual([skinning.materials, skinning.rare], [27, 15]);
  assert.match(items.find(item => item.name === "Dragon Breath Sac")._stats.compendiumSource, /^Compendium\.helianas-harvest-compendium\.dragon\./, "Found in the later Heliana pack");
  assert.ok(items.some(item => item.name === "Beast Pelt" && item.flags["gathering-professions"].material.tier === 2), "Heliana beast part imported and assigned");
  // Refining: every preset material refines into something.
  for (const key of ["mining", "logging", "skinning"]) {
    const inputs = new Set(refiningLib.refiningRecipes(key).flatMap(row => row.inputs.map(([name]) => name)));
    const materials = all(key).filter(name => !Object.values(presetLib.MATERIAL_PRESETS[key].rare).flat().includes(name));
    assert.deepEqual(materials.filter(name => !inputs.has(name) && !inputs.has(refiningLib.canonicalName(name))), [], `${key}: every material has a refining recipe`);
  }
  const stoneBrick = refiningLib.refiningRecipes("mining").filter(row => row.output === "Stone Brick");
  assert.deepEqual(stoneBrick.map(row => row.inputs[0]), [["Stone", 3], ["Cobblestones", 2], ["Granite", 1]], "Several materials share one product");
  assert.ok(refiningLib.refiningRecipes("mining").some(row => row.inputs.some(([name]) => name === "Mithril")), "Recipes use the world's spelling (Mithril)");
  assert.equal(new Set(refiningLib.refiningRecipes("mining").map(row => row.id)).size, refiningLib.refiningRecipes("mining").length, "Recipe ids are unique");
  // The GM prepares every product (imported, generated, or dried), visible to players.
  const prepared = await api.refining.prepare();
  assert.deepEqual(prepared.missing, [], "Every input and product exists");
  const coke = items.find(item => item.name === "Coke");
  assert.equal(coke.flags["gathering-professions"].refinedFrom, "Coal");
  assert.equal(coke.flags["gathering-professions"].material, undefined, "Generated items are not gathering materials");
  assert.equal(coke.ownership.default, 2);
  assert.equal(items.find(item => item.name === "Copper Ingot").ownership.default, 2, "Imported products are shared with players");
  assert.ok(items.some(item => item.name === "Mithral Ingot") && items.some(item => item.name === "Dried Clover"));
  assert.equal((await api.refining.prepare()).created, 0, "Preparing again creates nothing");
  // Discovery: a recipe is known once the party has had every input.
  settings.discoveredItems = [];
  const recipesUi = await import("../scripts/recipes-ui.js");
  const [smith] = await Actor.implementation.create([{ name: "Smith", type: "character", hasPlayerOwner: true, system: { abilities: { str: { mod: 2 } } }, flags: {}, items: [] }]);
  await smith.createEmbeddedDocuments("Item", [{ name: "Cobblestones", type: "loot", system: { quantity: 5 } }, { name: "Copper Ore", type: "loot", system: { quantity: 9 } }, { name: "Coal", type: "loot", system: { quantity: 4 } }]);
  assert.deepEqual((await refiningLib.backfillDiscoveries()).sort(), ["Coal", "Cobblestones", "Copper Ore"]);
  let model = recipesUi.buildRecipesModel(smith, { tab: "mining" });
  const brickCard = model.products.find(group => group.name === "Stone Brick");
  assert.deepEqual([brickCard.recipes.length, brickCard.hidden], [1, 2], "Stone and Granite recipes stay hidden until found");
  assert.deepEqual(model.products.map(group => group.name), ["Coke", "Copper Ingot", "Stone Brick"]);
  const copperRow = model.products.find(group => group.name === "Copper Ingot").recipes[0];
  assert.deepEqual([copperRow.max, copperRow.inputs.map(input => input.have)], [4, [9, 4]]);
  assert.equal(model.tabs.find(tab => tab.key === "mining").known, 3);
  const gmModel = recipesUi.buildRecipesModel(null, { isGM: true, tab: "mining" });
  assert.equal(gmModel.products.find(group => group.name === "Stone Brick").recipes.length, 3, "The GM sees undiscovered recipes");
  const html = recipesUi.renderRecipesWindow(model, { characters: [smith] });
  assert.match(html, /2 more undiscovered/);
  assert.match(html, /data-act="craft" data-recipe="mining:copper-ingot:2-copper-ore\+1-coal"/);
  assert.match(html, /> Smelt</);
  if (process.env.GP_PREVIEW) {
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");
    const shell = body => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><style>
      body{margin:0;background:#15121a;color:#efe6d8;font-family:Signika,Arial,sans-serif;font-size:14px} button{font:inherit}
      .application{width:640px;height:720px;margin:10px;border:1px solid #4a3f35;border-radius:6px;display:flex;flex-direction:column}
      .window-content{flex:1;min-height:0;display:flex;flex-direction:column}${css}</style></head><body>
      <div class="application gathering-professions-ui gp-recipes-window"><div class="window-content">${body}</div></div></body></html>`;
    await refiningLib.recordDiscoveries(["Stone", "Granite", "Sandstone", "Iron Ore", "Tin", "Copper Ingot", "Tin Ingot"]);
    fs.writeFileSync(`${process.env.GP_PREVIEW}/recipes-window.html`, shell(recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { tab: "mining" }), { characters: [smith] })));
    { const draft = recipesUi.editorDraft(refiningLib.refiningRecipes("mining").find(row => row.output === "Glass"), "mining"); draft.picker = "0";
      fs.writeFileSync(`${process.env.GP_PREVIEW}/recipes-edit.html`, shell(recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }), { characters: [smith], editing: draft, editorItems: recipesUi.itemOptions("mining", "") }))); }
    fs.writeFileSync(`${process.env.GP_PREVIEW}/recipes-gm.html`, shell(recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }), { characters: [smith] })));
    settings.discoveredItems = ["Coal", "Cobblestones", "Copper Ore"];
  }
  // Crafting: one roll per batch.
  const originalRoll = globalThis.Roll;
  const rolls = [];
  globalThis.Roll = class { constructor(formula) { this.formula = formula; }
    async evaluate() { const [d20, total] = rolls.shift(); this.total = total; this.dice = [{ total: d20 }]; return this; }
    async toMessage(data) { this.message = data; return data; } };
  globalThis.ChatMessage = { getSpeaker: () => ({}) };
  const count = name => smith.items.filter(item => item.name === name).reduce((sum, item) => sum + item.system.quantity, 0);
  const copperId = copperRow.id;
  await assert.rejects(api.refining.craft(smith, copperId, 5), /not have enough/);
  rolls.push([12, 16]);
  let result = await api.refining.craft(smith, copperId, 2);
  assert.deepEqual([result.degree, result.made, result.xp], ["excellent", 3, 6], "Batch of 2, Excellent +1; 3 XP per unit");
  assert.deepEqual([count("Copper Ore"), count("Coal"), count("Copper Ingot")], [5, 2, 0], "Inputs consumed; timed products not here yet");
  assert.equal(result.job.minutes, 60, "30 minutes per unit at tier 1");
  assert.equal(api.refining.jobs(smith).length, 1);
  assert.deepEqual(await refiningLib.deliverDueJobs(smith, game.time.worldTime + 59 * 60), [], "Not ready before its time");
  await refiningLib.deliverDueJobs(smith, game.time.worldTime + 3600);
  assert.deepEqual([count("Copper Ingot"), api.refining.jobs(smith).length], [3, 0], "Delivered after an hour of world time");
  rolls.push([8, 8]);
  result = await api.refining.craft(smith, copperId, 1);
  assert.deepEqual([result.degree, count("Copper Ore"), count("Coal")], ["partial", 5, 2], "Near miss keeps the materials");
  rolls.push([3, 4]);
  result = await api.refining.craft(smith, copperId, 2);
  assert.deepEqual([result.degree, count("Copper Ore"), count("Coal")], ["failed", 3, 1], "Bad failure: half of 4 ore and 2 coal lost");
  settings.rules = { ...(settings.rules ?? {}), craftingTimed: false };
  rolls.push([20, 9]);
  result = await api.refining.craft(smith, copperId, 1);
  assert.deepEqual([result.degree, result.job, count("Copper Ingot")], ["masterful", null, 6], "Natural 20 Masterful +2; instant when timing is off");
  delete settings.rules.craftingTimed;
  // Refining has its own DC and XP per tier (default: gathering DC, half the gathering XP).
  const rulesLib = await import("../scripts/rules.js");
  assert.deepEqual([rulesLib.activeRules().refineDc, rulesLib.activeRules().refineXp], [[10, 14, 18, 23, 28], [3, 5, 10, 18, 30]]);
  settings.rules = { ...(settings.rules ?? {}), refineXpPercent: 0 };
  assert.deepEqual(rulesLib.activeRules().refineXp, [0, 0, 0, 0, 0], "An old 0% setting seeds zero refining XP");
  settings.rules = { ...settings.rules, refineDc: [6, 14, 18, 23, 28], refineXp: [7, 5, 10, 18, 30] };
  assert.equal(refiningLib.refineCheckFor(smith, refiningLib.findRecipe(copperId)).target, 6, "Refining uses its own DC");
  await smith.createEmbeddedDocuments("Item", [{ name: "Coal", type: "loot", system: { quantity: 3 } }, { name: "Copper Ore", type: "loot", system: { quantity: 4 } }]);
  rolls.push([10, 12]);
  result = await api.refining.craft(smith, copperId, 1);
  assert.equal(result.xp, 7, "Refining uses its own XP");
  delete settings.rules.refineDc; delete settings.rules.refineXp; delete settings.rules.refineXpPercent;
  settings.discoveredItems = [];
  smith.isOwner = true;
  await assert.rejects((async () => { game.user.isGM = false; try { await api.refining.craft(smith, copperId, 1); } finally { game.user.isGM = true; } })(), /not discovered/, "Players cannot craft undiscovered recipes");
  // GM: learned / unlearned / auto.
  settings.discoveredItems = ["Coal", "Cobblestones", "Copper Ore"];
  const glassId = refiningLib.refiningRecipes("mining").find(row => row.output === "Glass").id;
  const brickFromStone = refiningLib.refiningRecipes("mining").find(row => row.output === "Stone Brick" && row.inputs[0][0] === "Stone").id;
  await api.refining.setLearned(glassId, "learned");
  await api.refining.setLearned(copperId, "unlearned");
  model = recipesUi.buildRecipesModel(smith, { tab: "mining" });
  assert.ok(model.products.some(group => group.name === "Glass"), "Learned without the ingredients");
  assert.ok(!model.products.some(group => group.name === "Copper Ingot"), "Unlearned although the party has the ingredients");
  await api.refining.setLearned(copperId, "auto");
  assert.deepEqual(settings.recipeLearned, { [glassId]: "learned" }, "Auto removes the override");
  await assert.rejects(api.refining.setLearned(glassId, "maybe"), /Auto, Learned, or Unlearned/);
  // GM: edit a built-in (id kept), disable it, reset it.
  await assert.rejects(api.refining.update(brickFromStone, { tier: 1, output: "Stone Brick", quantity: 1, inputs: [["Nothing Real", 2]] }), /No world Item is named "Nothing Real"/);
  await api.refining.update(brickFromStone, { tier: 2, output: "Stone Brick", quantity: 2, inputs: [["Stone", 4]] });
  const edited = refiningLib.findRecipe(brickFromStone);
  assert.deepEqual([edited.tier, edited.quantity, edited.inputs, edited.edited], [2, 2, [["Stone", 4]], true], "Edits keep the recipe id");
  await api.refining.disable(brickFromStone);
  assert.equal(refiningLib.findRecipe(brickFromStone), null, "Disabled recipes are gone for crafting");
  await api.refining.setLearned(brickFromStone, "learned");
  assert.ok(!recipesUi.buildRecipesModel(smith, { tab: "mining" }).products.find(group => group.name === "Stone Brick").recipes.some(row => row.id === brickFromStone), "Players never see a disabled recipe");
  const gmBricks = recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }).products.find(group => group.name === "Stone Brick").recipes;
  assert.ok(gmBricks.find(row => row.id === brickFromStone).disabled, "The GM still sees it, marked disabled");
  await api.refining.reset(brickFromStone);
  assert.deepEqual(refiningLib.findRecipe(brickFromStone).inputs, [["Stone", 3]], "Reset restores the default");
  await api.refining.setLearned(brickFromStone, "auto");
  // GM: their own recipe.
  await assert.rejects(api.refining.create({ profession: "mining", tier: 1, output: "Copper Ingot", quantity: 1, inputs: [] }), /at least one ingredient/);
  await assert.rejects(api.refining.create({ profession: "mining", tier: 1, output: "Copper Ingot", quantity: 1, inputs: [["Copper Ingot", 1]] }), /its own product/);
  const mine = await api.refining.create({ profession: "mining", tier: 1, output: "Copper Ingot", quantity: 3, inputs: [["Copper Ore", 5]] });
  assert.match(mine.id, /^mining:custom-/);
  const customRow = recipesUi.buildRecipesModel(smith, { tab: "mining" }).products.find(group => group.name === "Copper Ingot").recipes.find(row => row.id === mine.id);
  assert.ok(customRow?.custom, "The party knows it (they have Copper Ore) and it is grouped with Copper Ingot");
  const gmHtml = recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }), { characters: [smith] });
  assert.match(gmHtml, /data-act="new-recipe"/);
  assert.match(gmHtml, new RegExp(`data-act="delete-recipe" data-recipe="${mine.id}"`));
  assert.match(gmHtml, /data-learn="mining:glass:/);
  const draft = recipesUi.editorDraft(refiningLib.findRecipe(mine.id), "mining");
  assert.deepEqual(recipesUi.draftFields(draft), { profession: "mining", tier: 1, output: "Copper Ingot", quantity: 3, minutes: null, inputs: [["Copper Ore", 5]] });
  // Times: tier defaults from Rules, a recipe's own time, blank = default.
  assert.equal(refiningLib.recipeMinutes(refiningLib.findRecipe(mine.id)), 30, "Tier 1 default");
  settings.rules = { ...(settings.rules ?? {}), refineMinutes: [45, 60, 120, 240, 720] };
  assert.equal(refiningLib.recipeMinutes(refiningLib.findRecipe(mine.id)), 45, "Tier defaults come from Rules");
  await api.refining.update(mine.id, { ...recipesUi.draftFields(draft), minutes: 10 });
  assert.equal(refiningLib.recipeMinutes(refiningLib.findRecipe(mine.id)), 10, "A recipe's own time wins");
  await assert.rejects(api.refining.update(mine.id, { ...recipesUi.draftFields(draft), minutes: -5 }), /whole minutes/);
  await api.refining.update(brickFromStone, { tier: 1, output: "Stone Brick", quantity: 1, inputs: [["Stone", 3]], minutes: 0 });
  const instantRow = recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }).products.find(group => group.name === "Stone Brick").recipes.find(row => row.id === brickFromStone);
  assert.deepEqual([instantRow.minutes, instantRow.ownTime], [0, true], "Built-ins can have their own time (0 = instant)");
  assert.match(recipesUi.renderEditor(recipesUi.editorDraft(refiningLib.findRecipe(brickFromStone), "mining")), /data-draft="minutes"[^>]*value="0"/);
  await api.refining.reset(brickFromStone);
  delete settings.rules.refineMinutes;
  draft.picker = "0";
  const groups = recipesUi.itemOptions("mining", "cop");
  assert.deepEqual(groups.map(group => group.label), ["Mining materials", "Refined goods", "Other items"].filter(label => groups.some(group => group.label === label)));
  assert.ok(groups[0].items.some(item => item.name === "Copper Ore") && groups.find(group => group.label === "Refined goods").items.some(item => item.name === "Copper Ingot"), "Picker groups materials and refined goods");
  assert.ok(groups.every(group => group.items.every(item => item.name.toLowerCase().includes("cop"))), "Picker search filters");
  const editorHtml = recipesUi.renderEditor(draft, groups);
  assert.match(editorHtml, /data-act="choose" data-name="Copper Ore"/);
  assert.match(editorHtml, /data-drop-slot="output"/, "Slots still accept dragged Items");
  const openEditor = recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }), { characters: [smith], editing: draft, editorItems: groups });
  assert.ok(openEditor.indexOf("gp-rw-edit") > openEditor.indexOf(`data-recipe="${mine.id}"`), "The editor opens under its recipe");
  await api.refining.disable(brickFromStone);
  assert.match(recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { isGM: true, tab: "mining" }), { characters: [smith] }), /gp-rw-enable[^>]*data-recipe="[^"]*"[^>]*>.*Enable/s, "Disabled recipes show an Enable button");
  await api.refining.disable(brickFromStone, false);
  assert.ok(refiningLib.findRecipe(brickFromStone), "Enable brings it back");
  await api.refining.setLearned(mine.id, "learned");
  await api.refining.delete(mine.id);
  assert.deepEqual([settings.customRecipes, settings.recipeLearned[mine.id]], [[], undefined], "Deleting removes the recipe and its learned state");
  await api.refining.setLearned(glassId, "auto");
  // Other modules add tabs through api.recipes.register (crafting professions).
  const experiments = [];
  api.recipes.register({
    key: "testsmith", label: "Test Smith", verb: "Smithing", action: "Forge", icon: "fa-hammer", order: 50, perCharacter: true,
    rollLabel: "Test Smith check", hiddenWord: "unknown", emptyText: "Learn recipes first.",
    visible: (actor, isGM) => isGM || actor?.name === "Smith",
    recipes: () => [{ id: "testsmith:nails", tier: 1, output: "Copper Ingot", quantity: 10, inputs: [["Coal", 1]] }, { id: "testsmith:secret", tier: 1, output: "Coke", quantity: 1, inputs: [["Coal", 5]] }],
    isKnown: row => row.id === "testsmith:nails",
    learnState: row => (row.id === "testsmith:nails" ? "learned" : "unlearned"),
    setLearned: () => {}, check: () => ({ target: 12, modifier: 3, die: 4 }),
    blocked: (_actor, row) => (row.id === "testsmith:nails" ? null : "Needs Test Smith rank 2"),
    minutes: () => 60, defaultMinutes: () => 60, craft: () => {},
    gm: { scroll: () => null },
    experiment: async (_actor, names) => { experiments.push(names); return { learned: null, warm: true, message: "Something here could work…" }; },
    carried: () => [{ id: "scroll1", name: "Recipe: Coke", img: "s.webp", note: "" }, { id: "scroll2", name: "Recipe: Nails", img: "s.webp", note: "Already known", disabled: true }],
    useCarried: () => {}
  });
  const smithModel = recipesUi.buildRecipesModel(smith, { tab: "testsmith" });
  assert.ok(smithModel.tabs.some(tab => tab.key === "testsmith") && smithModel.experiment, "A registered provider becomes a tab with an experiment panel");
  assert.deepEqual(smithModel.products.map(group => [group.name, group.hidden]), [["Copper Ingot", 0], ["Coke", 1]].filter(([, hidden]) => !hidden), "Unknown recipes stay hidden from players");
  const smithHtml = recipesUi.renderRecipesWindow(smithModel, { characters: [smith], experiment: { names: ["Coal"] } });
  assert.match(smithHtml, /data-act="exp-try"/);
  assert.match(smithHtml, /data-act="use-carried" data-item="scroll1"\s+title/, "Carried scrolls get a Learn button");
  assert.match(smithHtml, /data-item="scroll2" disabled/, "Scrolls that cannot be used are disabled with a reason");
  assert.match(smithHtml, /> Forge</);
  assert.match(smithHtml, /Test Smith check/);
  const otherActor = { id: "x", name: "Other", items: [], getFlag: () => undefined };
  assert.ok(!recipesUi.buildRecipesModel(otherActor, { tab: "testsmith" }).tabs.some(tab => tab.key === "testsmith"), "Hidden from characters without the profession");
  const gmSmith = recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(null, { isGM: true, tab: "testsmith" }), { characters: [smith] });
  assert.match(gmSmith, /data-learn="testsmith:nails" disabled/, "Per-character learning needs a chosen character");
  assert.match(gmSmith, /data-act="make-scroll"/);
  assert.match(recipesUi.renderRecipesWindow(recipesUi.buildRecipesModel(smith, { isGM: true, tab: "testsmith" }), { characters: [smith] }), /Needs Test Smith rank 2/, "Blocked reasons show for the chosen character");
  assert.deepEqual(recipesUi.inventoryChoices(smith).find(entry => entry.name === "Copper Ingot")?.quantity, smith.items.filter(item => item.name === "Copper Ingot").reduce((sum, item) => sum + item.system.quantity, 0));
  api.recipes.unregister("testsmith");
  globalThis.Roll = originalRoll;
  game.modules.delete("helianas-harvest-compendium");
  game.modules.delete("kctg-5e");
}
console.log("PASS: sample world, gathering content setup, gathering window, Node Manager view, Node Builder, visibility and sense, pins, tint, timers, edit, duplicate, delete.");
