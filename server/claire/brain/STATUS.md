# Claire Brain V2

Architecture: COMPLETE
Contracts: COMPLETE
Business Memory: LIVE read-only (injected readers) + authoritative entity resolution
Episodic / Self / Goals: LIVE read-only adapters, wired into the observer
Perception: entity mentions (no shape heuristic), personal + narrative probes,
  correction target, complete-thought assembler — assembler NOT yet owning live voice
Working Memory: COMPLETE (ordered query — resolved ≠ presented)
Shadow Working Memory: DURABLE via claire-brain-v2-shadow namespace; in-memory for tests
Executive Attention / Retrieval / Integration / Inhibition: COMPLETE
  (WM gate, TaskSets, ConflictMonitor, EpistemicState, ControlAllocator, two-pass retrieval)
Executive task switching + mission intent: SHADOW COGNITION ONLY
  Strategic work is an activeWorkFrame (cognitive_only). No mission write path exists.
  Pending task-switch is dormant+suppress, not reject/delete/commit.
  productionAuthority false. mutationAllowed false. shadowOnly true.
Business Judgment: COMPLETE for shadow (deterministic only; model seam exists but is not injected)
Executive Governor: COMPLETE (mixed-lane firewall ENFORCED)
Response Plan: COMPLETE (segments carry real content: facts, judgments, proposals)
Character Renderer: NOT COMPLETE — punctuation + concatenation + `assertRenderedFromPlan`.
  Required before cutover, not before first semantic shadow.
Action Gateway: COMPLETE (refuses live mutations)
Shadow Mode: WIRED on both surfaces, one-way, DEFAULT OFF, operator-scoped,
  live read-only retrieval, durable WM, durable safe telemetry
Production Cutover: PROHIBITED

Tests: 311 passed, 0 todo (brain). Full suite: 760 files, 7795 passed, 7 skipped. `tsc --noEmit` green.

Read-only enforcement: Self Memory uses `readPersonalProgressionContext`, NOT
`loadPersonalProgressionContext` (which releases expired reservations — a write).
Goals use `loadObligations`, NOT `ensureAdamBoard` (which CREATES obligations).
`compartments.test.ts` asserts the write-capable siblings are unreachable from an
observer.

Authority stage: **B — shadow observation** (see `docs/claire-brain-v2.md` §19a).

```
BRAIN V2 MAY OBSERVE A COMPLETED V1 TURN.
BRAIN V2 MAY NEVER AFFECT THAT TURN.
```

**The flag stays OFF.** `CLAIRE_BRAIN_V2_SHADOW=1` enables observation; unset or
malformed disables it, and with it off there is no V2 execution, no added model calls
and no added DB reads. Even with the flag on, only `isAuthorizedProductionOperator`
(`default` + `adam-admin`/`adam`) is observed.

## Genuine remaining gaps

### Required before first semantic shadow

None that still block the real observer path from exercising the executive loop,
receipt reread, operations context, scoped account judgment, durable V2 WM, or
safe telemetry. Do not turn the flag on until Adam authorizes a validation trial.

Provenance: **LEGACY COMPATIBILITY REMAINS.** `UNKNOWN_LEGACY` plus the display-name
shim still admit rows with no write-path columns. Account/contact readers now pass
`identityKey` / `providerName` / `providerAccountId` when present. Do not claim full
structural provenance while the shim remains.

Live DB: **not verified.** `DATABASE_URL` is unset locally. Do not invent verification.

### Required before cutover

1. **Character renderer is not characterful.** Ordering, punctuation, join. No Claire
   voice system is attached.
2. **Granted personal disclosure cannot preview in shadow.** Decline uses authored
   registry selection (read-only). A granted reveal generates biography and then
   reserves/consumes an entitlement. Shadow records
   `personal_disclosure_preview_unavailable` rather than emitting an empty
   `PersonalDisclosureSegment`. Mixed business + personal still keeps the business
   answer.
3. **Perception does not own live voice completeness.** `perception/completeness.ts`
   is the V2 destination and is tested, but production voice still gets completeness
   from V1's `listenOnly`.
4. **No live database verification.**
5. **Shadow has never run with the flag on**, so no real comparison telemetry exists.
6. **Mission understanding has no live write.** There is no canonical speech-to-mission action. Cutover must not invent one.

Canonical design: `docs/claire-brain-v2.md`
Detailed handoff: `docs/claire-brain-v2-handoff.md`
Draft PR (do not merge): https://github.com/adamwright83-blip/bldg-admin-api/pull/193
