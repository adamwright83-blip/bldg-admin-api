/**
 * Staff-only Laundry Butler digital receipt (`/receipt/:orderId` on admin).
 *
 * **Public multi-vendor receipts** are owned by the resident app: `ReceiptPaper` +
 * `BldgReceiptViewModel` + branding resolver + mapper registry. This page is the LB
 * reference layout for parity; it is not the shared BLDG renderer.
 */
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { buildReceiptLines } from "@shared/receipt";

const BUSINESS_NAME =
  import.meta.env.VITE_RECEIPT_BUSINESS_NAME ?? "Laundry Butler";
const BUSINESS_LINE1 =
  import.meta.env.VITE_RECEIPT_ADDRESS_LINE1 ?? "Los Angeles, CA";
const BUSINESS_LINE2 =
  import.meta.env.VITE_RECEIPT_ADDRESS_LINE2 ?? "United States";
const BUSINESS_PHONE =
  import.meta.env.VITE_RECEIPT_PHONE ?? "(323) 807-4661";

function formatReceiptDate(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function DigitalReceiptPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = Number(params.orderId);
  const { data: order, isLoading, error } = trpc.admin.getOrder.useQuery(
    { id: orderId },
    { enabled: Number.isFinite(orderId) && orderId > 0 }
  );

  if (!Number.isFinite(orderId) || orderId <= 0) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
        <p className="text-black/60">Invalid order.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/30" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-neutral-100 flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-black/60 text-center">
          Could not load this receipt. Sign in to admin if needed.
        </p>
        <Link href="/" className="text-sm text-blue-600 underline">
          Back to admin
        </Link>
      </div>
    );
  }

  const subtotal = parseFloat(order.subtotal || "0");
  const total = parseFloat(order.total || "0");
  const discount = Math.max(0, subtotal - total);
  const lines = buildReceiptLines(order);
  const hasIntake =
    lines.length > 0 ||
    subtotal > 0 ||
    parseFloat(order.discountPercent || "0") > 0;

  if (!hasIntake) {
    return (
      <div className="min-h-screen bg-neutral-100 flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-black/60 text-center max-w-sm">
          This order has no intake yet. Complete intake and charge in Admin →
          Intake, then open this receipt again.
        </p>
        <Link href="/" className="text-sm text-blue-600 underline">
          Back to admin
        </Link>
      </div>
    );
  }

  /** Customer’s original order placement time (`orders.createdAt`), not charge time. */
  const orderPlaced = order.createdAt ? new Date(order.createdAt) : new Date();
  const paidAt = order.paid && order.updatedAt ? new Date(order.updatedAt) : null;
  const dueStr =
    order.deliveryDate
      ? (() => {
          const dt = new Date(order.deliveryDate + "T12:00:00");
          const d = dt.toLocaleDateString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "2-digit",
          });
          return order.deliveryTimeWindow
            ? `${d} ${order.deliveryTimeWindow}`
            : d;
        })()
      : "—";

  const customerName = `${order.firstName} ${order.lastName}`.trim();
  const serviceLabel =
    order.serviceType === "wash_fold" ? "Wash & Fold" : "Dry Cleaning";

  return (
    <div className="min-h-screen bg-neutral-100 py-8 px-4 print:bg-white print:py-4">
      <div className="max-w-md mx-auto bg-white border border-neutral-200 shadow-sm print:shadow-none print:border-neutral-300">
        {/* Brand */}
        <div className="text-center pt-8 pb-6 px-6 border-b border-neutral-100">
          <h1 className="text-2xl font-semibold tracking-tight text-black">
            LAUNDRY BUTLER
          </h1>
          <p className="text-xs text-black/45 mt-1">{serviceLabel}</p>
        </div>

        <div className="px-6 py-5">
          <p className="text-center text-2xl font-bold text-black">
            #{order.id}
          </p>
          <p className="text-center text-lg font-medium text-black mt-1">
            {customerName}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 px-6 pb-6 text-sm border-b border-neutral-200">
          <div className="text-black/80 leading-relaxed">
            <p className="font-medium text-black">{BUSINESS_NAME}</p>
            <p>{BUSINESS_LINE1}</p>
            <p>{BUSINESS_LINE2}</p>
            <p className="mt-1">Tel: {BUSINESS_PHONE}</p>
          </div>
          <div className="text-right text-black/80 leading-relaxed text-sm">
            <p>
              <span className="text-black/50">Total: </span>
              <span className="font-semibold text-black">
                ${total.toFixed(2)}
              </span>
            </p>
            <p className="mt-1">
              <span className="text-black/50">Order placed: </span>
              {formatReceiptDate(orderPlaced)}
            </p>
            <p className="mt-1">
              <span className="text-black/50">Due: </span>
              {dueStr}
            </p>
            <p className="mt-1">
              <span className="text-black/50">Payment: </span>
              {paidAt
                ? `${formatReceiptDate(paidAt)}, Card`
                : "Pending"}
            </p>
          </div>
        </div>

        <div className="px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-black/50 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-2 font-medium">Item</th>
                <th className="pb-2 pr-2 font-medium w-14">Qty</th>
                <th className="pb-2 pr-2 font-medium w-16 text-right">
                  Unit
                </th>
                <th className="pb-2 font-medium w-20 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-2 pr-2 text-black align-top">{row.item}</td>
                  <td className="py-2 pr-2 text-black align-top">
                    {row.quantity}
                  </td>
                  <td className="py-2 pr-2 text-black text-right align-top">
                    {row.unitPrice}
                  </td>
                  <td className="py-2 text-black text-right align-top">
                    {row.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 pb-6 text-sm">
          <div className="flex justify-end">
            <div className="w-48 space-y-1 text-right">
              <div className="flex justify-between gap-8">
                <span className="text-black/50">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-black/50">Discount</span>
                <span>${discount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-8 font-semibold pt-1 border-t border-neutral-200">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-8 text-black/70">
                <span>Payment</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-200 text-center text-sm text-black/55 print:bg-neutral-100">
          Thanks for your business. Have an amazing day!
        </div>
      </div>

      <p className="text-center text-xs text-black/40 mt-6 print:hidden">
        Screenshot this page to share. Order #{order.id} is your system-wide
        order number (not per-customer).
      </p>
      <div className="text-center mt-4 print:hidden">
        <Link href="/" className="text-sm text-blue-600 underline">
          Back to admin
        </Link>
      </div>
    </div>
  );
}
