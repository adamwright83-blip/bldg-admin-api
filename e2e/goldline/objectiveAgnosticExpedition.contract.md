# Acceptance

Superseded by §PR78 Workstream B1 (climax honesty). PR #71's original
contract staged the PR #70 combat heartbeat for a plain Open Channel desk
task; Adam's first playtest found that expedition did nothing perceptible
for a task with no real physical arrival, which was dishonest. The current
contract, executed by `scripts/verifyGoldlineOpenChannelExpedition.mjs`:

1. With no native pickup and an active approved Open Channel mission
   containing a pending non-target-run task, Goldline never exposes
   `ENTER THE LINE` for it — the base offers `SEAL THE WORK` directly, and
   the expedition shell (canvas action pad) never mounts for this objective.
2. Tapping `SEAL THE WORK` calls the same canonical Open Channel completion
   write PR #71 introduced (`completeOpenChannelTask`), unchanged.
3. Only that canonical write may resolve the task — there is no combat
   arrival, latch, or cargo step in between.
4. The base task surface clears only once refreshed authoritative Open
   Channel state reports the pinned task completed.
5. No Open Channel task completion produces pickup Stronghold restoration
   (no lanterns, no collected-order evidence, no expedition order binding).
6. `driver.bldg.chat/*` canonicalizes to `driver.bldg.chat/`.

The expedition shell remains reserved for objectives with a real physical
arrival: `native_pickup`, `external_order`, `local_target_run`. A Local
Target Run's Open Channel task carries a `LOCAL_TARGET_RUN` payload and is
prepared as its own `local_target_run` objective kind — it is unaffected by
this contract and still stages the expedition.
