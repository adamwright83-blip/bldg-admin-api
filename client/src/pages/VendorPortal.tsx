import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, LogOut } from "lucide-react";
import { centsToDollars } from "@shared/pricing";

const VENDOR_TABS = [
  "Dashboard",
  "Orders",
  "Intake",
  "Ready",
  "Pickups",
  "Customers",
  "Payouts",
  "Settings",
] as const;
type VendorTab = (typeof VENDOR_TABS)[number];

/* ===== Vendor Login Form ===== */
function VendorLoginForm({
  slug,
  onSuccess,
}: {
  slug: string;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const utils = trpc.useUtils();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${apiBase}/api/vendor/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ slug, email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid email or password");
        return;
      }
      await utils.vendor.me.invalidate();
      onSuccess();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-black/40 mb-2">
            {slug || "Vendor Portal"}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">Sign In</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-xs text-red-600 text-center">{error}</p>}
          <Button type="submit" disabled={loading || !email || !password}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ===== Vendor Portal ===== */
export default function VendorPortal({ slug }: { slug: string }) {
  const { data: vendor, isLoading } = trpc.vendor.me.useQuery();
  const logout = trpc.vendor.logout.useMutation();
  const [activeTab, setActiveTab] = useState<VendorTab>("Dashboard");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-black/30" />
      </div>
    );
  }

  if (!vendor) {
    return <VendorLoginForm slug={slug} onSuccess={() => {}} />;
  }

  const brandName = vendor.brandName || "Operations";

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <title>{`${brandName} — Operations`}</title>
      <nav className="border-b border-black/10 bg-white sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <span className="text-sm font-semibold tracking-widest uppercase">{brandName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.reload() })}
            >
              <LogOut className="w-4 h-4 mr-1" /> Sign out
            </Button>
          </div>
          <div className="flex gap-0 -mb-px overflow-x-auto">
            {VENDOR_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-black text-black"
                    : "border-transparent text-black/40 hover:text-black/70"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {activeTab === "Dashboard" && <VendorDashboardTab />}
        {activeTab === "Orders" && <VendorOrdersTab />}
        {activeTab === "Intake" && <VendorIntakeTab />}
        {activeTab === "Ready" && <VendorReadyTab />}
        {activeTab === "Pickups" && <VendorPickupsTab />}
        {activeTab === "Customers" && <VendorCustomersTab />}
        {activeTab === "Payouts" && <VendorPayoutsTab />}
        {activeTab === "Settings" && <VendorSettingsTab vendor={vendor} />}
      </div>
    </div>
  );
}

