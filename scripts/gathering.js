// Shared gathering rules: independent of a profession, actor, or Gatherer node.
const DEGREES = Object.freeze([
  Object.freeze({ id: "failed", label: "Failed Extraction", yieldMode: "none", bonus: 0 }),
  Object.freeze({ id: "partial", label: "Partial Extraction", yieldMode: "one", bonus: 0 }),
  Object.freeze({ id: "successful", label: "Successful Extraction", yieldMode: "roll", bonus: 0 }),
  Object.freeze({ id: "excellent", label: "Excellent Extraction", yieldMode: "roll", bonus: 1 }),
  Object.freeze({ id: "masterful", label: "Masterful Extraction", yieldMode: "maximum", bonus: 1 })
]);

export function getDegreeOfSuccess(rollTotal, finalDC) {
  const margin = rollTotal - finalDC;
  if (!Number.isFinite(margin)) throw new Error("The gathering roll and final DC must be finite numbers.");
  const index = margin <= -5 ? 0 : margin < 0 ? 1 : margin < 5 ? 2 : margin < 10 ? 3 : 4;
  return { ...DEGREES[index], margin };
}

/** Grandmaster's Touch: a Partial extraction becomes Successful (margin kept). */
export function upgradePartial(degree) {
  if (degree?.id !== "partial") return degree;
  return { ...DEGREES[2], margin: degree.margin, upgraded: true };
}

/** Grandmaster's Touch: a Masterful extraction with no check roll. */
export function autoMasterful() {
  return { ...DEGREES[4], margin: 0, auto: true };
}

/** A natural 20 on the gathering check is always a Masterful extraction. */
export function naturalMasterful(degree) {
  return { ...DEGREES[4], margin: degree.margin, natural: true };
}

export function baseYieldFormula(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "1";
}

export function validateBaseYield(value) {
  if (value != null && typeof value !== "string") throw new Error("Base Yield must be a dice formula stored as text.");
  const formula = baseYieldFormula(value);
  if (!Roll.validate(formula)) throw new Error("Base Yield is not a valid dice formula.");
  return formula;
}

export async function calculateGatheringYield(material, degree) {
  const baseYield = baseYieldFormula(material.baseYield);
  if (degree.yieldMode === "none" || degree.yieldMode === "one") {
    return { baseYield, quantity: degree.yieldMode === "one" ? 1 : 0, bonus: 0, baseTotal: null, roll: null, maximized: false };
  }
  const maximized = degree.yieldMode === "maximum";
  const formula = validateBaseYield(baseYield);
  // Foundry V14 supports maximum evaluation through the same async API.
  const roll = await new Roll(formula).evaluate(maximized ? { maximize: true, allowInteractive: false } : {});
  if (!Number.isSafeInteger(roll.total) || roll.total < 1) {
    throw new Error(`Base Yield (${formula}) must produce a positive whole number; got ${roll.total}.`);
  }
  const quantity = roll.total + degree.bonus;
  if (!Number.isSafeInteger(quantity)) throw new Error("The final gathering quantity is too large.");
  return { baseYield, quantity, bonus: degree.bonus, baseTotal: roll.total, roll, maximized };
}

// Keep XP policy separate from extraction quantity for future progression rules.
export function gatheringXp(material, degree) {
  return ["successful", "excellent", "masterful"].includes(degree.id) ? material.xp : 0;
}
