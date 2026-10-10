import assert from "node:assert/strict";
const GP = "gathering-professions";
const gm = { id: "gm", isGM: true };
const player = { id: "player", isGM: false };
const second = { id: "second", isGM: false };
globalThis.game = { user: gm, users: { activeGM: gm }, system: { id: "dnd5e" } };
const flags = {};
const get = path => path.split(".").reduce((value, key) => value?.[key], flags);
const actor = { uuid: "Actor.review", isOwner: true, getFlag: (_scope, key) => get(key),
  testUserPermission: user => [player.id, second.id].includes(user.id),
  async setFlag(_scope, key, value) { await new Promise(resolve => setTimeout(resolve, 2)); flags[key] = structuredClone(value); },
  async unsetFlag(_scope, key) { delete flags[key]; } };
const actions = await import("../scripts/actions.js");
await Promise.all([
  actions.handleActionRequest(actor, { id: "first", operation: "acquire" }, player),
  actions.handleActionRequest(actor, { id: "second", operation: "acquire" }, second)
]);
assert.equal(flags.actionLease.id, "first", "Only one independent client receives the lease");
await actions.handleActionRequest(actor, { id: "first", operation: "release" }, second);
assert.equal(flags.actionLease.id, "first", "A different sender cannot release the lease");
await actions.handleActionRequest(actor, { id: "first", operation: "release" }, player);
await actions.handleActionRequest(actor, { id: "second", operation: "acquire" }, second);
assert.equal(flags.actionLease.id, "second");
await actions.handleActionRequest(actor, { id: "intruder", operation: "acquire" }, { id: "intruder", isGM: false });
assert.equal(flags.actionLease.id, "second", "Non-owners cannot acquire");
flags.actionLease.expires = Date.now() - 1;
game.user = { id: "replacement", isGM: true };
game.users.activeGM = game.user;
await actions.handleActionRequest(actor, { id: "handover", operation: "acquire" }, player);
assert.equal(flags.actionLease.id, "handover", "Replacement active GM can grant expired leases");

// Resolve real node UUIDs and expose both actors to the GM's shared-resource
// scan. Node leases must not be granted from actor ownership alone.
await actions.handleActionRequest(actor, { id: "handover", operation: "release" }, player);
const otherFlags = {};
const otherActor = { ...actor, uuid: "Actor.otherReview",
  getFlag: (_scope, key) => key.split(".").reduce((value, part) => value?.[part], otherFlags),
  async setFlag(_scope, key, value) { await new Promise(resolve => setTimeout(resolve, 2)); otherFlags[key] = structuredClone(value); },
  async unsetFlag(_scope, key) { delete otherFlags[key]; } };
const node = { uuid: "JournalEntry.review.JournalEntryPage.node", type: "gatherer.gatherer",
  testUserPermission: user => user.isGM || [player.id, second.id].includes(user.id) };
