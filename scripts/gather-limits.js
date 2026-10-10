// Per-character gathering attempts. A long rest restores the free allowance;
// dnd5e remains responsible for reducing existing exhaustion on rest.
import { MODULE_ID, activeRules, selectedProfession } from "./rules.js";
import { actorPerks, restUsesLeft, restUseChanges } from "./perks.js";
import { gpDialog } from "./dialogs.js";
import { runActorAction } from "./actions.js";

const pendingExhaustion = new WeakMap();

// Deep Reserves adds free attempts; Second Wind makes some extra attempts exhaustion-free.
const perksOf = actor => (actor ? actorPerks(actor, selectedProfession(actor)) : null);

export function gatheringAllowance(actor) {
  const base = activeRules().gatherAttemptsPerRest;
  const perks = perksOf(actor);
  const limit = base ? base + (Number(perks?.extraAttempts) || 0) : 0;
  const secondWind = restUsesLeft(actor, perks, "secondWind");
  const rawUsed = Number(actor?.getFlag?.(MODULE_ID, "gatherAttemptsUsed"));
  const used = Number.isInteger(rawUsed) && rawUsed > 0 ? rawUsed : 0;
  const rawExhaustion = Number(actor?.system?.attributes?.exhaustion);
  let exhaustion = Number.isFinite(rawExhaustion) ? Math.max(0, Math.trunc(rawExhaustion)) : 0;
  // dnd5e syncs its exhaustion ActiveEffect after Actor.update. Keep a just-
  // charged level until the derived value catches up, without ignoring later
  // changes made directly to the effect.
  const pending = pendingExhaustion.get(actor);
  if (pending !== undefined) {
    if (pending.expires <= Date.now() || exhaustion >= pending.value) pendingExhaustion.delete(actor);
    else exhaustion = pending.value;
  }
  const sharedPending = actor?.getFlag?.(MODULE_ID, "gatherExhaustionPending");
  if (sharedPending?.used === used && sharedPending.expires > Date.now()) exhaustion = Math.max(exhaustion, sharedPending.value);
  const configuredMax = Number(globalThis.CONFIG?.DND5E?.conditionTypes?.exhaustion?.levels);
  const maxExhaustion = Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 6;
  return { limit, used, remaining: limit ? Math.max(0, limit - used) : null, exhaustion, maxExhaustion, secondWind, extraAttempts: limit ? limit - base : 0 };
}

/** Reserve one attempt before Gatherer starts. Re-read inside the queue after prompts. */
export function reserveGatherAttempt(actor, { pageUuid = null, onReserved = null } = {}) {
  return runActorAction(actor, async () => {
    if (!actor || !(game.user?.isGM || actor.isOwner)) throw new Error("Choose a character you own to gather.");
    while (true) {
      const { limit, used, exhaustion, maxExhaustion, secondWind } = gatheringAllowance(actor);
      if (!limit && !pageUuid) return true;
      const exhausted = limit > 0 && used >= limit;
      const winded = exhausted && secondWind > 0;
      if (limit && exhaustion >= maxExhaustion) {
        ui.notifications.warn(`Cannot gather: exhaustion is already at its maximum (${maxExhaustion}).`);
        return false;
      }
      if (winded) {
        const confirmed = await gpDialog().confirm({
          window: { title: "Second Wind" },
          content: `<p>You have used ${used} of ${limit} free gathering attempts since your last long rest.</p>
            <p><strong>Second Wind</strong>: this attempt adds no exhaustion (${secondWind} use${secondWind === 1 ? "" : "s"} left this long rest).</p>
            <p>Cancel to keep your attempts and Second Wind.</p>`
        });
        if (!confirmed) return false;
        const now = gatheringAllowance(actor);
        if (now.limit !== limit || now.used !== used || now.secondWind !== secondWind) continue;
      } else if (exhausted) {
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
      const changes = limit ? { [`flags.${MODULE_ID}.gatherAttemptsUsed`]: used + 1 } : {};
      const ticket = pageUuid ? foundry.utils.randomID() : null;
      if (ticket) {
        changes[`flags.${MODULE_ID}.gatherTickets.${ticket}`] = { pageUuid, expires: Date.now() + 120000 };
        for (const [id, record] of Object.entries(actor.getFlag(MODULE_ID, "gatherTickets") ?? {})) {
          if (record.expires <= Date.now()) changes[`flags.${MODULE_ID}.gatherTickets.-=${id}`] = null;
        }
      }
      if (winded) Object.assign(changes, restUseChanges(actor, "secondWind"));
      else if (exhausted) {
        changes["system.attributes.exhaustion"] = exhaustion + 1;
        changes[`flags.${MODULE_ID}.gatherExhaustionPending`] = { used: used + 1, value: exhaustion + 1, expires: Date.now() + 5000 };
      }
      if (!await actor.update(changes)) throw new Error("Could not save the gathering attempt on this character.");
      if (exhausted && !winded) pendingExhaustion.set(actor, { value: exhaustion + 1, expires: Date.now() + 5000 });
      onReserved?.(ticket);
      return true;
    }
  });
}

export async function resetGatherAttempts(actor) {
  // A rest may occur while the exhaustion confirmation is open. The reservation
  // deliberately rereads this value after the prompt; do not wait on its lease.
  pendingExhaustion.delete(actor);
  if (actor?.getFlag?.(MODULE_ID, "gatherExhaustionPending")) await actor.unsetFlag(MODULE_ID, "gatherExhaustionPending");
  if (actor?.getFlag?.(MODULE_ID, "gatherAttemptsUsed")) await actor.unsetFlag(MODULE_ID, "gatherAttemptsUsed");
}
