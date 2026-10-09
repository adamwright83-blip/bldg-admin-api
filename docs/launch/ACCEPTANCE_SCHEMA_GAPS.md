# Real backend acceptance: production bootstrap gaps

The real browser/backend acceptance run found missing stores after `node scripts/migrate.mjs`: `sales_intel_teachings`, `territory_operator_profiles`, `territory_scan_results`, `operations_events`, and `sales_intel_source_artifacts.sourceRegistryId`. Unlike mocked frontend responses, actual world and customer context readers execute these MySQL queries.

The existing numbered DDL already defines the required schema:

| DDL | Schema |
| --- | --- |
| `drizzle/0027_operations_events.sql` | Operations event table and read indexes |
| `drizzle/0036_territory_intelligence.sql` | Territory operator profiles, scan sessions, scan results |
| `drizzle/0055_sales_intel_source_registry.sql` | Sales source registry, nullable artifact registry column and index |
| `drizzle/0056_sales_intel_teachings.sql` | Sales teaching corpus |

The production bootstrap explicitly does not replay every numbered migration. This repair admits only these historical definitions through the existing idempotent table/index helpers, guards the nullable column, and verifies required columns. It does not invent schemas, backfill business evidence, or modify authorization.

**APPROVAL REQUIRED: production schema changes.** This PR must remain open until Adam approves it; passing disposable acceptance cannot establish that an unrepaired production database can serve the same readers.

The independent acceptance environment can apply these same existing definitions using the strictly guarded `scripts/acceptance-schema-compat.mjs` helper on its own branch. That helper requires an explicit localhost `joystick_real_acceptance` database and cannot apply changes to production. Final launch evidence must disclose this compatibility setup and the held production repair.

Validation: `node --check scripts/migrate.mjs` passed. Real MySQL validation is recorded with the hosted/disposable acceptance run when executed; syntax checking alone is not database execution evidence.
