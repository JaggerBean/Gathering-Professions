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
console.log("PASS: deep-review checks — authenticated cross-client leases, expired-lock handover and native dnd5e roll delegation.");
