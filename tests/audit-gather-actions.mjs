// Actual module instances in separate VM clients, sharing only document records.
// No Foundry connection, live data, or generated artifacts.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!vm.SourceTextModule) {
  const run = spawnSync(process.execPath, ["--experimental-vm-modules", fileURLToPath(import.meta.url)], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

const GP = "gathering-professions";
const root = new URL("../scripts/", import.meta.url);
const records = new Map();
const clients = [];
let sequence = 0;
let socketWrites = 0;
let activeGM = { id: "bootstrap", isGM: true, active: true };
const gm = { id: "gm", isGM: true, active: true };
const player = { id: "player", isGM: false, active: true };
const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
function apply(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((entry, key) => entry[key] ??= {}, object);
  if (last.startsWith("-=")) delete parent[last.slice(2)];
  else parent[last] = structuredClone(value);
}
const delay = () => new Promise(resolve => setTimeout(resolve, 3));
function addRecord(uuid, data) {
  const record = { id: uuid.split(".").at(-1), flags: {}, system: {}, ...data, uuid };
  records.set(uuid, record);
  return record;
}

const installed = await fs.readFile(new URL("../../gatherer/scripts/app/gathererSheet.js", import.meta.url), "utf8");
const nativeGather = installed.slice(installed.indexOf("    async _onGather("), installed.indexOf("    async toChat("));

async function createClient(user) {
  const hooks = new Map();
  const once = new Map();
  const wrappers = new Map();
  const errors = [];
  const client = { user, hooks, wrappers, errors };
  function document(uuid) {
    if (wrappers.has(uuid)) return wrappers.get(uuid);
    const record = records.get(uuid);
    if (!record) return null;
    const target = Object.create(Item.prototype);
    Object.defineProperties(target, Object.fromEntries(["uuid", "id", "name", "documentName", "type", "flags", "system", "img", "results", "replacement"].map(key => [key, { get: () => record[key] }])));
    Object.assign(target, {
      get isOwner() { return user.isGM || record.owners?.includes(user.id); },
      getFlag(scope, key) { return get(record.flags[scope], key); },
      testUserPermission(viewer) { return viewer.isGM || record.documentName !== "Actor" || record.owners?.includes(viewer.id); },
      async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); },
      async unsetFlag(scope, key) { const keys = key.split("."); const last = keys.pop(); return this.update({ [`flags.${scope}.${keys.length ? `${keys.join(".")}.` : ""}-=${last}`]: null }); },
      async update(changes) {
        await delay();
        for (const [path, value] of Object.entries(changes)) apply(record, path, value);
        if (record.documentName === "Actor") {
          const expanded = {};
          for (const [path, value] of Object.entries(changes)) apply(expanded, path, value);
          for (const other of clients) other.emit("updateActor", other.document(uuid), expanded, {}, user.id);
        }
        return this;
      },
      toObject() { return structuredClone(record); },
      async createEmbeddedDocuments(_type, entries) {
        const made = [];
        for (const entry of entries) {
          const id = `carried${++sequence}`;
          const item = addRecord(`${uuid}.Item.${id}`, { ...structuredClone(entry), id, documentName: "Item", parentUuid: uuid });
          record.itemUuids.push(item.uuid);
          made.push(document(item.uuid));
        }
        return made;
      },
      async draw() { await delay(); return { results: this.results }; }
    });
    Object.defineProperty(target, "parent", { get: () => record.parentUuid ? document(record.parentUuid) : null });
    Object.defineProperty(target, "items", { get: () => {
      const items = (record.itemUuids ?? []).map(document);
      items.getName = name => items.find(item => item.name === name);
      return items;
    } });
    wrappers.set(uuid, target);
    return target;
  }
  function Item() {}
  const emit = (name, ...args) => { for (const callback of hooks.get(name) ?? []) callback(...args); };
  Object.assign(client, { document, emit });
  const actors = () => [...records.values()].filter(record => record.documentName === "Actor").map(record => document(record.uuid));
  const users = [gm, player];
  Object.defineProperty(users, "activeGM", { get: () => activeGM });
  users.get = id => users.find(entry => entry.id === id);
  const game = { user, users, actors: [], items: [], journal: [], scenes: [], time: { worldTime: 100 },
    modules: new Map([[GP, {}], ["gatherer", { active: true }]]),
    settings: { get(scope, key) {
      if (scope === "gatherer") return "quantity";
      if (key === "rules") return { gatherAttemptsPerRest: 5, masterfulRareFind: false, excellentRareBonus: 0 };
      return undefined;
    } }, i18n: { localize: value => value } };
  Object.defineProperty(game, "actors", { get: actors });
  const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, structuredClone,
    game, fromUuid: async uuid => document(uuid), fromUuidSync: document,
    canvas: { tokens: { controlled: [] } },
    Hooks: { on(name, callback) { const list = hooks.get(name) ?? []; list.push(callback); hooks.set(name, list); return callback; },
      off(name, callback) { hooks.set(name, (hooks.get(name) ?? []).filter(entry => entry !== callback)); },
      once(name, callback) { once.set(name, callback); }, callAll: emit },
    ui: { notifications: { info() {}, warn() {}, error(message) { errors.push(message); } } },
    CONST: { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } },
    CONFIG: { Item: { documentClass: { implementation: Item } } },
    ChatMessage: { getSpeaker() { return {}; }, async create() {} },
    Roll: class {
      constructor(formula) { this.formula = formula; }
      static validate() { return true; }
      async evaluate() {
        await delay();
        this.total = this.formula.startsWith("1d20") ? 17 : this.formula === "1d4" ? 4 : 1;
        this.dice = this.formula.startsWith("1d20") ? [{ total: 16 }, { total: 1 }] : [];
        return this;
      }
      async roll() { return this.evaluate(); }
      async toMessage() { await delay(); }
    },
    foundry: { utils: { getProperty: get, setProperty: apply, deepClone: structuredClone,
      randomID: () => `id${++sequence}`, mergeObject: (a, b) => ({ ...a, ...b }) },
      applications: { api: { DialogV2: { async confirm() { return true; } } } } },
    Socket: { USERS: { FIRSTGM: 1 }, updateJournal() { socketWrites++; }, updateActor() {} }, MODULE_ID: "gatherer"
  });
  vm.runInContext(`globalThis.gatherer = class NativeGatherer {
    constructor(page) { this.document=page; this.table=fromUuidSync(page.flags.gatherer.table); this.hasDraws=!!Number(page.flags.gatherer.draws); this.MAX_DRAWS=Number(page.flags.gatherer.draws); this.hasTime=true; this.QUANTITY="1"; this.MODIFIERS=[]; this.defaultGathererData={drawsUsed:0,firstDrawTime:0}; }
    async runMinigame(){return null;}
    async toChat(){await new Promise(resolve=>setTimeout(resolve,3));}
    ${nativeGather}
  };`, context);
  const cache = new Map();
  async function load(url) {
    const key = String(url);
    if (cache.has(key)) return cache.get(key);
    const pending = fs.readFile(url, "utf8").then(source => new vm.SourceTextModule(source, { context, identifier: key }));
    cache.set(key, pending);
    return pending;
  }
  const main = await load(new URL("main.js", root));
  await main.link((specifier, reference) => load(new URL(specifier, reference.identifier)));
  await main.evaluate();
  clients.push(client);
  await once.get("ready")();
  client.module = async name => (await load(new URL(name, root))).namespace;
  client.gather = async (page, actor, configure) => {
    const sheet = new context.gatherer(document(page));
    configure?.(sheet);
    return sheet._onGather(true, null, document(actor));
  };
  client.game = game;
  return client;
}

