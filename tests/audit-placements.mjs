// Offline regression proof: placement ownership, fresh copies, and window hooks.
import assert from "node:assert/strict";

const ID = "gathering-professions";
let nextId = 0;
const documents = new Map();
const journals = [], scenes = [], folders = [], tables = [];
const settings = { conditionDc: [{ type: "biome", value: "desert", dc: 4, profession: "" }] };
class Document {
  constructor(data, parent = null, kind = "JournalEntryPage") {
    Object.assign(this, structuredClone(data));
    this.id = `${kind}${++nextId}`;
    this.uuid = parent ? `${parent.uuid}.${kind}.${this.id}` : `${kind}.${this.id}`;
    this.parent = parent;
    this.flags ??= {};
    this.documentName = kind;
    this.pages = [];
    this.notes = [];
    documents.set(this.uuid, this);
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = structuredClone(value); }
  toObject() {
    return structuredClone({ name: this.name, type: this.type, flags: this.flags, ownership: this.ownership });
  }
  async createEmbeddedDocuments(kind, data) {
    const made = data.map(entry => new Document(entry, this, kind));
    this[kind === "Note" ? "notes" : "pages"].push(...made);
    return made;
  }
  async delete() {
    this.parent.pages.splice(this.parent.pages.indexOf(this), 1);
    documents.delete(this.uuid);
  }
}
const implementation = (kind, collection) => ({ async create(data) {
  const doc = new Document(data, null, kind);
  collection.push(doc);
  return doc;
} });
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
globalThis.JournalEntry = { implementation: implementation("JournalEntry", journals) };
globalThis.Folder = { implementation: implementation("Folder", folders) };
globalThis.RollTable = { implementation: implementation("RollTable", tables) };
globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;
globalThis.fromUuid = async uuid => fromUuidSync(uuid);
scenes.get = id => scenes.find(scene => scene.id === id);
const actors = [];
actors.get = id => actors.find(actor => actor.id === id);
globalThis.game = { user: { isGM: true }, users: [], journal: journals, scenes, folders, tables, actors,
  settings: { get: (_scope, key) => settings[key] }, modules: new Map(), time: { worldTime: 0 } };
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.ui = { notifications: { error(message) { throw new Error(message); } } };

const hooks = new Map();
globalThis.Hooks = {
  on(name, callback) { const id = ++nextId; (hooks.get(name) ?? hooks.set(name, new Map()).get(name)).set(id, callback); return id; },
  off(name, id) { hooks.get(name)?.delete(id); }
};
const emit = (name, ...args) => { for (const callback of hooks.get(name)?.values() ?? []) callback(...args); };
const timers = new Map();
globalThis.setTimeout = callback => { const id = ++nextId; timers.set(id, callback); return id; };
globalThis.clearTimeout = id => timers.delete(id);
async function flush() {
  // Only run the current batch; a render-time event may queue the next batch.
  for (const [id, callback] of [...timers]) { timers.delete(id); await callback(); }
}
let duringRender = null;
globalThis.foundry = { applications: { api: { ApplicationV2: class {
  constructor() { this.rendered = false; this.renders = 0; this.element = { addEventListener() {} }; }
  async render() {
    this.renders++;
    this.html = await this._renderHTML();
    if (!this.rendered) { this.rendered = true; this._onFirstRender(); }
    const callback = duringRender; duringRender = null; callback?.();
    return this;
  }
  async close() { this._onClose(); this.rendered = false; }
} } } };

