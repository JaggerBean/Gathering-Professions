// Skill tree expansion (0.31.0): the mechanics that need dialogs, GM help, or
// their own actions. Simple totals live in perks.js; the gather flow calls
// these from main.js.
//   Careful Selection  chooseDraw         (draw two node results, keep one)
//   Appraiser's Eye    offerAppraisal     (reroll a rare find, keep either)
//   Field Repair       fieldRepair        (1d4 durability, gathering window)
//   Familiar Ground    setFamiliarBiome   (one biome; GM changes it later)
//   Last Pull          requestLastPull    (GM opens one pull on an exhausted node)
//   Shared Haul        shareHaul          (assisting helper gets 1 of the material)
//   Timekeeper         markRefillCut      (GM shortens an exhausted node's timer)
// Requests that change documents a player may not own go through the active GM
// as an authenticated actor update (flag gmRequest), like the other requests.
import { MODULE_ID, selectedProfession, materialRule } from "./rules.js";
import { actorPerks, restUsesLeft, spendRestUse, restUseChanges, familiarBiome } from "./perks.js";
import { toolDurability } from "./durability.js";
import { getBiomes } from "./conditions.js";
import { isGathererPage, isDepleted, lastPullHolder, nodeUsage, readNode } from "./nodes.js";
import { drawRareFind } from "./integrations.js";
import { gpDialog } from "./dialogs.js";
import { runActorAction } from "./actions.js";
import { findAssist } from "./assist.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isActiveGM = () => game.user.isGM && (!game.users?.activeGM || game.users.activeGM.id === game.user.id);
const LAST_PULL_MS = 120000;
const receiptQueues = new Map();

function receiptAction(uuid, task) {
  const completion = (receiptQueues.get(uuid) ?? Promise.resolve()).catch(() => {}).then(task);
  receiptQueues.set(uuid, completion);
  const clear = () => { if (receiptQueues.get(uuid) === completion) receiptQueues.delete(uuid); };
  completion.then(clear, clear);
  return completion;
}

let award = null;
/** main.js supplies its item award (stacking by name, Gatherer's quantity path). */
export function configureSkillEffects({ awardItem }) { award = awardItem; }

const perksFor = (actor, profession = null) => actorPerks(actor, profession || selectedProfession(actor));

/* ---------------------------------------------------------------------- */
/* Careful Selection                                                       */
/* ---------------------------------------------------------------------- */

const pickItem = pick => (pick?.result?.documentUuid ? globalThis.fromUuidSync?.(pick.result.documentUuid) ?? null : null);

/**
 * Careful Selection: given two draws, ask which to gather. Spends the use only
 * when there is a real choice (two different results).
 */
export async function chooseDraw(actor, first, second) {
  const a = pickItem(first);
  const b = pickItem(second);
  if (!a || !b || a.uuid === b.uuid) return a ? first : b ? second : first;
  const tile = (item, action) => ({ action, label: item.name, icon: "fas fa-hand-sparkles", default: action === "first" });
  const picked = await gpDialog().wait({
    window: { title: "Careful Selection" },
    content: `<p>${escape(actor.name)} searches carefully. Choose what to gather:</p>
      <div class="gp-careful"><figure><img src="${escape(a.img)}" alt=""><figcaption>${escape(a.name)}</figcaption></figure>
      <figure><img src="${escape(b.img)}" alt=""><figcaption>${escape(b.name)}</figcaption></figure></div>`,
    buttons: [tile(a, "first"), tile(b, "second")], rejectClose: false
  });
  await spendRestUse(actor, "carefulUses");
  return picked === "second" ? second : first;
}

/* ---------------------------------------------------------------------- */
/* Appraiser's Eye                                                         */
/* ---------------------------------------------------------------------- */

function quantityPath() {
  try { return game.settings.get("gatherer", "quantityPath") || "quantity"; } catch { return "quantity"; }
}

/** Take one of each named item back from the actor (the find being swapped out). */
async function takeBack(actor, items) {
  const path = quantityPath();
  for (const item of items) {
    const owned = actor.items.getName?.(item.name) ?? Array.from(actor.items ?? []).find(entry => entry.name === item.name);
    if (!owned) continue;
    const current = Number(foundry.utils.getProperty(owned.system, path)) || 0;
    if (current > 1) await owned.update({ [`system.${path}`]: current - 1 });
    else await owned.delete();
  }
}

