# JOYSTICK — architecture entrypoint

> Read first when changing the repository. This is the **current-system guide**, not permission to treat folder labels as legal write authority. Verified against `main@7ba7310df76a` on October 8, 2026. Recheck live `main`, open PRs and [Program D certification](docs/architecture/PROGRAM_D_CERTIFICATION.md) before editing.

## What this product does

**JOYSTICK is a playable operating system for running a real business.** Its Goldline experience turns real operator work into missions, a prioritized **Day Line**, and a downstream fictional world. **Claire** is the conversational chief of staff; **Daphne** adapts how agents interact with the operator. Verified real outcomes may change the game; the game must never invent the customer, visit, payment, captured dollars, delivery or commercial win. See [the product system map](docs/JOYSTICK_SYSTEM_MAP.md), [architecture convergence status](docs/architecture/ARCHITECTURE_CONVERGENCE_STATUS.md), and [game canon](GOLDLINE_CANON.md) for their respective scopes.

## The authority rule

**One owning domain → one legal write path → explicit evidence/admission → canonical read → downstream consumer.** Filesystem location alone is not evidence of authority. For legacy or historical records with unknown tenant, payment occurrence, or amount, preserve **unknown** rather than manufacturing certainty. The legitimate Laundry Farm tenant `default` must not become a fallback for unknown owners.

## Where to make changes

| Task or fact | Start here | Boundary |
| --- | --- | --- |
| Native order creation / pickup / delivery | `server/orders/orderLifecycleService.ts` | Orders owns lifecycle, including actions initiated by Driver. |
| Driver's order interface | `server/joystick/driverOrderService.ts` | Driver is not Vendor and does not grant native Order authority. |
| Native Stripe payment proof | `server/authority/paymentAdmission.ts` | A Payment receipt does **not** establish historical captured dollars without capture evidence. |
| Native payment facts | `server/authority/nativePaymentReadService.ts` | Read evidence; do not infer paid from an editable order price or status. |
| Commercial conversion | `server/commercialPipeline/commercialPipelineService.ts` | `won` = accepted/verbal conversion; not payment. |
| CleanCloud sync | `server/cleancloudBrowserSync/` | External operational evidence, not native Payment authority. Tenantless historical importer stays a legacy exception. |
| Mission ranking | `server/missionDirector/` | Mission Director is sole deterministic ranker. |
| Commitments / Day Line | `server/dayDirector/`, `server/goldline/dayline/` | Work lists are not evidence that field work happened. |
| Claire turn logic | `server/claire/turn/claireTurn.ts` | Business facts come from read ports; conversational claims have guards. |
| Daphne preferences | `server/daphne/`, `server/operatorRepresentative/` | Daphne adapts interaction; **PR #495 owns its eight touched files until merged**. |
| President | `server/president/` | Company improvements; does **not** manage Mitch. |
| Mitch | `server/mitch/` | Independent game-production seat directed by operator. |
| Lantern City/world | `server/lanternCity/`, `server/goldlineWorld/` | Projection and fiction consume reality; they cannot mint business truth. |
| SaaS/tenant membership | `server/saas/` | No implicit tenant fallback. |
| External resident agent tools | `server/agents/` | Preserve externally used tool names, payload/response contracts and approval gates. |
| HTTP/tRPC composition | `server/routers.ts`, `server/_core/` | Composition is not owning-domain authority. |
| Live historical DayForge compatibility | `server/legacyDayforge*/`, `docs/legacy/` | Legacy names are not proof code is unused. |

## How to navigate and prove a change

1. Check [machine-readable concept ownership](docs/architecture/PROGRAM_E_OWNERSHIP_MAP.json) and [E0 classification](docs/architecture/PROGRAM_E_CLASSIFICATION.md). They identify current paths and unresolved mixed responsibilities, **not** completed folder moves.
2. Read the actual owning entrypoint and downstream callers; consult [target domain contract](docs/architecture/TARGET_DOMAIN_CONTRACT.md).
3. Inspect the protected/open PRs and exclude intersecting files. In particular freeze [Daphne PR #495](https://github.com/adamwright83-blip/bldg-admin-api/pull/495) files until Daphne merges it; do not touch [Claire PR #476](https://github.com/adamwright83-blip/bldg-admin-api/pull/476) as collateral.
4. Use existing tests and guards (`pnpm check`, `pnpm check:nomenclature`, `pnpm check:tenant-ratchet`, `pnpm check:vertical-dependencies`, `pnpm check:domain-boundaries`). A failed baseline is not a license to weaken a guard.
5. State what is **verified from a file** versus **inferred**. Mark missing business authority, historical monetary evidence, or uninspected areas **UNKNOWN**.

**Known misleading names:** `goldline/` mixes current Day Line with historical helpers; `joystick/` includes Driver adapters and tenant identity; `businessWorld/`, `driverGameWorld/`, `goldlineWorld/`, `worldForge/`, and `lanternCity/` are not interchangeable truth owners. Review the E0 path classification before splitting or moving any of them.

**Program status:** A–D certified for audited boundaries. **E0/E1** establish the navigational map; E2–E8 require individually proved moves and an independent cold-model comprehension test. Do not declare Program E complete because this file exists.
