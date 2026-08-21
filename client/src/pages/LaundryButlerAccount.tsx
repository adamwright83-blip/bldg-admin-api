import { useEffect, useState } from "react";
import { CalendarCheck2, CheckCircle2, PackageCheck } from "lucide-react";

type AccountOrder = {
  id: number;
  orderId: number | null;
  serviceType: string;
  status: string;
  scheduledDate: string | null;
  scheduledWindow: string | null;
  createdAt: string;
};

type AccountData = {
  authenticated: boolean;
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phoneE164: string;
    unit: string | null;
  };
  orders?: AccountOrder[];
};

const serviceLabel = (value: string) =>
  value === "dry_cleaning" ? "Dry Cleaning" : "Wash & Fold";

export default function LaundryButlerAccount() {
  const [data, setData] = useState<AccountData | null>(null);
  const [failed, setFailed] = useState(false);
  const confirmedOrderId = new URLSearchParams(window.location.search).get(
    "confirmed"
  );

  useEffect(() => {
    fetch("/resident-api/laundry-butler/account", { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error(`Account request failed (${response.status})`);
        return (await response.json()) as AccountData;
      })
      .then(setData)
      .catch(error => {
        console.error("Laundry Butler account failed to load:", error);
        setFailed(true);
      });
  }, []);

  if (!data && !failed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff7f5] text-[#7f5e6d]">
        Loading your Laundry Butler account…
      </main>
    );
  }

  if (failed || !data?.authenticated || !data.user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff7f5] px-6 text-[#2f1b24]">
        <section className="w-full max-w-md rounded-3xl border border-[#eddce4] bg-white p-7 text-center shadow-xl">
          <h1 className="text-2xl font-semibold">Laundry Butler</h1>
          <p className="mt-3 text-sm text-[#7f5e6d]">
            Book your first pickup to create and open your account automatically.
          </p>
          <a className="mt-6 inline-flex rounded-full bg-[#d42f76] px-6 py-3 font-semibold text-white" href="/?book=1">
            Schedule a pickup
          </a>
        </section>
      </main>
    );
  }

  const name = [data.user.firstName, data.user.lastName].filter(Boolean).join(" ");
  const orders = data.orders ?? [];

  return (
    <main className="min-h-screen bg-[#fff7f5] px-4 py-8 text-[#2f1b24] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1f3a33] font-semibold text-[#f9e6cf]">LB</span>
            <span><strong className="block tracking-[0.1em]">LAUNDRY BUTLER</strong><small className="text-[#7f5e6d]">My account</small></span>
          </a>
          <a href="/?book=1" className="rounded-full bg-[#d42f76] px-4 py-2.5 text-sm font-semibold text-white">Book again</a>
        </header>

        {confirmedOrderId ? (
          <section className="mt-8 rounded-3xl border border-[#cfe6dc] bg-[#f3fbf7] p-6 shadow-sm">
            <CheckCircle2 className="h-9 w-9 text-[#2f7d5d]" />
            <h1 className="mt-4 text-3xl font-semibold">Order confirmed</h1>
            <p className="mt-2 text-[#597065]">
              Your Laundry Butler pickup is booked. Order #{confirmedOrderId} is now saved to this account.
            </p>
          </section>
        ) : null}

        <section className="mt-6 rounded-3xl border border-[#eddce4] bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a77085]">Your account</p>
          <h2 className="mt-2 text-2xl font-semibold">{name || "Laundry Butler customer"}</h2>
          <div className="mt-4 grid gap-2 text-sm text-[#7f5e6d] sm:grid-cols-2">
            <span>{data.user.phoneE164}</span>
            <span>{data.user.email || "Email not provided"}</span>
            {data.user.unit ? <span>Unit {data.user.unit}</span> : null}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-end justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a77085]">Bookings</p><h2 className="mt-1 text-2xl font-semibold">Your orders</h2></div>
            <CalendarCheck2 className="text-[#d42f76]" />
          </div>
          <div className="mt-4 space-y-3">
            {orders.length ? orders.map(order => (
              <article key={order.id} className="flex items-center gap-4 rounded-2xl border border-[#eddce4] bg-white p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ffe5f1] text-[#b21a5c]"><PackageCheck /></span>
                <div className="min-w-0 flex-1">
                  <strong className="block">{serviceLabel(order.serviceType)}{order.orderId ? ` · #${order.orderId}` : ""}</strong>
                  <span className="text-sm text-[#7f5e6d]">{order.scheduledDate || new Date(order.createdAt).toLocaleDateString()}{order.scheduledWindow ? ` · ${order.scheduledWindow}` : ""}</span>
                </div>
                <span className="rounded-full bg-[#f3fbf7] px-3 py-1 text-xs font-semibold capitalize text-[#2f7d5d]">{order.status}</span>
              </article>
            )) : <div className="rounded-2xl border border-dashed border-[#dcbfcd] p-6 text-center text-[#7f5e6d]">Your bookings will appear here.</div>}
          </div>
        </section>

        <a href="/?book=1" className="mt-8 flex w-full items-center justify-center rounded-full bg-[#d42f76] px-6 py-4 text-lg font-semibold text-white shadow-lg">Schedule another pickup</a>
        <p className="mt-4 text-center text-xs text-[#9b7c89]">Save this page to your phone for faster repeat bookings.</p>
      </div>
    </main>
  );
}
