// One actor lease, granted by the active GM, shared by both profession modules.
// Requests travel through document updates so Foundry supplies the real sender.
import { MODULE_ID } from "./rules.js";

const local = new Map();
const authority = new Map();
const LEASE_MS = 120000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const activeGM = () => game.users?.activeGM;
const isAuthority = () => game.user.isGM && (!activeGM() || activeGM().id === game.user.id);

function enqueue(map, key, task) {
  const next = (map.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  map.set(key, next);
  const clear = () => { if (map.get(key) === next) map.delete(key); };
  next.then(clear, clear);
  return next;
}

export async function handleActionRequest(actor, request, sender) {
  if (!isAuthority() || typeof request?.id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(request.id) || !sender
    || !(sender.isGM || actor.testUserPermission?.(sender, "OWNER"))) return;
  return enqueue(authority, actor.uuid, async () => {
    const lease = actor.getFlag(MODULE_ID, "actionLease");
    const owns = lease?.id === request.id && lease.user === sender.id;
    if (request.operation === "release") {
      if (owns) await actor.unsetFlag(MODULE_ID, "actionLease");
    } else if (request.operation === "renew") {
      if (owns) await actor.setFlag(MODULE_ID, "actionLease", { ...lease, expires: Date.now() + LEASE_MS });
    } else if (request.operation === "acquire" && (!lease || lease.expires <= Date.now() || owns)) {
      await actor.setFlag(MODULE_ID, "actionLease", { id: request.id, user: sender.id, expires: Date.now() + LEASE_MS });
    }
  });
}

let registered = false;
export function registerActionHooks() {
  if (registered) return;
  registered = true;
  Hooks.on("updateActor", (actor, changes, _options, userId) => {
    const request = changes.flags?.[MODULE_ID]?.actionRequest ?? changes[`flags.${MODULE_ID}.actionRequest`];
    if (request) void handleActionRequest(actor, request, game.users?.get?.(userId) ?? Array.from(game.users ?? []).find(user => user.id === userId))
      .catch(error => console.error(`${MODULE_ID}: action lock failed`, error));
  });
}

/** Serialize an entire action, including its prerequisites, costs and rewards. */
export function runActorAction(actor, task) {
  if (!actor || !(game.user.isGM || actor.isOwner)) return Promise.reject(new Error("Choose a character you own."));
  return enqueue(local, actor.uuid ?? actor, async () => {
    // Isolated/offline GM operations need no remote lease. Players fail closed.
    if (!activeGM()) {
      if (!game.user.isGM) throw new Error("An active GM is required for profession actions.");
      return task();
    }
    const id = foundry.utils.randomID();
    const send = async operation => {
      const request = { id, operation, nonce: foundry.utils.randomID() };
      if (isAuthority()) await handleActionRequest(actor, request, game.user);
      else await actor.setFlag(MODULE_ID, "actionRequest", request);
    };
    const deadline = Date.now() + LEASE_MS;
    while (true) {
      await send("acquire");
      await sleep(100);
      const lease = actor.getFlag(MODULE_ID, "actionLease");
      if (lease?.id === id && lease.user === game.user.id) break;
      if (!activeGM() || Date.now() >= deadline) throw new Error("Could not obtain the profession action lock. Try again when the GM is connected.");
      await sleep(400);
    }
    const heartbeat = setInterval(() => void send("renew").catch(error => console.error(`${MODULE_ID}: could not renew action lock`, error)), 20000);
    try { return await task(); }
    finally { clearInterval(heartbeat); await send("release"); }
  });
}