/**
 * Appraiser's Eye, on the finder's own client after a rare find is awarded:
 * offer a reroll on the same table, then keep whichever result the player
 * prefers. Returns the kept items, or null when nothing changed.
 * @param {Actor} actor
 * @param {{tableUuid: string, items: Item[]}} find
 */
export async function offerAppraisal(actor, { tableUuid, items }) {
  if (!actor?.isOwner || !tableUuid || !items?.length) return null;
  const perks = perksFor(actor);
  const left = restUsesLeft(actor, perks, "appraiseUses");
  if (!left) return null;
  const names = items.map(item => escape(item.name)).join(", ");
  const reroll = await gpDialog().confirm({
    window: { title: "Appraiser's Eye" },
    content: `<p>Rare find: <strong>${names}</strong>.</p><p>Use <strong>Appraiser's Eye</strong> to reroll it on the same table and keep whichever you prefer? (${left} use${left === 1 ? "" : "s"} left this long rest.)</p>`,
    rejectClose: false
  });
  if (reroll !== true) return null;
  await spendRestUse(actor, "appraiseUses");
  const second = [];
  for (let draw = 0; draw < items.length; draw++) second.push(...(await drawRareFind(tableUuid)).items);
  if (!second.length) {
    ui.notifications.info(`The reroll turned up nothing better; ${actor.name} keeps ${items.map(item => item.name).join(", ")}.`);
    return null;
  }
  const label = list => list.map(item => item.name).join(", ");
  const choice = await gpDialog().wait({
    window: { title: "Appraiser's Eye: keep which?" },
    content: `<div class="gp-careful"><figure><img src="${escape(items[0].img)}" alt=""><figcaption>${escape(label(items))}</figcaption></figure>
      <figure><img src="${escape(second[0].img)}" alt=""><figcaption>${escape(label(second))}</figcaption></figure></div>`,
    buttons: [{ action: "first", label: `Keep ${label(items)}`, default: true }, { action: "second", label: `Take ${label(second)}` }],
    rejectClose: false
  });
  if (choice !== "second") return null;
  await takeBack(actor, items);
  for (const item of second) await award({ item, quantity: 1 }, actor);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="gathering-profession-check"><strong>Appraiser's Eye</strong><br>${escape(actor.name)} traded ${escape(label(items))} for <strong>${escape(label(second))}</strong>.</div>` });
  return second;
}

/* ---------------------------------------------------------------------- */
/* Field Repair and Familiar Ground                                        */
/* ---------------------------------------------------------------------- */

/** Field Repair: restore 1d4 durability to one of the actor's tools. */
export async function fieldRepair(actor, item) {
  return runActorAction(actor, () => fieldRepairUnlocked(actor, item));
}