function actor(id, perks = {}, owner = "player") {
  return addRecord(`Actor.${id}`, { documentName: "Actor", type: "character", name: id, owners: [owner], itemUuids: [],
    system: { abilities: { str: { mod: 1 } }, attributes: { exhaustion: 0 } }, flags: { [GP]: { selectedProfession: "mining" } } });
}
function perk(record, data) {
  const item = addRecord(`Item.perk${++sequence}`, { documentName: "Item", name: "Skill", flags: { [GP]: { perk: { enabled: true, profession: "any", ...data } } } });
  record.itemUuids.push(item.uuid);
}
const ore = addRecord("Item.ore", { documentName: "Item", name: "Ore", type: "loot", img: "ore.webp", system: { quantity: 1 },
  flags: { [GP]: { material: { enabled: true, profession: "mining", tier: 1, dc: 10, baseYield: "1", xp: 0 } } } });
const result = { documentUuid: ore.uuid, type: "document", weight: 1, getFlag() { return 1; } };
addRecord("RollTable.ore", { documentName: "RollTable", replacement: true, results: [result] });
function node(id, draws) {
  return addRecord(`JournalEntry.nodes.JournalEntryPage.${id}`, { documentName: "JournalEntryPage", type: "gatherer.gatherer", name: id,
    flags: { gatherer: { table: "RollTable.ore", draws: String(draws), time: "1", data: { drawsUsed: 0, firstDrawTime: 0 } } } });
}
const first = actor("first"), second = actor("second");
const authority = await createClient(gm);
const playerClient = await createClient(player);
activeGM = gm;
const effects = await authority.module("skill-effects.js");
const quantity = record => record.itemUuids.map(uuid => records.get(uuid)).find(item => item.name === "Ore")?.system.quantity ?? 0;

// Independent client modules compete for the final pull. Both actor and node
// leases remain held until the actual native Gatherer/toChat flow settles.
const last = node("last", 1);
const watchdog = setTimeout(() => { console.error("Gather timeout", first.flags, second.flags, last.flags, authority.errors, playerClient.errors); process.exit(1); }, 15000);
await Promise.all([authority.gather(last.uuid, first.uuid), playerClient.gather(last.uuid, second.uuid)]);
clearTimeout(watchdog);
await delay(); // The owner request resolves before the GM's release update broadcasts.
assert.equal(last.flags.gatherer.data.drawsUsed, 1);
assert.equal(quantity(first) + quantity(second), 2);
assert.equal(socketWrites, 0, "Gatherer's unawaited socket writes are suppressed");
assert.equal((first.flags[GP].gatherAttemptsUsed ?? 0) + (second.flags[GP].gatherAttemptsUsed ?? 0), 1, "Waiting loser spends no attempt");
assert.equal(first.flags[GP].actionLease, undefined);
assert.equal(second.flags[GP].actionLease, undefined);

