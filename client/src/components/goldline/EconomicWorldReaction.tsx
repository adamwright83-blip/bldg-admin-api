import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import type { CityWorldEntity } from "../../../../server/goldlineWorld/cityWorldService";
import { currentEconomicRevenueCents } from "@shared/goldlineEconomicProjection";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";

/** Published economic revisions only. Opening this receipt writes no evidence. */
export function EconomicWorldReaction({ entities }: { entities: readonly CityWorldEntity[] }) {
  const receipts = trpc.system.goldlineWorld.economicReceipts.useQuery(undefined, { staleTime: 5000, refetchInterval: 5000 });
  const latest = receipts.data?.[0];
  const revisionKey = receipts.data?.map(receipt => receipt.id).join(":") ?? "";
  const [unseen, setUnseen] = useState(false);
  const [receiptHost, setReceiptHost] = useState<Element | null>(null);
  useEffect(() => { setReceiptHost(document.querySelector(".gl-persistent-world")); }, []);
  useEffect(() => {
    if (!latest) return;
    const key = `goldline-economic-receipt:${latest.tenantId}`;
    try { setUnseen(localStorage.getItem(key) !== revisionKey); localStorage.setItem(key, revisionKey); }
    catch { setUnseen(true); }
    const timer = window.setTimeout(() => setUnseen(false), 8000);
    return () => window.clearTimeout(timer);
  }, [revisionKey, latest?.tenantId]);
  if (!latest) return null;
  const entity = entities.find(entity => entity.id === latest.physicalEntityId);
  const location = entity?.location;
  const position = location && typeof location.latitude === "number" && typeof location.longitude === "number"
    ? projectLatLngToLanternAtlas({ latitude: location.latitude, longitude: location.longitude }) : null;
  return <>
    {position && unseen ? <span className="gl-economic-wave" style={{ left: `${position.x}%`, top: `${position.y}%` }} aria-hidden /> : null}
    {receiptHost ? createPortal(<details className={`gl-economic-receipt${unseen ? " is-new" : ""}`} data-testid="economic-world-receipt" data-event-id={latest.id} data-revision={String(latest.metadata.revision)}>
      <summary>{latest.eventType === "order_payment_corrected" ? "Economic correction reflected" : "Paid order reached the city"}</summary>
      <p>{entity?.displayName ?? "Unresolved place — not assigned to a building"} · ${(currentEconomicRevenueCents([latest]) / 100).toFixed(2)} current value of this source order.</p>
      <small>{latest.sourceEvidenceReference} · revision {String(latest.metadata.revision)}. Revisions replace prior value; this is not a new game reward.</small>
      {(receipts.data?.length ?? 0) > 1 ? <details><summary>{receipts.data!.length} recent source-order updates</summary><ul>{receipts.data!.slice(1).map(receipt => <li key={receipt.id}>{entities.find(item => item.id === receipt.physicalEntityId)?.displayName ?? "Unresolved place"} · ${(currentEconomicRevenueCents([receipt]) / 100).toFixed(2)} · {receipt.sourceEvidenceReference} · revision {String(receipt.metadata.revision)}</li>)}</ul></details> : null}
    </details>, receiptHost) : null}
  </>;
}
