# Claire Brain V2

Architecture: COMPLETE
Contracts: COMPLETE
Business Memory: LIVE read-only (injected readers) + authoritative entity resolution
Episodic / Self / Goals: LIVE read-only adapters; Self and Goals not yet wired into the
  shadow observer's live context (an unsupplied compartment returns nothing)
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

Tests: 223 passed, 0 todo (brain). `tsc --noEmit` green.

Authority stage: **B — shadow observation** (see `docs/claire-brain-v2.md` §19a).

```
BRAIN V2 MAY OBSERVE A COMPLETED V1 TURN.
BRAIN V2 MAY NEVER AFFECT THAT TURN.
```

**The flag stays OFF.** `CLAIRE_BRAIN_V2_SHADOW=1` enables observation; unset or
malformed disables it, and with it off there is no V2 execution, no added model calls
and no added DB reads.

## Genuine remaining gaps

1. **Self Memory and Goals are not in the observer's live context.** Their adapters are
   real and tested, but `liveExecutiveDeps` supplies only Business and Episodic. A
   shadow turn therefore cannot yet exercise a real disclosure entitlement or a real
   board input. An unsupplied compartment returns nothing rather than reading something
   unintended.
2. **The character renderer is not characterful.** It orders segments, adds punctuation
   and joins. The phrasing seam is governed by `assertRenderedFromPlan`, but no Claire
   voice system is attached to it.
3. **Personal disclosure text is empty.** The executive authorises the disclosure; the
   authored line must come from the canon/dialogue registry, which is not wired. Never
   fill that registry with generated lines.
4. **Perception does not own live voice completeness.** `perception/completeness.ts` is
   the V2 destination and is tested, but production voice still gets completeness from
   V1's `listenOnly`. Acceptable for shadow; a blocker for cutover.
5. **No live database verification.** `DATABASE_URL` is unset locally, so every test
   injects readers. The wiring to the real readers is type-checked and unit-tested, not
   exercised against production data.
6. **Shadow has never run with the flag on**, so no real comparison telemetry exists.

Canonical design: `docs/claire-brain-v2.md`
Detailed handoff: `docs/claire-brain-v2-handoff.md`
Draft PR (do not merge): https://github.com/adamwright83-blip/bldg-admin-api/pull/193