async function fieldRepairUnlocked(actor, item) {
  if (!actor?.isOwner) throw new Error("Choose a character you own.");
  if (!item || item.parent !== actor) throw new Error("Choose one of this character's tools.");
  if (item.type !== "tool" && item.getFlag?.(MODULE_ID, "durability") === undefined) throw new Error("Choose a gathering tool.");
  const state = toolDurability(item);
  if (state.unbreakable || state.value >= state.max) throw new Error(`${item.name} needs no repair.`);
  const perks = perksFor(actor);
  if (!restUsesLeft(actor, perks, "fieldRepairs")) throw new Error(`${actor.name} has no Field Repair left this long rest.`);
  const roll = await new Roll("1d4").evaluate();
  const after = Math.min(state.max, state.value + roll.total);
  await item.setFlag(MODULE_ID, "durability", { ...(item.getFlag(MODULE_ID, "durability") ?? {}), value: after });
  await spendRestUse(actor, "fieldRepairs");
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="gathering-profession-check"><strong>Field Repair</strong><br>${escape(item.name)}: ${state.value} → ${after}/${state.max}</div>` });
  return { before: state.value, after, max: state.max };
}

/** Tools on the actor that Field Repair could fix now. */
export function repairableTools(actor) {
  return Array.from(actor?.items ?? []).filter(item => item.getFlag?.(MODULE_ID, "durability") !== undefined || item.type === "tool")
    .filter(item => { const state = toolDurability(item); return !state.unbreakable && state.value < state.max; });
}

/** Familiar Ground: the owner picks once; afterwards only the GM can change it. */
export async function setFamiliarBiome(actor, key) {
  if (!actor || !(game.user.isGM || actor.isOwner)) throw new Error("Choose a character you own.");
  const biome = getBiomes().find(entry => entry.key === key);
  if (key && !biome) throw new Error("Choose a biome from the list.");
  if (!game.user.isGM && familiarBiome(actor)) throw new Error("Only the GM can change a familiar biome.");
  if (!game.user.isGM && !(Number(perksFor(actor).familiarDc) > 0)) throw new Error(`${actor.name} does not have Familiar Ground.`);
  if (key) await actor.setFlag(MODULE_ID, "familiarBiome", key);
  else await actor.unsetFlag(MODULE_ID, "familiarBiome");
  return biome ?? null;
}

/* ---------------------------------------------------------------------- */
/* GM requests                                                             */
/* ---------------------------------------------------------------------- */

/**
 * Ask the active GM to do something this client may not. With `wait`, resolves
 * with the GM's answer (or rejects on error/timeout).
 */
export async function requestGm(actor, type, data, { wait = false } = {}) {
  if (isActiveGM()) return handleGmRequest(actor, { type, data }, game.user);
  if (!game.users?.activeGM) throw new Error("An active GM is needed for this.");
  const requestId = foundry.utils.randomID();
  await actor.setFlag(MODULE_ID, "gmRequest", { type, data, requestId });
  if (!wait) return null;
  for (let tick = 0; tick < 150; tick++) {
    await sleep(100);
    const response = actor.getFlag(MODULE_ID, `gmResponses.${requestId}`);
    if (!response) continue;
    await actor.unsetFlag(MODULE_ID, `gmResponses.${requestId}`).catch(() => {});
    if (response.error) throw new Error(response.error);
    return response.result;
  }
  throw new Error("The GM did not answer in time.");
}

const HANDLERS = { lastPull: handleLastPull, sharedHaul: handleSharedHaul, refillCut: handleRefillCut,
  gatherStart: handleGatherStart, gatherPull: handleGatherPull, gatherResult: handleGatherResult, gatherFinish: handleGatherFinish };

/** Active GM: run an authenticated request from an actor update. */
export async function handleGmRequest(actor, request, user) {
  const handler = HANDLERS[request?.type];
  if (!isActiveGM() || !handler || !user || !(user.isGM || actor.testUserPermission?.(user, "OWNER"))) return null;
  let response;
  try { response = { result: await handler(actor, request.data ?? {}, user) ?? null }; }
  catch (error) { response = { error: error.message || "Request failed." }; }
  if (request.requestId && /^[A-Za-z0-9]+$/.test(request.requestId)) await actor.setFlag(MODULE_ID, `gmResponses.${request.requestId}`, response);
  else if (response.error) throw new Error(response.error);
  return response.result;
}

async function gathererPage(uuid, user) {
  const page = typeof uuid === "string" ? await fromUuid(uuid) : null;
  if (!isGathererPage(page)) throw new Error("That gathering node no longer exists.");
  if (user && !user.isGM && !page.testUserPermission?.(user, "OBSERVER")) throw new Error("You cannot see that node.");
  return page;
}

/* Last Pull: reopen one pull on an exhausted node, reserved for this actor. */
export function requestLastPull(actor, page) {
  return requestGm(actor, "lastPull", { pageUuid: page.uuid }, { wait: true });
}

async function handleLastPull(actor, data, user) {
  const page = await gathererPage(data.pageUuid, user);
  const perks = perksFor(actor, readNode(page)?.profession);
  if (!restUsesLeft(actor, perks, "lastPulls")) throw new Error(`${actor.name} has no Last Pull left this long rest.`);
  if (!isDepleted(page)) throw new Error(`${page.name} is not exhausted.`);
  const holder = lastPullHolder(page);
  if (holder && holder !== actor.uuid) throw new Error(`Someone else is taking the last pull at ${page.name}.`);
  const { draws } = nodeUsage(page);
  await page.update({ "flags.gatherer.data.drawsUsed": Math.max(0, draws - 1),
    [`flags.${MODULE_ID}.lastPull`]: { actorUuid: actor.uuid, expires: Date.now() + LAST_PULL_MS } });
  await actor.update(restUseChanges(actor, "lastPulls"));
  return { ok: true };
}

/* Shared Haul: the assisting helper also gets some of the material. */
export async function shareHaul(helper, item, page, gatherer, profession, receiptId) {
  if (!receiptId || !helper || !item) return 0;
  const result = await requestGm(gatherer, "sharedHaul", { receiptId, helperUuid: helper.uuid,
    itemUuid: item.uuid, pageUuid: page?.uuid ?? "" }, { wait: true });
  return result?.amount ?? 0;
}

async function handleSharedHaul(gatherer, data, user) {
  const claim = await receiptAction(data.pageUuid, async () => {
    const page = await gathererPage(data.pageUuid, user);
    const receipt = readGatherReceipt(page, gatherer, data, user);
    const result = receipt.results?.[data.itemUuid];
    if (!receipt.pulled || !result || !["excellent", "masterful"].includes(result.degree)
      || result.quantity <= 0 || receipt.assist?.helperUuid !== data.helperUuid) throw new Error("Shared Haul requires a completed great gather with this Assist.");
    if (result.shared) return null;
    const helper = await fromUuid(receipt.assist.helperUuid);
    const item = await fromUuid(data.itemUuid);
    if (!helper || helper.documentName !== "Actor" || helper.uuid === gatherer.uuid || !item) throw new Error("Shared Haul: unknown helper or material.");
    const amount = Number(perksFor(helper, result.profession).sharedHaul) || 0;
    // Claim before any reward write. Failed awards remain marked for GM review;
    // replaying a request must never award a second copy.
    await page.setFlag(MODULE_ID, `gatherReceipts.${data.receiptId}.results`, { ...receipt.results,
      [data.itemUuid]: { ...result, shared: true } });
    return { helper, item, amount };
  });
  if (!claim) return { amount: 0 };
  if (claim.amount) await runActorAction(claim.helper, () => award({ item: claim.item, quantity: claim.amount }, claim.helper));
  return { amount: claim.amount };
}

function readGatherReceipt(page, actor, data, user) {
  if (!/^[A-Za-z0-9]{1,64}$/.test(data.receiptId ?? "")) throw new Error("Invalid gathering receipt.");
  const receipt = page.getFlag(MODULE_ID, `gatherReceipts.${data.receiptId}`);
  if (!receipt || receipt.actorUuid !== actor.uuid || receipt.user !== user.id || receipt.expires <= Date.now()) throw new Error("This gathering receipt is missing or expired.");
  return receipt;
}

function requireGatherLease(actor, page, id, user) {
  if (!game.users?.activeGM && user.isGM) return;
  const lease = actor.getFlag(MODULE_ID, "actionLease");
  if (lease?.id !== id || lease.user !== user.id || lease.expires <= Date.now()
    || lease.resource !== `gather-node:${page.uuid}`) throw new Error("The gathering actor and node lease is no longer held.");
}

async function handleGatherStart(actor, data, user) {
  return receiptAction(data.pageUuid, async () => {
    const page = await gathererPage(data.pageUuid, user);
    requireGatherLease(actor, page, data.receiptId, user);
    if (!/^[A-Za-z0-9]{1,64}$/.test(data.receiptId ?? "")) throw new Error("Invalid gathering receipt.");
    if (page.getFlag(MODULE_ID, `gatherReceipts.${data.receiptId}`)) throw new Error("This gathering action has already started.");
    const assist = data.assist === false ? null : findAssist(actor, page);
    const savedAssist = assist ? { helperUuid: assist.helper.uuid, bonus: assist.bonus, die: assist.die, untrainedRelief: assist.untrainedRelief } : null;
    if (assist) await assist.helper.unsetFlag(MODULE_ID, "assist");
    const receipt = { actorUuid: actor.uuid, user: user.id, expires: Date.now() + 900000,
      before: nodeUsage(page).used, assist: savedAssist, pulled: false, results: {} };
    const changes = { [`flags.${MODULE_ID}.gatherReceipts.${data.receiptId}`]: receipt };
    for (const [id, old] of Object.entries(page.getFlag(MODULE_ID, "gatherReceipts") ?? {})) {
      if (old.expires <= Date.now()) changes[`flags.${MODULE_ID}.gatherReceipts.-=${id}`] = null;
    }
    await page.update(changes);
    return receipt;
  });
}

async function handleGatherPull(actor, data, user) {
  return receiptAction(data.pageUuid, async () => {
    const page = await gathererPage(data.pageUuid, user);
    requireGatherLease(actor, page, data.receiptId, user);
    const receipt = readGatherReceipt(page, actor, data, user);
    if (receipt.pulled) return { ok: true };
    const usage = nodeUsage(page);
    if (usage.used !== receipt.before || (usage.draws && usage.used >= usage.draws)) throw new Error("This node changed during gathering. No reward was granted.");
    const changes = { [`flags.${MODULE_ID}.gatherReceipts.${data.receiptId}.pulled`]: true };
    if (data.consume !== false) changes["flags.gatherer.data"] = { ...(page.getFlag("gatherer", "data") ?? {}),
      drawsUsed: usage.draws ? usage.used + 1 : 0,
      firstDrawTime: usage.time ? (usage.used ? usage.firstDrawTime : Number(game.time?.worldTime) || 0) : 0 };
    await page.update(changes);
    return { ok: true };
  });
}

async function handleGatherResult(actor, data, user) {
  return receiptAction(data.pageUuid, async () => {
    const page = await gathererPage(data.pageUuid, user);
    requireGatherLease(actor, page, data.receiptId, user);
    const receipt = readGatherReceipt(page, actor, data, user);
    const item = typeof data.itemUuid === "string" ? await fromUuid(data.itemUuid) : null;
    const table = await fromUuid(page.flags?.gatherer?.table ?? "");
    const rule = item && materialRule(item);
    if (!receipt.pulled || !rule || !Array.from(table?.results ?? []).some(result => result.documentUuid === item.uuid)
      || !["failed", "partial", "successful", "excellent", "masterful"].includes(data.degree)
      || !Number.isInteger(data.quantity) || data.quantity < 0) throw new Error("Invalid completed gathering result.");
    if (receipt.results?.[item.uuid]) return { ok: true };
    await page.setFlag(MODULE_ID, `gatherReceipts.${data.receiptId}.results`, { ...receipt.results,
      [item.uuid]: { profession: rule.profession, degree: data.degree, quantity: data.quantity, natural20: data.natural20 === true, shared: false } });
    return { ok: true };
  });
}

async function handleGatherFinish(actor, data, user) {
  return receiptAction(data.pageUuid, async () => {
    const page = await gathererPage(data.pageUuid, user);
    requireGatherLease(actor, page, data.receiptId, user);
    const receipt = readGatherReceipt(page, actor, data, user);
    if (!receipt.pulled || receipt.finished) return null;
    const perks = perksFor(actor, readNode(page)?.profession);
    const ticket = data.ticket && actor.getFlag(MODULE_ID, `gatherTickets.${data.ticket}`);
    const changes = { [`flags.${MODULE_ID}.gatherReceipts.${data.receiptId}.finished`]: true };
    if (ticket?.pageUuid === page.uuid && ticket.expires > Date.now()) {
      await actor.unsetFlag(MODULE_ID, `gatherTickets.${data.ticket}`);
      const usage = nodeUsage(page);
      const lucky = perks.naturalRefund && Object.values(receipt.results).some(result => result.natural20);
      let refund = lucky;
      if (!refund && data.gathered && perks.conserveChance > 0) {
        refund = (await new Roll("1d100").evaluate({ allowInteractive: false })).total <= perks.conserveChance;
      }
      if (data.consume !== false && usage.draws && usage.used > receipt.before && refund) {
        changes["flags.gatherer.data.drawsUsed"] = usage.used - 1;
        ui.notifications.info(lucky ? `Lucky Strike: ${actor.name} keeps the pull.` : `${actor.name} gathered with care: one pull refunded.`);
      } else if (data.gathered && isDepleted(page) && perks.refillCut > 0) {
        changes[`flags.${MODULE_ID}.refillCut`] = Math.max(Number(page.getFlag(MODULE_ID, "refillCut")) || 0, Math.min(75, perks.refillCut));
      }
    }
    await page.update(changes);
    return { ok: true };
  });
}

/* Timekeeper: once the node is exhausted, its timer runs shorter. */
export function markRefillCut(actor, page) {
  return requestGm(actor, "refillCut", { pageUuid: page.uuid });
}

async function handleRefillCut(actor, data, user) {
  const page = await gathererPage(data.pageUuid, user);
  const cut = Math.min(75, Number(perksFor(actor, readNode(page)?.profession).refillCut) || 0);
  if (!cut) return null;
  // Gatherer does not await its pull update; give it a moment to land.
  for (let tick = 0; tick < 25 && !isDepleted(page); tick++) await sleep(200);
  if (!isDepleted(page)) return null;
  if ((Number(page.getFlag(MODULE_ID, "refillCut")) || 0) >= cut) return null;
  await page.setFlag(MODULE_ID, "refillCut", cut);
  return { cut };
}
