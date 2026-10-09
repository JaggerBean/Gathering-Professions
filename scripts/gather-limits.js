// Per-character gathering attempts. A long rest restores the free allowance;
// dnd5e remains responsible for reducing existing exhaustion on rest.
import { MODULE_ID, activeRules } from "./rules.js";
import { gpDialog } from "./dialogs.js";

const reservations = new WeakMap();
const pendingExhaustion = new WeakMap();

export function gatheringAllowance(actor) {
  const limit = activeRules().gatherAttemptsPerRest;
  const rawUsed = Number(actor?.getFlag?.(MODULE_ID, "gatherAttemptsUsed"));
  const used = Number.isInteger(rawUsed) && rawUsed > 0 ? rawUsed : 0;
  const rawExhaustion = Number(actor?.system?.attributes?.exhaustion);
  let exhaustion = Number.isFinite(rawExhaustion) ? Math.max(0, Math.trunc(rawExhaustion)) : 0;
  // dnd5e syncs its exhaustion ActiveEffect after Actor.update. Keep a just-
  // charged level until the derived value catches up, without ignoring later
  // changes made directly to the effect.
  const pending = pendingExhaustion.get(actor);
  if (pending !== undefined) {
    if (exhaustion >= pending) pendingExhaustion.delete(actor);
    else exhaustion = pending;
  }
  const configuredMax = Number(globalThis.CONFIG?.DND5E?.conditionTypes?.exhaustion?.levels);
  const maxExhaustion = Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 6;
  return { limit, used, remaining: limit ? Math.max(0, limit - used) : null, exhaustion, maxExhaustion };
}

/** Reserve one attempt before Gatherer starts. Re-read inside the queue after prompts. */
export function reserveGatherAttempt(actor) {
  const previous = reservations.get(actor) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    if (!actor || !(game.user?.isGM || actor.isOwner)) throw new Error("Choose a character you own to gather.");
    while (true) {
      const { limit, used, exhaustion, maxExhaustion } = gatheringAllowance(actor);
      if (!limit) return true;
      if (exhaustion >= maxExhaustion) {
        ui.notifications.warn(`Cannot gather: exhaustion is already at its maximum (${maxExhaustion}).`);
        return false;
      }
      const exhausted = used >= limit;
      if (exhausted) {
        const next = exhaustion + 1;
        const confirmed = await gpDialog().confirm({
          window: { title: "Gather beyond your limit?" },
          content: `<p>You have used ${used} of ${limit} free gathering attempts since your last long rest.</p>
            <p>This attempt raises exhaustion from <strong>${exhaustion}</strong> to <strong>${next}</strong>, even if it fails or finds nothing.${next === maxExhaustion ? " This reaches the system maximum and may be fatal." : ""}</p>
            <p>Cancel to keep your current attempts and exhaustion.</p>`
        });
        if (!confirmed) return false;
        // A rest or another client may have changed the actor while the dialog was open.
        const now = gatheringAllowance(actor);
        if (now.limit !== limit || now.used !== used || now.exhaustion !== exhaustion) continue;
      }
      // One Actor update keeps the counter and exhaustion change together.
      const changes = { [`flags.${MODULE_ID}.gatherAttemptsUsed`]: used + 1 };
      if (exhausted) changes["system.attributes.exhaustion"] = exhaustion + 1;
      if (!await actor.update(changes)) throw new Error("Could not save the gathering attempt on this character.");
      if (exhausted) pendingExhaustion.set(actor, exhaustion + 1);
      return true;
    }
  });
  reservations.set(actor, current);
  const cleanup = () => { if (reservations.get(actor) === current) reservations.delete(actor); };
  current.then(cleanup, cleanup);
  return current;
}

export async function resetGatherAttempts(actor) {
  pendingExhaustion.delete(actor);
  if (actor?.getFlag?.(MODULE_ID, "gatherAttemptsUsed")) await actor.unsetFlag(MODULE_ID, "gatherAttemptsUsed");
}
