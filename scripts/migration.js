// One-way compatibility copy for the 0.18.0 package rename. Legacy data stays
// in place for rollback; current code reads and writes only the new namespace.
import { MODULE_ID } from "./rules.js";

export const LEGACY_MODULE_ID = "eryndor-professions";
export const LEGACY_MIGRATION_VERSION = 1;
export const LEGACY_SETTING_KEYS = Object.freeze([
  "rules", "professions", "biomes", "conditionOverrides", "conditionDc",
  "toolLibrary", "worldContentVersion", "skillTree"
]);

const clone = value => globalThis.foundry?.utils?.deepClone
  ? foundry.utils.deepClone(value) : structuredClone(value);

function mergeObjects(legacy, current) {
  const output = clone(legacy ?? {});
  for (const [key, value] of Object.entries(current ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)
        && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = mergeObjects(output[key], value);
    } else output[key] = clone(value);
  }
  return output;
}

/** New values win, while missing keys are recovered from the legacy scope. */
export function mergeLegacyFlags(legacy, current) {
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return null;
  return mergeObjects(legacy, current);
}

function collectionValues(collections) {
  if (!collections) return [];
  if (typeof collections.values === "function") return collections.values();
  return Object.values(collections);
}

/** Include top-level world documents and their embedded documents. */
export function collectWorldDocuments(gameRef = globalThis.game) {
  const documents = [];
  const seen = new WeakSet();
  const visitCollection = collection => {
    if (!collection || typeof collection[Symbol.iterator] !== "function") return;
    for (const document of collection) visit(document);
  };
  const visit = document => {
    if (!document || typeof document !== "object" || seen.has(document)) return;
    seen.add(document);
    if (typeof document.update === "function") documents.push(document);
    const embedded = document.constructor?.metadata?.embedded ?? {};
    for (const name of Object.keys(embedded)) {
      try { visitCollection(document.getEmbeddedCollection?.(name)); }
      catch { /* A document may expose metadata before its collection exists. */ }
    }
    // Test doubles and older documents may not publish embedded metadata.
    for (const key of ["items", "effects", "pages", "results", "tokens", "notes", "regions", "tiles", "drawings", "lights", "sounds", "walls", "templates", "cards"]) {
      visitCollection(document[key]);
    }
  };
  for (const collection of collectionValues(gameRef?.collections)) visitCollection(collection);
  visitCollection(gameRef?.users);
  return documents;
}

function storedValue(setting) {
  if (!setting) return undefined;
  const value = setting.value ?? setting._source?.value;
  if (typeof value !== "string") return clone(value);
  try { return JSON.parse(value); }
  catch { return value; }
}

/**
 * Copy old settings and flags into gathering-professions. Safe to retry.
 * Existing new-namespace values win. The old namespace is never removed.
 */
export async function migrateLegacyNamespace(gameRef = globalThis.game) {
  if (!gameRef?.user?.isGM) return { migrated: false, reason: "gm-required", settings: 0, documents: 0 };
  const completed = Number(gameRef.settings.get(MODULE_ID, "legacyMigrationVersion")) || 0;
  if (completed >= LEGACY_MIGRATION_VERSION) return { migrated: false, reason: "complete", settings: 0, documents: 0 };

  const storage = gameRef.settings.storage?.get?.("world");
  // Isolated tests and first-party consumers may not expose raw setting storage.
  if (!storage?.get) return { migrated: false, reason: "storage-unavailable", settings: 0, documents: 0 };

  let settings = 0;
  for (const key of LEGACY_SETTING_KEYS) {
    const legacy = storage.get(`${LEGACY_MODULE_ID}.${key}`);
    const current = storage.get(`${MODULE_ID}.${key}`);
    if (!legacy || current) continue;
    await gameRef.settings.set(MODULE_ID, key, storedValue(legacy));
    settings++;
  }

  let documents = 0;
  const failures = [];
  for (const document of collectWorldDocuments(gameRef)) {
    const legacy = document.flags?.[LEGACY_MODULE_ID] ?? document._source?.flags?.[LEGACY_MODULE_ID];
    const merged = mergeLegacyFlags(legacy, document.flags?.[MODULE_ID]);
    if (!merged) continue;
    try {
      if (JSON.stringify(merged) !== JSON.stringify(document.flags?.[MODULE_ID] ?? {})) {
        await document.update({ [`flags.${MODULE_ID}`]: merged });
        documents++;
      }
    } catch (error) {
      failures.push(`${document.uuid ?? document.id ?? document.name ?? "document"}: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Legacy namespace migration failed for ${failures.length} document(s): ${failures.slice(0, 3).join("; ")}`);
  }
  await gameRef.settings.set(MODULE_ID, "legacyMigrationVersion", LEGACY_MIGRATION_VERSION);
  return { migrated: settings > 0 || documents > 0, reason: "complete", settings, documents };
}