const nodes = await import("../scripts/nodes.js");
const conditions = await import("../scripts/conditions.js");
const gather = await import("../scripts/gather-ui.js");
const forest = new Document({ name: "Forest", flags: { [ID]: { biome: "forest" } } }, null, "Scene");
const desert = new Document({ name: "Desert", flags: { [ID]: { biome: "desert" } } }, null, "Scene");
scenes.push(forest, desert);
const material = new Document({ name: "Ore", flags: { [ID]: { material: {
  profession: "mining", conditions: [{ type: "biome", value: "desert", multiplier: 0 }]
} } } }, null, "Item");
const table = new Document({ name: "Loot", results: [{ documentUuid: material.uuid, name: material.name, weight: 1 }] }, null, "RollTable");
tables.push(table);
const sourceJournal = await nodes.sceneJournal(forest.id);
const [source] = await sourceJournal.createEmbeddedDocuments("JournalEntryPage", [{
  name: "Ore node", type: nodes.GATHERER_PAGE_TYPE, ownership: { default: 0 },
  flags: { gatherer: { table: table.uuid, draws: "3", time: "8", data: { drawsUsed: 3, firstDrawTime: 0 } },
    [ID]: { node: { ...nodes.NODE_DEFAULTS, profession: "mining", tools: [{ uuid: "Item.pick", name: "Pick" }] },
      discovered: [material.uuid], lastPull: { actorUuid: "Actor.reserved", expires: Date.now() + 60000 }, refillCut: 50 } }
}]);
const original = source.toObject();
const linked = await nodes.placeLinkedNode(source, desert, 10, 20);
assert.equal(linked.parent.getFlag(ID, "nodeJournal"), desert.id, "Placement belongs to destination scene journal");
assert.equal(conditions.nodeScene(linked, nodes.pinsFor), desert);
assert.equal(conditions.nodeScene(source, nodes.pinsFor), forest);
assert.equal(linked.flags.gatherer.table, source.flags.gatherer.table);
assert.equal(nodes.linkGroupFor(linked), source.uuid);
assert.deepEqual(linked.ownership, source.ownership);
assert.equal(nodes.nodeUsage(linked).time, 8);
assert.equal(nodes.nodeUsage(linked).used, 0);
for (const key of ["lastPull", "refillCut", "discovered"]) assert.equal(linked.flags[ID][key], undefined);
assert.deepEqual(source.flags.gatherer, original.flags.gatherer);
assert.deepEqual(source.flags[ID].lastPull, original.flags[ID].lastPull);
assert.equal(source.flags[ID].refillCut, 50);
const model = gather.buildGatherModel(linked, null, { isGM: true });
assert.equal(model.conditions.find(chip => chip.type === "biome").key, "desert");
assert.equal(model.empty, true, "Destination biome blocks loot");
assert.equal(conditions.conditionDcModifier(conditions.currentConditions({ scene: conditions.nodeScene(linked, nodes.pinsFor) }), "mining").total, 4);
assert.equal(gather.buildGatherModel(source, null, { isGM: true }).empty, false);
const linkedAgain = await nodes.placeLinkedNode(linked, forest, 30, 40);
assert.equal(conditions.nodeScene(linkedAgain, nodes.pinsFor), forest);
assert.equal(nodes.linkGroupFor(linkedAgain), source.uuid);
const manualCopy = await nodes.duplicateNode(source);
for (const key of ["lastPull", "refillCut", "nodeLinkGroup"]) assert.equal(manualCopy.flags[ID][key], undefined);
assert.equal(nodes.linkGroupFor(manualCopy), "");
assert.equal(nodes.nodeUsage(manualCopy).used, 0);
assert.equal(nodes.nodeUsage(manualCopy).time, 8);
source.flags[ID].node.built = true;
source.flags[ID].node.tableUuid = table.uuid;
const builtCopy = await nodes.duplicateNode(source);
assert.notEqual(builtCopy.flags.gatherer.table, table.uuid);
assert.equal(nodes.nodeUsage(builtCopy).time, 8, "Builder duplicate keeps base timer, not temporary reduction");
assert.equal(builtCopy.flags[ID].lastPull, undefined);
assert.equal(builtCopy.flags[ID].refillCut, undefined);
const destinationJournal = linked.parent;
const beforeFailure = destinationJournal.pages.length;
const createNotes = desert.createEmbeddedDocuments.bind(desert);
desert.createEmbeddedDocuments = async () => { throw new Error("Pin failed"); };
await assert.rejects(nodes.placeLinkedNode(source, desert, 10, 20), /Pin failed/);
assert.equal(destinationJournal.pages.length, beforeFailure, "Failed destination pin removes only its new page");
desert.createEmbeddedDocuments = createNotes;
game.user.isGM = false;
await assert.rejects(nodes.placeLinkedNode(source, desert, 10, 20), /Only the GM/);
await assert.rejects(nodes.duplicateNode(source), /Only the GM/);
game.user.isGM = true;