const otherNode = { ...node, uuid: "JournalEntry.review.JournalEntryPage.other" };
const hiddenNode = { ...node, uuid: "JournalEntry.review.JournalEntryPage.hidden", testUserPermission: user => user.isGM };
const textPage = { ...node, uuid: "JournalEntry.review.JournalEntryPage.text", type: "text" };
const documents = new Map([node, otherNode, hiddenNode, textPage].map(page => [page.uuid, page]));
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
game.actors = [actor, otherActor];
const nodeResource = `gather-node:${node.uuid}`;
// Handover while one request resolves its node also invalidates requests
// queued behind it on the former GM. Neither may write a stale grant.
const resolver = globalThis.fromUuid;
let resumeNode, enteredNode;
const entered = new Promise(resolve => { enteredNode = resolve; });
globalThis.fromUuid = uuid => uuid === node.uuid ? new Promise(resolve => {
  resumeNode = () => resolve(node); enteredNode();
}) : resolver(uuid);
const pausedGrant = actions.handleActionRequest(actor, { id: "pausedAuthority", operation: "acquire", resource: nodeResource }, player);
await entered;
const queuedGrant = actions.handleActionRequest(otherActor, { id: "queuedAuthority", operation: "acquire", resource: `gather-node:${otherNode.uuid}` }, second);
const previousGM = game.users.activeGM;
game.users.activeGM = { id: "newAuthority", isGM: true };
resumeNode();
await Promise.all([pausedGrant, queuedGrant]);
assert.equal(flags.actionLease, undefined, "Former GM cannot grant after asynchronous node resolution");
assert.equal(otherFlags.actionLease, undefined, "Former GM cannot execute a queued grant after handover");
game.users.activeGM = previousGM;
globalThis.fromUuid = resolver;
await Promise.all([
  actions.handleActionRequest(actor, { id: "nodeFirst", operation: "acquire", resource: nodeResource }, player),
  actions.handleActionRequest(otherActor, { id: "nodeSecond", operation: "acquire", resource: nodeResource }, second)
]);
assert.equal(flags.actionLease.id, "nodeFirst");
assert.equal(flags.actionLease.resource, nodeResource);
assert.equal(otherFlags.actionLease, undefined, "Different actors cannot hold the same node concurrently");
await actions.handleActionRequest(otherActor, { id: "otherNode", operation: "acquire", resource: `gather-node:${otherNode.uuid}` }, second);
assert.equal(otherFlags.actionLease.id, "otherNode", "Unrelated nodes remain available");
await actions.handleActionRequest(otherActor, { id: "otherNode", operation: "release", resource: `gather-node:${otherNode.uuid}` }, second);
for (const pageUuid of [hiddenNode.uuid, textPage.uuid, "JournalEntry.review.JournalEntryPage.missing"]) {
  await actions.handleActionRequest(otherActor, { id: "invalidNode", operation: "acquire", resource: `gather-node:${pageUuid}` }, second);
  assert.equal(otherFlags.actionLease, undefined, "Hidden, wrong-type and missing pages cannot grant node leases");
}
await actions.handleActionRequest(actor, { id: "nodeFirst", operation: "release", resource: nodeResource }, second);
assert.equal(flags.actionLease.id, "nodeFirst", "Another owner cannot release a sender-bound node lease");
await actions.handleActionRequest(actor, { id: "nodeFirst", operation: "release", resource: nodeResource }, player);
await actions.handleActionRequest(otherActor, { id: "nodeSecond", operation: "acquire", resource: nodeResource }, second);
assert.equal(otherFlags.actionLease.id, "nodeSecond", "Released node can be acquired by the waiting actor");
await actions.handleActionRequest(otherActor, { id: "nodeSecond", operation: "release", resource: nodeResource }, second);

const { rollProfessionCheck } = await import("../scripts/checks.js");
const calls = [];
const systemRoll = { total: 8, dice: [{ total: 10 }], options: { disadvantage: true } };
const roller = { system: { abilities: { str: { mod: 3 }, int: { mod: 2 } }, skills: { inv: { ability: "int" } } },
  async rollAbilityCheck(...args) { calls.push(["ability", ...args]); return [systemRoll]; },
  async rollSkill(...args) { calls.push(["skill", ...args]); return [systemRoll]; },
  async rollToolCheck(...args) { calls.push(["tool", ...args]); return [systemRoll]; } };
assert.equal(await rollProfessionCheck(roller, { ability: "str", modifier: 3, formula: "1d20 + 3 + 2 + 1d4" }), systemRoll);
assert.deepEqual(calls.at(-1), ["ability", { ability: "str", rolls: [{ parts: ["2 + 1d4"] }] }, { configure: false }, { create: false }]);
await rollProfessionCheck(roller, { ability: "int", skill: "inv", modifier: 4, formula: "1d20 + 4 + 1d6" });
assert.equal(calls.at(-1)[0], "skill");
assert.deepEqual(calls.at(-1)[1].rolls[0].parts, ["1d6"], "System supplies skill proficiency/bonuses once");
await rollProfessionCheck(roller, { abilityKey: "str", modifier: 5, formula: "1d20 + 5 + 1d4" }, { tool: "smith" });
assert.equal(calls.at(-1)[0], "tool");
assert.deepEqual(calls.at(-1)[1].rolls[0].parts, ["1d4"]);
console.log("PASS: deep-review checks — authenticated actor/node leases, node visibility and type checks, expired-lock handover and native dnd5e roll delegation.");
