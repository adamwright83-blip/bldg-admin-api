# Tower Wars promise seam

Tower Wars currently has no authoritative Daily Dump promise parser or persisted promise repository. The production UI therefore renders all promise-backed comeback actions as **Not configured** and performs no mutation.

`shared/towerWars.ts` defines the minimum future read contract: building, promise type, source text, quantity, permission status, permission channel, created date, fulfillment state, next action, and source reference. Direct resident outreach is permitted by the helper only when explicit recorded permission exists for SMS, email, or phone. Physical collateral uses the separate physical-delivery channel.

No database migration or speculative extraction service is included in this change. A future producer must persist evidence and expose a tenant-scoped query before the Admin UI can enable a comeback action.
