// Campaign pricing math and the compendium entry rule. In-memory only.
import assert from "node:assert/strict";

globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((v, k) => v?.[k], o) } };
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.game = { settings: { get() { return undefined; } }, modules: new Map() };
const pricing = await import("../scripts/pricing.js");

// Tidy prices: upward whole-silver rounding at all price levels.
assert.deepEqual(pricing.tidyPrice(0.034), { value: 1, denomination: "sp" }, "Silver and gold only: at least 1 sp");
assert.deepEqual(pricing.tidyPrice(0.004), { value: 1, denomination: "sp" }, "Never rounds a priced item to nothing");
assert.deepEqual(pricing.tidyPrice(0.46), { value: 5, denomination: "sp" });
assert.deepEqual(pricing.tidyPrice(7.4), { value: 7.4, denomination: "gp" });
assert.deepEqual(pricing.tidyPrice(87.6), { value: 87.6, denomination: "gp" });
assert.deepEqual(pricing.tidyPrice(38.71), { value: 38.8, denomination: "gp" });
assert.deepEqual(pricing.tidyPrice(0.1 + 0.2), { value: 3, denomination: "sp" }, "Floating point noise does not add a silver");
assert.deepEqual(pricing.tidyPrice(0), { value: 0, denomination: "gp" });
assert.equal(pricing.priceInGp({ value: 5, denomination: "sp" }), 0.5);
// Book prices halved: longsword 15 gp → 7 gp 5 sp, plate 1,500 → 750, rope 1 gp → 5 sp; minimum 1 sp.
assert.deepEqual(pricing.campaignPrice({ value: 15, denomination: "gp" }), { value: 7.5, denomination: "gp" });
assert.deepEqual(pricing.campaignPrice({ value: 1500, denomination: "gp" }), { value: 750, denomination: "gp" });
assert.deepEqual(pricing.campaignPrice({ value: 1, denomination: "gp" }), { value: 5, denomination: "sp" });
assert.deepEqual(pricing.campaignPrice({ value: 1, denomination: "cp" }), { value: 1, denomination: "sp" }, "No copper");
assert.equal(pricing.oddCoin({ value: 3, denomination: "cp" }), true);
assert.equal(pricing.oddCoin({ value: 3, denomination: "sp" }), false);
// Bands: approved values (materials T1 5 cp–1.5 sp … T5 7.5–22.5 gp; rare finds T1 1–3 gp … T5 50–100 gp).
assert.deepEqual(pricing.MATERIAL_BANDS[0], [0.1, 0.2]);
assert.deepEqual(pricing.RARE_BANDS[4], [50, 100], "Tier 5 rare finds top out at 100 gp");
// Spread keeps the old order; equal old prices share a value; a lone item sits mid-band.
const spread = pricing.spreadInBand([{ key: "a", old: 500 }, { key: "b", old: 0.5 }, { key: "c", old: 30 }, { key: "d", old: 30 }], [1, 3]);
assert.deepEqual([spread.get("b"), spread.get("a")], [1, 3]);
assert.equal(spread.get("c"), spread.get("d"));
assert.ok(spread.get("c") > 1 && spread.get("c") < 3);
assert.ok(Math.abs(pricing.spreadInBand([{ key: "x", old: 9 }], [1, 4]).get("x") - 2) < 1e-9, "Geometric middle");
// Refined goods: ingredients + 25%, rounded/chained; highest-cost recipe establishes the minimum.
const costs = pricing.recipeCosts([
  { output: "Copper Ingot", quantity: 1, inputs: [["Copper Ore", 2], ["Coal", 1]] },
  { output: "Pick", quantity: 1, inputs: [["Copper Ingot", 2]] },
  { output: "Glass", quantity: 1, inputs: [["Sand", 4]] },
  { output: "Glass", quantity: 2, inputs: [["Sand", 2]] }
], new Map([["Copper Ore", 0.1], ["Coal", 0.1], ["Sand", 0.05]]));
assert.ok(Math.abs(costs.get("Copper Ingot") - 0.4) < 1e-9);
assert.ok(Math.abs(costs.get("Pick") - 1) < 1e-9, "Final rounded ingredient prices feed downstream products");
assert.ok(Math.abs(costs.get("Glass") - 0.3) < 1e-9, "Most expensive recipe per unit");
const reverse = pricing.recipeCosts([
  { output: "Tool", quantity: 1, inputs: [["Ingot", 2]] },
  { output: "Ingot", quantity: 1, inputs: [["Ore", 3]] }
], new Map([["Ore", 0.1], ["Ingot", 0.1], ["Tool", 0.1]]));
assert.equal(reverse.get("Ingot"), 0.4);
assert.equal(reverse.get("Tool"), 1, "Existing products remain floors, not stale ingredient costs");
// Entry rule: compendium items are halved once; flagged copies keep their price.
const make = data => ({ data, updateSource(changes) { for (const [path, value] of Object.entries(changes)) { const keys = path.split("."); const last = keys.pop(); keys.reduce((o, k) => (o[k] ??= {}), this.data)[last] = value; } } });
const sword = make({ name: "Longsword", system: { price: { value: 15, denomination: "gp" } }, _stats: { compendiumSource: "Compendium.dnd5e.equipment24.Item.x" } });
pricing.priceOnCreate(sword, sword.data);
assert.deepEqual(sword.data.system.price, { value: 7.5, denomination: "gp" });
assert.deepEqual(sword.data.flags["gathering-professions"].campaignPrice.book, { value: 15, denomination: "gp" });
const copy = make(structuredClone(sword.data));
pricing.priceOnCreate(copy, copy.data);
assert.deepEqual(copy.data.system.price, { value: 7.5, denomination: "gp" }, "Copies are not halved again");
const homebrew = make({ name: "Homebrew", system: { price: { value: 4, denomination: "gp" } } });
pricing.priceOnCreate(homebrew, homebrew.data);
assert.equal(homebrew.data.system.price.value, 4, "Items made in the world keep their price");
// Standard gear by type, even without a compendium source (starting equipment).
const fiddle = make({ name: "Fiddle", system: { price: { value: 25, denomination: "gp" } } });
pricing.priceOnCreate(fiddle, fiddle.data);
assert.deepEqual(fiddle.data.system.price, { value: 12, denomination: "gp" });
const coppers = make({ name: "Odd Trinket", system: { price: { value: 7, denomination: "cp" } } });
pricing.priceOnCreate(coppers, coppers.data);
assert.deepEqual(coppers.data.system.price, { value: 1, denomination: "sp" }, "Copper prices become silver");
const honey = make({ name: "Honey", system: { price: { value: 13, denomination: "gp" } }, flags: { "gathering-professions": { campaignPrice: { approved: 0.2, book: { value: 2, denomination: "gp" } } } } });
pricing.priceOnCreate(honey, honey.data);
assert.deepEqual(honey.data.system.price, { value: 2, denomination: "sp" });
assert.equal(honey.data.flags["gathering-professions"].campaignPrice.book.value, 2, "Approved prices preserve provenance");

console.log("PASS: pricing — tidy prices, half book, bands, spread, refined costs, compendium entry rule.");
