// One actor lease, granted by the active GM, shared by both profession modules.
// Requests travel through document updates so Foundry supplies the real sender.
import { MODULE_ID } from "./rules.js";

const local = new Map();
const authority = new Map();
const activeActions = new WeakSet();
const invocations = new Map();
const localResources = new Map();
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
  // Lease mutations are brief. One GM queue prevents competing acquisitions
  // from racing across actor locks and shared party-completion resources.
  return enqueue(authority, "leases", async () => {
    if (!isAuthority()) return;
    let resource = request.resource === "party-bounty" ? request.resource : null;
    if (typeof request.resource === "string" && request.resource.startsWith("gather-node:")) {
      const page = await fromUuid(request.resource.slice("gather-node:".length));
      if (page?.type !== "gatherer.gatherer" || (!sender.isGM && !page.testUserPermission?.(sender, "OBSERVER"))) return;
      resource = request.resource;
    }
    // UUID resolution and queue waits may outlive this GM's authority. Read
    // lease state only after those awaits, immediately before its mutation.
    if (!isAuthority()) return;
    const lease = actor.getFlag(MODULE_ID, "actionLease");
    const owns = lease?.id === request.id && lease.user === sender.id;
    const resourceBusy = resource && Array.from(game.actors ?? []).some(other => {
      const held = other.getFlag?.(MODULE_ID, "actionLease");
      return held?.resource === resource && held.expires > Date.now() && !(other.uuid === actor.uuid && owns);
    });
    if (request.operation === "release") {
      if (owns) await actor.unsetFlag(MODULE_ID, "actionLease");
    } else if (request.operation === "renew") {
      if (owns) await actor.setFlag(MODULE_ID, "actionLease", { ...lease, expires: Date.now() + LEASE_MS });
    } else if (request.operation === "acquire" && !resourceBusy && (!lease || lease.expires <= Date.now() || owns)) {
      await actor.setFlag(MODULE_ID, "actionLease", { id: request.id, user: sender.id, resource, expires: Date.now() + LEASE_MS });
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
export function runActorAction(actor, task, { resource = null } = {}) {
  if (!actor || !(game.user.isGM || actor.isOwner)) return Promise.reject(new Error("Choose a character you own."));
  const invocation = invocations.get(actor);
  if (invocation && activeActions.has(invocation)) return Promise.resolve().then(() => task(invocation));
  return enqueue(local, actor.uuid ?? actor, async () => {
    // Isolated/offline GM operations need no remote lease. Players fail closed.
    if (!activeGM()) {
      if (!game.user.isGM) throw new Error("An active GM is required for profession actions.");
      const execute = async () => {
        const context = { actor, id: null, resource };
        activeActions.add(context);
        try { return await task(context); } finally { activeActions.delete(context); }
      };
      return resource ? enqueue(localResources, resource, execute) : execute();
    }
    const id = foundry.utils.randomID();
    const send = async operation => {
      const request = { id, operation, resource, nonce: foundry.utils.randomID() };
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
    const context = { actor, id, resource };
    activeActions.add(context);
    try { return await task(context); }
    finally { activeActions.delete(context); clearInterval(heartbeat); await send("release"); }
  });
}

/** Reuse a held lease for one synchronous entry into an existing action helper.
 * The scope ends before its promise runs, so unrelated queued actions cannot bypass it. */
export function withActorActionLease(actor, context, callback) {
  if (context?.actor !== actor || !activeActions.has(context)) throw new Error("The profession action lease is no longer held.");
  const previous = invocations.get(actor);
  invocations.set(actor, context);
  try { return callback(); }
  finally { if (previous) invocations.set(actor, previous); else invocations.delete(actor); }
}
