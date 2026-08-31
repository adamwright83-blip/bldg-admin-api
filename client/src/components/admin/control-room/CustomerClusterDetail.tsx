import { ArrowRight, X } from "lucide-react";
import type { CustomerLocationCluster } from "./customerGeography";

export function CustomerClusterDetail({ cluster, onClose, onOpenCustomer }: {
  cluster: CustomerLocationCluster;
  onClose: () => void;
  onOpenCustomer: (phone: string) => void;
}) {
  return (
    <aside className="lc-detail lc-cluster-detail" aria-live="polite" aria-label="Customer location cluster">
      <button type="button" onClick={onClose} aria-label="Close customer cluster"><X /></button>
      <span>Physical customer location</span>
      <h2>{cluster.total} {cluster.total === 1 ? "customer" : "customers"}</h2>
      <p>{cluster.canonicalAddress ?? "Provider-confirmed coordinate"}</p>
      <div className="lc-cluster-composition" aria-label="Customer cadence composition">
        <b>{cluster.active} active</b><b>{cluster.dimming} dimming</b><b>{cluster.dark} dormant</b>
      </div>
      <ul className="lc-cluster-customers">
        {cluster.customers.map(customer => (
          <li key={customer.identityKey}>
            <button type="button" disabled={!customer.phone} onClick={() => customer.phone && onOpenCustomer(customer.phone)}>
              <span><strong>{customer.displayName}</strong><small>{customer.cadence.state} · {customer.cadence.daysSinceLastOrder} days since order</small></span>
              <ArrowRight aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
