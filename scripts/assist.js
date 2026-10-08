// Assist (Fellowship skills): a character offers help at a node; the next
// gather there by another character gets the helper's assist bonuses. The
// offer lives on the helper's actor (flags.gathering-professions.assist), so
// players need only their own actor's permission to offer. Clearing another
// player's offer goes through the active GM.
import { MODULE_ID, selectedProfession } from "./rules.js";
import { actorPerks } from "./perks.js";

export const ASSIST_HOURS = 1;

/** The assist a helper can give right now (from their current perks). */
export function assistPower(helper) {
  const perks = actorPerks(helper, selectedProfession(helper));
  const power = { bonus: perks.assistBonus, die: perks.assistDie, untrainedRelief: perks.assistUntrainedRelief };
  return power.bonus || power.die || power.untrainedRelief ? power : null;
}

export function assistLabel(power) {
  if (!power) return "";
  const parts = [];
  if (power.bonus) parts.push(`+${power.bonus}`);
  if (power.die) parts.push(`+1d${power.die}`);
  if (power.untrainedRelief) parts.push(power.untrainedRelief >= 1 ? "no untrained penalty" : "half untrained penalty");
  return parts.join(", ");
}

function offerOf(helper) {
  const offer = helper?.getFlag?.(MODULE_ID, "assist");
  return offer && typeof offer.pageUuid === "string" ? offer : null;
}

function fresh(offer) {
  const now = Number(globalThis.game?.time?.worldTime) || 0;
  return Math.abs(now - (Number(offer.at) || 0)) <= ASSIST_HOURS * 3600;
}

/** Offer help at a node page. One offer per helper; a new one replaces the old. */
export async function offerAssist(helper, page) {
  if (!helper?.isOwner) throw new Error("Choose a character you own to assist.");
  if (!assistPower(helper)) throw new Error(`${helper.name} has no assist skills.`);
  await helper.setFlag(MODULE_ID, "assist", { pageUuid: page.uuid, at: Number(game.time?.worldTime) || 0 });
}

export async function withdrawAssist(helper) {
  if (offerOf(helper)) await helper.unsetFlag(MODULE_ID, "assist");
}

/** The helper's live offer at this page, if any. */
export function activeOffer(helper, page) {
  const offer = offerOf(helper);
  return offer && offer.pageUuid === page?.uuid && fresh(offer) ? offer : null;
}

/**
 * The strongest live assist for actor at page from another character.
 * @returns {{helper, bonus, die, untrainedRelief}|null}
 */
export function findAssist(actor, page) {
  let best = null;
  for (const helper of globalThis.game?.actors ?? []) {
    if (helper.type !== "character" || helper.id === actor?.id || !activeOffer(helper, page)) continue;
    const power = assistPower(helper);
    if (!power) continue;
    const score = power.bonus + power.die / 2 + power.untrainedRelief * 3;
    if (!best || score > best.score) best = { helper, ...power, score };
  }
  if (!best) return null;
  const { score, ...assist } = best;
  return assist;
}

/** Use up an offer: directly when allowed, else ask the active GM. */
export async function consumeAssist(helper, page, actor) {
  if (helper.isOwner) return withdrawAssist(helper);
  if (!actor?.isOwner) throw new Error("Choose a character you own to gather with an assist.");
  await actor.setFlag(MODULE_ID, "assistClearRequest", { helperUuid: helper.uuid,
    pageUuid: page.uuid, requestId: foundry.utils.randomID() });
}

/** Active GM handles an authenticated update to the gatherer's actor. */
export async function handleClearAssist(data, user, requester) {
  if (!user || !requester?.testUserPermission?.(user, "OWNER")) return;
  const helper = await fromUuid(data.helperUuid);
  if (!helper || offerOf(helper)?.pageUuid !== data.pageUuid) return;
  await helper.unsetFlag(MODULE_ID, "assist");
}
