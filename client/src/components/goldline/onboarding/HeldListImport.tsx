import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { captureProductEvent } from "@/lib/posthog";
import { clearHeldCustomerList, heldListPlaceLine, type HeldCustomerList } from "@/lib/joystickHeldCustomerList";

/**
 * The list an operator shared before checkout, brought into the paid workspace
 * through the normal tenant import (geocoded, deduplicated, provenance kept),
 * then cleared from the browser. docs/goldline/FIRST_TEN_MINUTES.md slice B.
 */
export function HeldListImport({ list, busy, onContinue, onDropped }: {
  list: HeldCustomerList;
  busy: boolean;
  onContinue: () => void;
  onDropped: () => void;
}) {
  const utils = trpc.useUtils();
  const commit = trpc.system.goldlineOnboarding.importCustomers.useMutation();
  const [done, setDone] = useState<{ imported: number; review: number } | null>(null);
  const pending = busy || commit.isPending;
  const place = heldListPlaceLine(list.summary);

  async function bringIn() {
    try {
      const result = await commit.mutateAsync({ payload: list.payload, fileName: list.fileName });
      clearHeldCustomerList();
      setDone({ imported: result.importedCustomers, review: result.errors.length });
      captureProductEvent("onboarding_source_connected", { kind: "csv", funnel_step: "post_checkout", imported: result.importedCustomers });
      await utils.system.goldlineOnboarding.state.invalidate();
    } catch {
      /* commit.error is shown below; the list stays held so the operator can retry */
    }
  }

  return (
    <section className="gl-customer-import" data-testid="held-list-import">
      <h2>{done ? "Your customers are in." : `Bring in the ${list.summary.usable} customers you shared.`}</h2>
      <p>
        {done
          ? `${done.imported} customer records saved.${done.review ? ` ${done.review} addresses need a closer look and stay off the map.` : ""}`
          : `From ${list.fileName}${place ? `, mostly ${place}` : ""}. Addresses are placed on your map; anything we can't place is kept off it and listed.`}
      </p>
      {commit.error ? <p role="alert">{commit.error.message}</p> : null}
      <div className="gl-import-actions">
        {!done ? (
          <button disabled={pending} onClick={() => void bringIn()}>
            {commit.isPending ? "BRINGING THEM IN…" : "BRING IN MY CUSTOMERS"}
          </button>
        ) : null}
        <button disabled={pending} onClick={onContinue}>
          {busy ? "ASSEMBLING…" : done ? "REVEAL MY WORLD" : "SKIP & REVEAL MY WORLD"}
        </button>
        {!done ? (
          <button disabled={pending} onClick={() => { clearHeldCustomerList(); onDropped(); }}>
            USE A DIFFERENT LIST
          </button>
        ) : null}
      </div>
    </section>
  );
}