const app = await gather.openGatheringWindow(linked);
app.view.actorId = "chosen";
const chosenItem = { parent: { id: "chosen" }, uuid: "Actor.chosen.Item.pick" };
const unrelatedItem = { parent: { id: "other" }, uuid: "Actor.other.Item.pick" };
async function refreshes(name, ...args) {
  const before = app.renders;
  emit(name, ...args); await flush();
  assert.equal(app.renders, before + 1, `${name} refreshes relevant window`);
}
async function ignores(name, ...args) {
  const before = app.renders;
  emit(name, ...args); await flush();
  assert.equal(app.renders, before, `${name} ignores unrelated changes`);
}
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  await refreshes(hook, chosenItem); await ignores(hook, unrelatedItem);
}
await refreshes("updateItem", material);
await refreshes("updateItem", { uuid: "Item.pick", name: "Renamed pick" });
await ignores("updateItem", { uuid: "Item.unrelated", name: "Unrelated" });
for (const hook of ["updateRollTable", "deleteRollTable"]) {
  await refreshes(hook, table); await ignores(hook, { uuid: "RollTable.other" });
}
for (const hook of ["createTableResult", "updateTableResult", "deleteTableResult"]) {
  await refreshes(hook, { parent: table }); await ignores(hook, { parent: { uuid: "RollTable.other" } });
}
for (const key of ["rules", "professions", "biomes", "conditionOverrides", "conditionDc", "skillTree"]) await refreshes("updateSetting", { key: `${ID}.${key}` });
await refreshes("updateSetting", { key: "simple-timekeeping.configuration" });
await ignores("updateSetting", { key: `${ID}.recipeEdits` });
await refreshes("updateScene", desert, { flags: { [ID]: { biome: "swamp" } } });
await refreshes("updateScene", desert, { [`flags.${ID}.-=biome`]: null });
await ignores("updateScene", forest, { flags: { [ID]: { biome: "swamp" } } });
await ignores("updateScene", desert, { name: "Renamed" });
await refreshes("updateJournalEntryPage", linked);
await ignores("updateJournalEntryPage", { id: linked.id, uuid: "different-parent.same-id" });
let before = app.renders;
for (let index = 0; index < 20; index++) emit("updateItem", chosenItem);
assert.equal(timers.size, 1, "Hook burst queues one render");
await flush(); assert.equal(app.renders, before + 1);
await flush(); assert.equal(app.renders, before + 1, "Rendering does not recurse");
duringRender = () => emit("updateItem", chosenItem);
emit("updateItem", chosenItem); await flush();
assert.equal(timers.size, 1, "Concurrent change queues one follow-up");
await flush(); assert.equal(app.renders, before + 3);
app.view.busy = true;
await ignores("updateItem", chosenItem);
app.view.busy = false;
await app.render(); // Gather completion's existing render consumes busy-time changes.
assert.equal(app.refreshDirty, false);
await ignores("updateWorldTime", 1);
linked.flags.gatherer.data = { drawsUsed: 1, firstDrawTime: 0 };
await refreshes("updateWorldTime", 0);
game.time.worldTime = 1;
await refreshes("updateWorldTime", 1); // Display crosses from 8h 0m to 7h 59m.
game.time.worldTime = 2;
await ignores("updateWorldTime", 2);
game.time.worldTime = 61;
await refreshes("updateWorldTime", 61);
game.time.calendar = { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } };
game.time.components = { hour: 12 };
await refreshes("updateWorldTime", 61);
game.time.components.hour = 23;
await refreshes("updateWorldTime", 61);
before = app.renders;
emit("updateItem", chosenItem);
await app.close(); await flush();
assert.equal(app.renders, before, "Closing cancels queued refresh");
assert.equal([...hooks.values()].reduce((count, callbacks) => count + callbacks.size, 0), 0, "Closing removes every hook");
assert.equal(timers.size, 0);
console.log("PASS: audited placements, fresh duplicate state, relevant gathering refreshes, batching, busy renders, time boundaries, and close cleanup.");
