# Claire V1 completion ledger

Internal map for the Claire V1 program. Prompt A (orientation) is merged, deployed, and live-tested. Do not recreate it.

Status keys: **exists** / **partial** / **missing**. Live acceptance is recorded only after Adam’s authenticated call.

| Track | Architecture | Production reachable | Live acceptance |
|---|---|---|---|
| Temporal orientation | exists | yes | Prompt A passed |
| Macro goals | exists | yes | Prompt A passed |
| Today/tomorrow work | exists | yes | Prompt A passed |
| Campaign awareness | exists | yes | Prompt A passed |
| Disputed active-customer metric | omitted from Claire | contained | Prompt A passed (must not say 18) |
| Voice commitment loop | exists + NEEDS_DETAILS + update-in-place | code complete; not V1-deployed | pending Slice 47 |
| Driver projection of commitments | exists; yellow = presentation of NEEDS_DETAILS | code complete; not V1-deployed | pending Slice 47 |
| MissionSalesBrief | evidence watermark includes visit recordedAt; facts grounded; intel audit; teachingId ≠ frameworkId | yes when missionId present | pending Slice 47 |
| Character / relationship | call_completed no longer farms tier | code complete; not V1-deployed | pending Slice 47 |
| Personal canon | explicit topic detection; field mode can answer a direct question | code complete; not V1-deployed | pending Slice 47 |
| Relationship events | CALL_COMPLETED vs follow-through vs hard win | code complete | pending Slice 47 |
| Action permissions | ladder spoken in operator language | code complete | pending Slice 47 |
| Outcome / field notes | conversational capture + hearsay split | code complete; not V1-deployed | pending Slice 47 |
| Strategic reasoning | goal-first policy in opening + follow-up | code complete | pending Slice 47 |
| Blocker / readiness | avoidance → one-question coaching | code complete | pending Slice 47 |
| Relevant memory | topic-ranked recent history | partial | pending Slice 47 |
| Mobile/desktop Claire identity | one operator key; one assemble path | contract tests | pending Slice 47 |
| Conversational field capture | extract + confirm + persist | code complete | pending Slice 47 |
| Observability | orientation + picture + brief ids + conversion joins | code complete | pending Slice 47 |

Reuse, do not rebuild:

- `shared/goldlineActionContract.ts` — AUTO / AUTO_INFORM / APPROVAL_REQUIRED / HUMAN_EXECUTION
- `shared/goldlineWorld.ts` — evidence / action / outcome classifications + provenance
- `day_director_commitments.metadataJson` — `detailState` / schedule / missingDetails (no new column)
- Prompt A context: clock, macroGoal, workPicture, campaign
