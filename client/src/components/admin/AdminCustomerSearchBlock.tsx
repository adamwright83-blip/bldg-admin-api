import { Loader2 } from "lucide-react";
import {
  headerCustomerSearchSections,
  type HeaderDirectoryCustomer,
  type HeaderOrderHit,
} from "@/lib/headerCustomerSearch";

/**
 * Header "Customer" box. Customers come from the active business's directory, which
 * includes CleanCloud-only customers; order rows below stay as receipt links.
 */
export function AdminCustomerSearchBlock({
  customerSearchQuery,
  setCustomerSearchQuery,
  debouncedCustomerQuery,
  searchOrders,
  directoryCustomers,
  setProfilePhone,
  onPrefillNewOrder,
}: {
  customerSearchQuery: string;
  setCustomerSearchQuery: (q: string) => void;
  debouncedCustomerQuery: string;
  setProfilePhone: (p: string) => void;
  onPrefillNewOrder: (phone: string) => void;
  searchOrders: {
    isLoading: boolean;
    data?: HeaderOrderHit[];
  };
  directoryCustomers?: {
    isLoading: boolean;
    data?: { customers: HeaderDirectoryCustomer[] };
  };
}) {
  const { customers, orders } = headerCustomerSearchSections({
    directoryCustomers: directoryCustomers?.data?.customers,
    orderHits: searchOrders.data,
  });
  const loading =
    customers.length === 0 &&
    orders.length === 0 &&
    (searchOrders.isLoading || Boolean(directoryCustomers?.isLoading));

  return (
    <div className="border-b border-black/10 bg-white">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3">
        <div className="relative max-w-md">
          <input
            type="text"
            placeholder="Customer"
            value={customerSearchQuery}
            onChange={e => setCustomerSearchQuery(e.target.value)}
            className="w-full rounded-md border border-black/15 bg-neutral-100/80 px-3 py-2.5 text-sm text-black placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black/30"
          />
          {debouncedCustomerQuery.length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-auto rounded-md border border-black/15 bg-white shadow-lg">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-black/30" />
                </div>
              ) : customers.length || orders.length ? (
                <ul className="py-1">
                  {customers.map(c => (
                    <li
                      key={`customer-${c.phone}-${c.firstName}-${c.lastName}`}
                      className="flex items-stretch gap-1 px-2 py-1.5 border-b border-black/5 last:border-0"
                    >
                      <button
                        type="button"
                        title="New order for this customer"
                        className="flex-1 min-w-0 flex flex-col justify-center px-1 text-left rounded-md hover:bg-black/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-black/25"
                        onClick={() => {
                          onPrefillNewOrder(c.phone);
                          setCustomerSearchQuery("");
                        }}
                      >
                        <span className="font-medium text-black text-sm truncate">
                          {`${c.firstName || ""} ${c.lastName || ""}`.trim() || "Customer"}
                        </span>
                        <span className="text-black/50 text-xs truncate">
                          {c.phone || "No phone"}
                          {c.unit ? ` · Unit ${c.unit}` : ""}
                          {typeof c.totalOrders === "number" ? ` · ${c.totalOrders} orders` : ""}
                        </span>
                      </button>
                      {c.phone ? (
                        <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                          <button
                            type="button"
                            className="text-xs font-medium px-2 py-1.5 rounded border border-black/15 bg-white hover:bg-black/5 text-black"
                            onClick={() => setProfilePhone(c.phone)}
                          >
                            Profile
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {orders.map(o => (
                    <li
                      key={o.id}
                      className="flex items-stretch gap-1 px-2 py-1.5 border-b border-black/5 last:border-0"
                    >
                      <button
                        type="button"
                        title="New order for this customer"
                        className="flex-1 min-w-0 flex flex-col justify-center px-1 text-left rounded-md hover:bg-black/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-black/25"
                        onClick={() => {
                          onPrefillNewOrder(o.phone);
                          setCustomerSearchQuery("");
                        }}
                      >
                        <span className="font-medium text-black text-sm truncate">
                          #{o.id} — {o.firstName} {o.lastName}
                        </span>
                        <span className="text-black/50 text-xs">
                          {o.total ? `$${o.total}` : "—"} ·{" "}
                          {o.serviceType === "wash_fold" ? "W&F" : "DC"}
                        </span>
                      </button>
                      <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                        <button
                          type="button"
                          className="text-xs font-medium px-2 py-1.5 rounded border border-black/15 bg-white hover:bg-black/5 text-black"
                          onClick={() => setProfilePhone(o.phone)}
                        >
                          Profile
                        </button>
                        <a
                          href={`/receipt/${o.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium px-2 py-1.5 rounded border border-black/15 bg-white hover:bg-black/5 text-black text-center"
                        >
                          Receipt
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-4 text-sm text-black/50">
                  No customers or orders found.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
