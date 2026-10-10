# Profession and world audit repairs — 2026-10-10

## Releases

- Gathering Professions 0.33.0.
- Crafting Professions 0.8.0, requiring Gathering Professions 0.33.0.

## Code repairs

| Area | Repair |
|---|---|
| Gathering concurrency | Whole-action character/node leases; GM-confirmed pull writes before rewards. |
| Assist / Shared Haul | Authenticated gathering receipts with single-use reward claims. |
| Bounty rewards | Persist reward job, completion, and XP together; preserve delivery receipts after consumption/transfers. |
| Meals | Reserve servings before benefits; recover operational failures; next-save expiry follows dnd5e save hooks. |
| Party cooking abilities | Active GM authenticates the requesting owner and party targets; durable single-use requests prevent replay. |
| Profession state | Serialize choices, learning, talents, and relevant GM edits; re-read state within the lease. |
| Experimenting | Require carried positive-quantity ingredients; do not consume them. |
| Pricing | Preserve quality/value premiums; recover stale actor prices after world repricing. |
| Recipe graphs | Reject indirect enabled cycles across providers before pricing and recipe changes. |
| Skill purchases | Rebuild dependency models under the actor lease; commit skills and points together. |
| Placements | Put linked nodes in the destination scene; clear temporary placement effects on duplicates. |
| Field Repair | Serialize and revalidate repair eligibility. |
| Gathering limits | Expire temporary exhaustion predictions; block maximum exhaustion even with Second Wind. |
| Gathering window | Refresh relevant inventory/table/scene/settings/time changes; batch refreshes and remove hooks on close. |

## Confirmed live-world repairs

- Iron Vein now uses a new Observer-visible table containing the existing Iron Ore item.
- Feywild rolls cover all four faces without gaps: Fairy Stool 1; Pixie Parasol 2–4.
- Cassius's Fiddle points to an existing image.
- Each mutation had a successful dry run and a fresh verification read. No documents were deleted.

Backup: `Data/backups-gp/eryndor-audit-repairs-before-2026-10-10.json`. Exact mutation request files are alongside it.

## Verification

Local gates: `node modules/gathering-professions/tests/gatherer-check.mjs` and `node modules/crafting-professions/tests/check.mjs`. Source syntax is checked with Node. Tests use in-memory documents, including failure injection and simulated clients; they do not execute gameplay in the running world.

The running Foundry clients have not loaded these updated scripts yet. Restart Foundry and reconnect every client. Verify simultaneous gathers on the same node, cross-owner party meals, next-save expiry, mutually exclusive tree purchases from separate windows, field repairs, linked placements on another scene, and delivery recovery after reconnecting.

## Deliberately unchanged campaign decisions

- Obsolete tables with missing references, test nodes, and unusual node contents: archive/delete only after the user chooses.
- Stored rank versus XP-derived rank: preserve the current advancement mode until the user decides.
- Missing material-source coverage: requires decisions about where resources should appear.
- Owner-level journals: reducing permissions can alter campaign workflows; await authorization.
- Legacy bounty-contract design and broader balance changes are not silently rewritten.

These are unresolved campaign choices, not claimed as repaired. No obsolete world documents or user-created data were deleted.
