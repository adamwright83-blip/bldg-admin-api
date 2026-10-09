# Real backend acceptance: production bootstrap gaps

The real browser/backend acceptance run found missing stores after `node scripts/migrate.mjs`: `sales_intel_teachings`, `territory_operator_profiles`, `territory_scan_results`, `operations_events`, and `sales_intel_source_artifacts.sourceRegistryId`. Unlike mocked frontend responses, actual world and customer context readers execute these MySQL queries.

The existing numbered DDL already defines the required schema:

| DDL | Schema |
| --- | --- |
| `drizzle/0027_operations_events.sql` | Operations event table and read indexes |
| `drizzle/0036_territory_intelligence.sql` | Territory operator profiles, scan sessions, scan results |
| `drizzle/0038_commercial_mission_field.sql` | Commercial visit outcome fields, field states, checklist and phone handoff tables |
| `drizzle/0039_commercial_proposals.sql` | Proposal profiles, proposals and proposal events |
| `drizzle/0045_dayforge_30_day_foundation.sql` | ONLY commercial mission coaching artifacts CREATE; no payment or entitlement DDL |
| `drizzle/0055_sales_intel_source_registry.sql` | Sales source registry, nullable artifact registry column and index |
| `drizzle/0056_sales_intel_teachings.sql` | Sales teaching corpus |

The production bootstrap explicitly does not replay every numbered migration. This repair admits only these historical definitions through the existing idempotent table/index helpers, guards the nullable column, and verifies required columns. It does not invent schemas, backfill business evidence, or modify authorization.

**APPROVAL REQUIRED: production schema changes.** This PR must remain open until Adam approves it; passing disposable acceptance cannot establish that an unrepaired production database can serve the same readers.

The independent acceptance environment can apply these same existing definitions using the strictly guarded `scripts/acceptance-schema-compat.mjs` helper on its own branch. That helper requires an explicit localhost `joystick_real_acceptance` database and cannot apply changes to production. Final launch evidence must disclose this compatibility setup and the held production repair.

Validation: `node --check scripts/migrate.mjs` passed. The updated candidate ran `DATABASE_URL=mysql://root:root@127.0.0.1:3418/joystick_schema_acceptance_repair node scripts/migrate.mjs` twice against an independent disposable MySQL database, proving repeat bootstrap. Direct real SQL reads passed for operations, territory, source registry, teaching, checklist, field-state and handoff tables plus all seven 0038 visit fields and artifact `sourceRegistryId`. The disposable database was dropped afterward. These are REAL MYSQL INTEGRATION results, not browser or production deployment evidence.

The expanded candidate also passed fresh and repeat boot, with real MySQL all-column reads of coaching artifacts, proposal profiles, proposals, and proposal events. Adjacent Armory journal/playbook reads already have motivation-store setup; no coaching or Claire logic was rewritten.
