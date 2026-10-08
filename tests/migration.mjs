import assert from "node:assert/strict";

globalThis.foundry = { utils: { deepClone: structuredClone } };

class Document {
  static metadata = { embedded: { Child: "children" } };
  constructor(uuid, flags = {}, children = []) {
    this.uuid = uuid;
    this.flags = structuredClone(flags);
    this.children = children;
    this.updates = 0;
  }
  getEmbeddedCollection(name) { return name === "Child" ? this.children : []; }
  async update(changes) {
    this.flags["gathering-professions"] = structuredClone(changes["flags.gathering-professions"]);
    this.updates++;
    return this;
  }
}

const child = new Document("Actor.parent.Item.child", {
  "eryndor-professions": { perk: { enabled: true, yieldBonus: 2 } }
});
const parent = new Document("Actor.parent", {
  "eryndor-professions": { xp: { mining: 50 }, selectedProfession: "mining" },
  "gathering-professions": { xp: { mining: 75 } }
}, [child]);
const untouched = new Document("Item.untouched", { unrelated: { value: true } });

const storage = new Map([
  ["eryndor-professions.rules", { value: { gatherAttemptsPerRest: 7 } }],
  ["eryndor-professions.professions", { value: [{ key: "mining", name: "Old Mining" }] }],
  ["gathering-professions.professions", { value: [{ key: "mining", name: "Current Mining" }] }]
]);
const values = { legacyMigrationVersion: 0 };
globalThis.game = {
  user: { isGM: true },
  collections: new Map([["Actor", [parent]], ["Item", [untouched]]]),
  users: [],
  settings: {
    storage: new Map([["world", storage]]),
    get(_scope, key) { return values[key]; },
    async set(scope, key, value) {
      values[key] = structuredClone(value);
      storage.set(`${scope}.${key}`, { value: structuredClone(value) });
      return value;
    }
  }
};

const migration = await import("../scripts/migration.js");
assert.equal(migration.LEGACY_MODULE_ID, "eryndor-professions");
const report = await migration.migrateLegacyNamespace();
assert.deepEqual(report, { migrated: true, reason: "complete", settings: 1, documents: 2 });
assert.deepEqual(values.rules, { gatherAttemptsPerRest: 7 }, "Missing new setting is copied");
assert.equal(values.professions, undefined, "Existing new setting is not overwritten");
assert.deepEqual(parent.flags["gathering-professions"], {
  xp: { mining: 75 }, selectedProfession: "mining"
}, "Current values win while missing legacy fields are retained");
assert.deepEqual(parent.flags["eryndor-professions"], {
  xp: { mining: 50 }, selectedProfession: "mining"
}, "Legacy flags remain available for rollback");
assert.deepEqual(child.flags["gathering-professions"], { perk: { enabled: true, yieldBonus: 2 } },
  "Embedded document flags are migrated");
assert.equal(untouched.updates, 0, "Unrelated documents are not written");
assert.equal(values.legacyMigrationVersion, 1);

const retry = await migration.migrateLegacyNamespace();
assert.deepEqual(retry, { migrated: false, reason: "complete", settings: 0, documents: 0 });
assert.deepEqual([parent.updates, child.updates], [1, 1], "Completed migration is idempotent");

console.log("PASS: legacy module settings and document flags migrate without deleting rollback data.");