function VendorDashboardTab() {
  const { data, isLoading } = trpc.vendor.dashboard.useQuery();
  if (isLoading) return <Loader2 className="animate-spin w-6 h-6" />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card label="Today's orders" value={String(data.todayOrderCount)} />
        <Card label="Awaiting intake" value={String(data.awaitingIntakeCount)} />
        <Card label="Ready for delivery" value={String(data.readyForDeliveryCount)} />
        <Card label="This week gross" value={`$${centsToDollars(data.thisWeekGrossCents)}`} />
        <Card label="This week payout" value={`$${centsToDollars(data.thisWeekPayoutCents)}`} className="col-span-2" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-black/60 mb-2">Recent orders</h3>
        {data.recentOrders.length === 0 ? (
          <p className="text-sm text-black/50">No orders yet</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.recentOrders.map((o) => (
              <li key={o.id}>
                #{o.id} — {o.firstName} {o.lastName} — {o.status}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`border border-black/10 rounded-lg p-4 ${className}`}>
      <p className="text-xs text-black/50 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

const STATUS_CHIPS = ["new", "collected", "processing", "ready", "delivered"] as const;

function VendorOrdersTab() {
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_CHIPS[number] | "all">("all");
  const { data: orders, isLoading } = trpc.vendor.listOrders.useQuery(
    { status: statusFilter === "all" ? undefined : statusFilter }
  );
  if (isLoading) return <Loader2 className="animate-spin w-6 h-6" />;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Orders</h2>
      <div className="flex flex-wrap gap-2">
        <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</Chip>
        {STATUS_CHIPS.map((s) => (
          <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s}
          </Chip>
        ))}
      </div>
      {!orders?.length ? (
        <p className="text-sm text-black/50">No orders</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="border border-black/10 rounded p-3 text-sm">
              <span className="font-medium">#{o.id}</span> {o.firstName} {o.lastName} — {o.status} — {o.pickupDate}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium ${
        active ? "bg-black text-white" : "bg-black/5 text-black/70 hover:bg-black/10"
      }`}
    >
      {children}
    </button>
  );
}

function VendorIntakeTab() {
  const { data: orders } = trpc.vendor.listByStatus.useQuery({ status: "collected" });
  const saveIntake = trpc.admin.saveIntake.useMutation();
  const utils = trpc.useUtils();

  const handleSave = async (orderId: number, total: string) => {
    const amountCents = Math.round(parseFloat(total) * 100);
    if (isNaN(amountCents) || amountCents < 50) return;
    await saveIntake.mutateAsync({
      orderId,
      subtotal: total,
      discountPercent: "0",
      total,
    });
    await utils.vendor.listByStatus.invalidate({ status: "collected" });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Intake</h2>
      <p className="text-sm text-black/60">
        Enter weight and pricing. Platform admin will charge the card when ready.
      </p>
      {!orders?.length ? (
        <p className="text-sm text-black/50">No orders awaiting intake</p>
      ) : (
        <ul className="space-y-4">
          {orders.map((o) => (
            <IntakeRow key={o.id} order={o} onSave={handleSave} saving={saveIntake.isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IntakeRow({
  order,
  onSave,
  saving,
}: {
  order: { id: number; firstName: string; lastName: string; status: string; total: string | null };
  onSave: (orderId: number, total: string) => void;
  saving: boolean;
}) {
  const [total, setTotal] = useState(order.total || "0");
  return (
    <li className="border border-black/10 rounded p-4">
      <p className="font-medium">#{order.id} — {order.firstName} {order.lastName}</p>
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="text"
          placeholder="Total"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className="w-24"
        />
        <Button
          size="sm"
          disabled={saving}
          onClick={() => onSave(order.id, total)}
        >
          Save
        </Button>
      </div>
    </li>
  );
}

function VendorReadyTab() {
  const { data: orders } = trpc.vendor.listByStatus.useQuery({ status: "ready" });
  const updateStatus = trpc.admin.updateStatus.useMutation();
  const utils = trpc.useUtils();

  const handleMarkDelivered = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "delivered" });
    await utils.vendor.listByStatus.invalidate({ status: "ready" });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Ready</h2>
      {!orders?.length ? (
        <p className="text-sm text-black/50">No orders ready</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="border border-black/10 rounded p-3 flex items-center justify-between">
              <span>#{o.id} — {o.firstName} {o.lastName}</span>
              <Button size="sm" onClick={() => handleMarkDelivered(o.id)}>
                Mark delivered
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VendorPickupsTab() {
  const today = new Date().toISOString().split("T")[0];
  const { data: pickupOrders } = trpc.vendor.listByDate.useQuery({
    date: today,
    status: "new",
    dateField: "pickupDate",
  });
  const updateStatus = trpc.admin.updateStatus.useMutation();
  const utils = trpc.useUtils();

  const handleMarkCollected = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "collected" });
    await utils.vendor.listByDate.invalidate();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pickups — {today}</h2>
      {!pickupOrders?.length ? (
        <p className="text-sm text-black/50">No pickups today</p>
      ) : (
        <ul className="space-y-2">
          {pickupOrders.map((o) => (
            <li key={o.id} className="border border-black/10 rounded p-3 flex items-center justify-between">
              <span>#{o.id} — {o.firstName} {o.lastName} — {o.pickupTimeWindow}</span>
              <Button size="sm" onClick={() => handleMarkCollected(o.id)}>
                Mark collected
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VendorCustomersTab() {
  const { data: customers } = trpc.vendor.listCustomers.useQuery();
  if (!customers) return <Loader2 className="animate-spin w-6 h-6" />;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Customers</h2>
      <p className="text-sm text-black/60">Contact details are not shown to vendors.</p>
      {!customers.length ? (
        <p className="text-sm text-black/50">No customers yet</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2">Name</th>
              <th className="py-2">Building</th>
              <th className="py-2">Unit</th>
              <th className="py-2">Orders</th>
              <th className="py-2">Last order</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c, i) => (
              <tr key={i} className="border-b border-black/5">
                <td className="py-2">{c.firstName}</td>
                <td className="py-2">{c.buildingSlug ?? "—"}</td>
                <td className="py-2">{c.unit ?? "—"}</td>
                <td className="py-2">{c.totalOrdersWithThisVendor}</td>
                <td className="py-2">{c.lastOrderDate || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VendorPayoutsTab() {
  const { data: payouts } = trpc.vendor.listPayouts.useQuery();
  if (!payouts) return <Loader2 className="animate-spin w-6 h-6" />;

  if (!payouts.length) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Payouts</h2>
        <p className="text-sm text-black/60">
          Payouts will appear here once your first order is processed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Payouts</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-black/60">
            <th className="py-2">Date</th>
            <th className="py-2">Order #</th>
            <th className="py-2">Gross</th>
            <th className="py-2">Platform fee</th>
            <th className="py-2">Payout</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((o) => {
            const gross = o.total ? parseFloat(String(o.total)) : 0;
            const feeCents = o.platformFeeCents ?? 0;
            const payoutCents = o.vendorPayoutCents ?? 0;
            const date = o.updatedAt ? new Date(o.updatedAt).toISOString().split("T")[0] : "—";
            return (
              <tr key={o.id} className="border-b border-black/5">
                <td className="py-2">{date}</td>
                <td className="py-2">#{o.id}</td>
                <td className="py-2">${gross.toFixed(2)}</td>
                <td className="py-2">${(feeCents / 100).toFixed(2)}</td>
                <td className="py-2">${(payoutCents / 100).toFixed(2)}</td>
                <td className="py-2">{o.paid ? "Paid" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VendorSettingsTab({
  vendor,
}: {
  vendor: { brandName: string; logoUrl: string | null; chargesEnabled: boolean; payoutsEnabled: boolean };
}) {
  const { data: link } = trpc.vendor.getConnectDashboardLink.useQuery();

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Settings</h2>
      <div>
        <p className="text-sm text-black/60">Brand</p>
        <p className="font-medium">{vendor.brandName}</p>
      </div>
      {vendor.logoUrl && (
        <div>
          <p className="text-sm text-black/60 mb-2">Logo</p>
          <img src={vendor.logoUrl} alt="Logo" className="h-12 object-contain" />
        </div>
      )}
      <div>
        <p className="text-sm text-black/60">Payout account</p>
        <p className="text-sm">
          {vendor.payoutsEnabled ? (
            <span className="text-green-600">Connected</span>
          ) : (
            <span className="text-amber-600">Not fully set up</span>
          )}
        </p>
        {link?.url && (
          <Button className="mt-2" variant="outline" size="sm" asChild>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              Manage payout details
            </a>
          </Button>
        )}
        {!link?.url && !vendor.payoutsEnabled && (
          <p className="text-xs text-black/50 mt-2">
            Connect your payout account via platform admin.
          </p>
        )}
      </div>
    </div>
  );
}