const sharedActor = actor("same");
const a = node("a", 2), b = node("b", 2);
await Promise.all([authority.gather(a.uuid, sharedActor.uuid), playerClient.gather(b.uuid, sharedActor.uuid)]);
assert.equal(quantity(sharedActor), 4, "Independent clients cannot lose an inventory increment");
assert.equal(sharedActor.flags[GP].gatherAttemptsUsed, 2);

// A legacy expression refusal still consumes one pull, but never sends its
// special unawaited socket write and never awards a reward.
const expressionActor = actor("expression");
const expressionNode = node("expression", 2);
await playerClient.gather(expressionNode.uuid, expressionActor.uuid, sheet => { sheet.EXPRESSION = "false"; sheet.evaluateExpression = async () => false; });
assert.equal(expressionNode.flags.gatherer.data.drawsUsed, 1);
assert.equal(quantity(expressionActor), 0);
assert.equal(socketWrites, 0);

// Field Repair shares the same GM-granted actor lease on separate clients.
const repairer = actor("repairer");
perk(repairer, { fieldRepairs: 1 });
for (const id of ["one", "two"]) {
  const tool = addRecord(`${repairer.uuid}.Item.${id}`, { documentName: "Item", parentUuid: repairer.uuid, type: "tool", name: id,
    flags: { [GP]: { durability: { max: 10, value: 1 } } } });
  repairer.itemUuids.push(tool.uuid);
}
const playerEffects = await playerClient.module("skill-effects.js");
const repairs = await Promise.allSettled([
  effects.fieldRepair(authority.document(repairer.uuid), authority.document(repairer.itemUuids[1])),
  playerEffects.fieldRepair(playerClient.document(repairer.uuid), playerClient.document(repairer.itemUuids[2]))
]);
assert.equal(repairs.filter(result => result.status === "fulfilled").length, 1);
assert.equal(repairer.flags[GP].restUses.fieldRepairs, 1);
assert.deepEqual(repairer.itemUuids.slice(1).map(uuid => records.get(uuid).flags[GP].durability.value).sort(), [1, 5]);

// Genuine Assist is claimed by the GM at action start, completion is recorded
// under that receipt, and Shared Haul consumes it exactly once.
const gatherer = actor("hauler"), helper = actor("helper", {}, "another");
perk(helper, { assistBonus: 1, sharedHaul: 1 });
const haulNode = node("haul", 3);
helper.flags[GP].assist = { pageUuid: haulNode.uuid, at: 100 };
await playerClient.gather(haulNode.uuid, gatherer.uuid);
assert.equal(quantity(helper), 1);
assert.equal(helper.flags[GP].assist, undefined);
const receiptId = Object.keys(haulNode.flags[GP].gatherReceipts)[0];
const request = { type: "sharedHaul", data: { pageUuid: haulNode.uuid, receiptId, helperUuid: helper.uuid, itemUuid: ore.uuid } };
await effects.handleGmRequest(authority.document(gatherer.uuid), request, player);
assert.equal(quantity(helper), 1, "Replay cannot mint a second helper reward");
await Promise.all([effects.handleGmRequest(authority.document(gatherer.uuid), request, player),
  effects.handleGmRequest(authority.document(gatherer.uuid), request, player)]);
assert.equal(quantity(helper), 1, "Concurrent replay cannot mint a helper reward");
assert.equal(await effects.handleGmRequest(authority.document(gatherer.uuid), request,
  { id: "unrelated", isGM: false }), null, "Non-owner sender cannot use another actor's receipt");
await assert.rejects(effects.handleGmRequest(authority.document(gatherer.uuid),
  { type: "gatherStart", data: { pageUuid: haulNode.uuid, receiptId: "unleased" } }, player), /lease is no longer held/);
await assert.rejects(effects.handleGmRequest(authority.document(gatherer.uuid),
  { ...request, data: { ...request.data, receiptId: undefined } }, player), /Invalid gathering receipt/);
await assert.rejects(effects.handleGmRequest(authority.document(gatherer.uuid), { ...request, data: { ...request.data, receiptId: "forged" } }, player), /missing or expired/);
const impostor = actor("impostor");
await assert.rejects(effects.handleGmRequest(authority.document(impostor.uuid), request, player), /missing or expired/);
const noAssist = node("noassist", 3);
await playerClient.gather(noAssist.uuid, gatherer.uuid);
const without = Object.keys(noAssist.flags[GP].gatherReceipts)[0];
await assert.rejects(effects.handleGmRequest(authority.document(gatherer.uuid), { ...request, data: { ...request.data, pageUuid: noAssist.uuid, receiptId: without } }, player), /completed great gather/);

console.log("PASS: audit gather actions — actual Gatherer integration across clients, awaited pulls/rewards, expression failures, actor/node leases, repair limits, authenticated single-use Assist rewards.");
