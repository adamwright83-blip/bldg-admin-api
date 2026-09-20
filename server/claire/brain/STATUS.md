# Claire Brain V2

Architecture: COMPLETE
Contracts: COMPLETE
Business Memory: LIVE read-only (injected readers) + authoritative entity resolution
Episodic / Self / Goals: LIVE read-only adapters, ALL FOUR wired into the observer
Perception: entity mentions (no shape heuristic), personal + narrative probes,
  correction target, complete-thought assembler — assembler NOT yet owning live voice
Working Memory: COMPLETE (ordered query — resolved ≠ presented)
Shadow Working Memory: COMPLETE (V2-owned, per conversation, separate from V1)
Executive Attention / Retrieval / Integration / Inhibition: COMPLETE
Business Judgment: COMPLETE (evidence-bounded recommendation; model seam is governed)
Executive Governor: COMPLETE (mixed-lane firewall ENFORCED)
Response Plan: COMPLETE (segments carry real content: facts, judgments, proposals)
Character Renderer: IN PROGRESS — authority boundary and governed phrasing seam are
  done; Claire's personality/voice system is NOT yet driving phrasing
Action Gateway: COMPLETE (refuses live mutations)
Shadow Mode: WIRED on both surfaces, one-way, DEFAULT OFF, with live read-only retrieval
Production Cutover: PROHIBITED

Tests: 230 passed, 0 todo (brain). `tsc --noEmit` green.

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
and no added DB reads.

## Genuine remaining gaps

1. **The character renderer is not characterful.** It orders segments, adds punctuation
   and joins. The phrasing seam is governed by `assertRenderedFromPlan`, but no Claire
   voice system is attached to it.
2. **A granted personal disclosure still has empty text.** The DECLINE path is now a
   real authored line chosen from the approved registry for the operator's rapport band
   — the executive selects, it never writes Claire dialogue. The DISCLOSURE path is
   deliberately still empty: producing the authored reveal goes through the personal
   reveal path, which generates and CONSUMES an entitlement. Both are writes, so an
   observer must not do it. Wiring that is cutover work, not shadow work. Never fill the
   authored-dialogue registry with generated lines.
3. **Perception does not own live voice completeness.** `perception/completeness.ts` is
   the V2 destination and is tested, but production voice still gets completeness from
   V1's `listenOnly`. Acceptable for shadow; a blocker for cutover.
4. **No live database verification.** `DATABASE_URL` is unset locally, so every test
   injects readers. The wiring to the real readers is type-checked and unit-tested, not
   exercised against production data.
5. **Shadow has never run with the flag on**, so no real comparison telemetry exists.

Canonical design: `docs/claire-brain-v2.md`
Detailed handoff: `docs/claire-brain-v2-handoff.md`
Draft PR (do not merge): https://github.com/adamwright83-blip/bldg-admin-api/pull/193
