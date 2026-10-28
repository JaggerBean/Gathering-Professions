// Regression: Foundry's updateActor hook passes only the changed keys. A
// release, renew or repeated acquire keeps the same request id, so the id is
// missing from `changes`. The GM must still act on the full request.
import assert from "node:assert/strict";
const GP = "gathering-professions";
const gm = { id: "gm", isGM: true };
const player = { id: "player", isGM: false };
const hooks = {};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };
globalThis.game = { user: gm, users: { activeGM: gm, get: id => [gm, player].find(user => user.id === id) }, system: { id: "dnd5e" } };

const flags = {};
const get = path => path.split(".").reduce((value, key) => value?.[key], flags);
const actor = { uuid: "Actor.diff", isOwner: true, getFlag: (_scope, key) => get(key),
  testUserPermission: user => user.id === player.id,
  async setFlag(_scope, key, value) { flags[key] = structuredClone(value); },
  async unsetFlag(_scope, key) { delete flags[key]; } };

const actions = await import("../scripts/actions.js");
actions.registerActionHooks();
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

/** Apply a player's request the way Foundry does: merge it, then fire the hook with only the diff. */
async function playerRequest(request) {
  const before = flags.actionRequest ?? {};
  const diff = Object.fromEntries(Object.entries(request).filter(([key, value]) => before[key] !== value));
  flags.actionRequest = { ...before, ...request };
  for (const fn of hooks.updateActor ?? []) fn(actor, { flags: { [GP]: { actionRequest: diff } } }, {}, player.id);
  await settle();
}

await playerRequest({ id: "first", operation: "acquire", resource: null, nonce: "a1" });
assert.equal(flags.actionLease?.id, "first", "First acquire is granted");

await playerRequest({ id: "first", operation: "release", resource: null, nonce: "a2" });
assert.equal(flags.actionLease, undefined, "Release is honoured although the diff has no id");

await playerRequest({ id: "second", operation: "acquire", resource: null, nonce: "b1" });
assert.equal(flags.actionLease?.id, "second", "A second action can take the lock straight away");

const expires = flags.actionLease.expires;
await new Promise(resolve => setTimeout(resolve, 5));
await playerRequest({ id: "second", operation: "renew", resource: null, nonce: "b2" });
assert.ok(flags.actionLease.expires > expires, "Renew is honoured although the diff has no id");

// A retried acquire (same id, new nonce) must be granted once the old lease expires.
flags.actionLease = { id: "stale", user: player.id, resource: null, expires: Date.now() + 60000 };
await playerRequest({ id: "third", operation: "acquire", resource: null, nonce: "c1" });
assert.equal(flags.actionLease.id, "stale", "A held lease blocks a new acquire");
flags.actionLease.expires = Date.now() - 1;
await playerRequest({ id: "third", operation: "acquire", resource: null, nonce: "c2" });
assert.equal(flags.actionLease.id, "third", "The retry is granted after the old lease expires");

console.log("action-diff: all checks passed");
