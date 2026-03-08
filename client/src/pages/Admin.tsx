import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Check, Copy, AlertCircle, ChevronLeft, ChevronRight, MapPin, Phone, MessageSquare, Package } from "lucide-react";
import {
  WF_UPCHARGES,
  WF_FLAT_RATE_TEXTILES,
  DC_ITEMS,
  WF_RATE_PER_LB_CENTS,
  WF_MINIMUM_SUBTOTAL_CENTS,
  calcWashFoldTotal,
  calcDryCleanTotal,
  centsToDollars,
  type UpchargeEntry,
  type DryCleanEntry,
} from "@shared/pricing";
import type { Order } from "@shared/types";

const TABS = ["New Order", "Intake", "Processing", "Ready", "Pickups", "Vendors"] as const;
type Tab = (typeof TABS)[number];

const SUPPORTED_BUILDINGS: { label: string; value: string }[] = [
  { label: "OPUS LA", value: "opusla" },
  { label: "Century Park East", value: "centuryparkeast" },
];

function connectStatusBadge(vendor: { stripeConnectAccountId: string | null; payoutsEnabled: boolean | null; detailsSubmitted: boolean | null; disabledReason: string | null }) {
  if (!vendor.stripeConnectAccountId) return { label: "Not connected", color: "bg-black/10 text-black/50" };
  if (vendor.disabledReason) return { label: "Restricted", color: "bg-red-100 text-red-700" };
  if (vendor.payoutsEnabled) return { label: "Active", color: "bg-green-100 text-green-700" };
  if (vendor.detailsSubmitted) return { label: "Onboarding incomplete", color: "bg-amber-100 text-amber-700" };
  return { label: "Onboarding incomplete", color: "bg-amber-100 text-amber-700" };
}

const TIME_WINDOWS = [
  "7:00am–9:00am",
  "9:00am–11:00am",
  "11:00am–1:00pm",
  "7:00pm–9:00pm",
];

const STATUS_FOR_TAB: Record<Tab, Order["status"] | null> = {
  "New Order": null,
  Intake: "collected",
  Processing: "processing",
  Ready: "ready",
  Pickups: null,
  Vendors: null,
};

/* ===== Utility ===== */
function formatDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getWeekDates(offset: number) {
  const today = new Date();
  today.setDate(today.getDate() + offset * 7);
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const dates: { label: string; value: string; isToday: boolean }[] = [];
  // Use local date formatting to avoid timezone shifts
  const todayLocal = new Date();
  const todayStr = todayLocal.getFullYear() + "-" + String(todayLocal.getMonth() + 1).padStart(2, "0") + "-" + String(todayLocal.getDate()).padStart(2, "0");
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    // Use local date formatting instead of toISOString() to avoid timezone shifts
    const val = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    dates.push({
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      value: val,
      isToday: val === todayStr,
    });
  }
  return dates;
}

/* ===== ADMIN PAGE ===== */
export default function Admin() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("New Order");

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  }

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      {/* Top nav */}
      <nav className="border-b border-black/10 bg-white sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <span className="text-sm font-semibold tracking-widest uppercase">Laundry Butler</span>
            <span className="text-xs text-black/40">{user?.name || "Admin"}</span>
          </div>
          <div className="flex gap-0 -mb-px overflow-x-auto">
            {TABS.map((tab) => (
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

      {/* Tab content */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {activeTab === "New Order" && <NewOrderTab />}
        {activeTab === "Intake" && <IntakeTab />}
        {activeTab === "Processing" && <ProcessingTab />}
        {activeTab === "Ready" && <ReadyTab />}
        {activeTab === "Pickups" && <PickupsTab />}
        {activeTab === "Vendors" && <VendorsTab />}
      </div>
    </div>
  );
}

/* ===== NEW ORDER TAB ===== */
function NewOrderTab() {
  const [phone, setPhone] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    address: "",
    unit: "",
    specialInstructions: "",
    serviceType: "wash_fold" as "wash_fold" | "dry_cleaning",
    pickupDate: new Date().toISOString().split("T")[0],
    pickupTimeWindow: TIME_WINDOWS[0],
    deliveryDate: "",
    deliveryTimeWindow: "",
    buildingSlug: SUPPORTED_BUILDINGS[0].value,
    vendorId: undefined as number | undefined,
  });
  const [prefilled, setPrefilled] = useState(false);
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null);
  const [stripePaymentMethodId, setStripePaymentMethodId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const vendorsQuery = trpc.admin.listVendors.useQuery();

  const searchQuery = trpc.admin.searchCustomer.useQuery(
    { phone },
    { enabled: phone.length >= 7 && !prefilled }
  );

  const createOrder = trpc.admin.createOrder.useMutation();
  const queueQuery = trpc.admin.listByStatus.useQuery({ status: "new" });
  const dispatchMutation = trpc.admin.updateStatus.useMutation();

  // Refs for autofill detection — browser autofill bypasses React onChange
  const phoneRef = useRef<HTMLInputElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const unitRef = useRef<HTMLInputElement>(null);

  // Poll for autofill changes every 500ms (catches Chrome/Safari autofill that skips onChange)
  useEffect(() => {
    const interval = setInterval(() => {
      const refs = [
        { ref: phoneRef, key: null as null, isPhone: true },
        { ref: firstNameRef, key: "firstName" as keyof typeof form },
        { ref: lastNameRef, key: "lastName" as keyof typeof form },
        { ref: emailRef, key: "email" as keyof typeof form },
        { ref: addressRef, key: "address" as keyof typeof form },
        { ref: unitRef, key: "unit" as keyof typeof form },
      ];
      for (const { ref, key, isPhone } of refs) {
        const el = ref.current;
        if (!el) continue;
        const domVal = el.value;
        if (isPhone) {
          if (domVal && domVal !== phone) setPhone(domVal);
        } else if (key) {
          if (domVal && domVal !== form[key]) {
            setForm((f) => ({ ...f, [key]: domVal }));
          }
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [phone, form]);

  const handlePrefill = useCallback(() => {
    if (searchQuery.data) {
      setForm((f) => ({
        ...f,
        firstName: searchQuery.data!.firstName,
        lastName: searchQuery.data!.lastName,
        email: searchQuery.data!.email || "",
        address: searchQuery.data!.address || "",
        unit: searchQuery.data!.unit || "",
        specialInstructions: searchQuery.data!.specialInstructions || "",
      }));
      setStripeCustomerId(searchQuery.data.stripeCustomerId || null);
      setStripePaymentMethodId(searchQuery.data.stripePaymentMethodId || null);
      setPrefilled(true);
    }
  }, [searchQuery.data]);

  const handleSubmit = async () => {
    // Read from DOM refs as fallback for browser autofill that bypasses onChange
    const actualPhone = phoneRef.current?.value || phone;
    const actualFirstName = firstNameRef.current?.value || form.firstName;
    const actualLastName = lastNameRef.current?.value || form.lastName;
    const actualEmail = emailRef.current?.value || form.email;
    const actualAddress = addressRef.current?.value || form.address;
    const actualUnit = unitRef.current?.value || form.unit;

    if (!actualFirstName || !actualAddress || !actualPhone) return;

    const pickupDateObj = new Date(form.pickupDate + "T00:00:00");
    pickupDateObj.setDate(pickupDateObj.getDate() + 1);
    const defaultDelivery = pickupDateObj.toISOString().split("T")[0];

    await createOrder.mutateAsync({
      serviceType: form.serviceType,
      pickupDate: form.pickupDate,
      pickupTimeWindow: form.pickupTimeWindow,
      deliveryDate: form.deliveryDate || defaultDelivery,
      deliveryTimeWindow: form.deliveryTimeWindow || form.pickupTimeWindow,
      address: actualAddress,
      unit: actualUnit || undefined,
      specialInstructions: form.specialInstructions || undefined,
      firstName: actualFirstName,
      lastName: actualLastName,
      phone: actualPhone,
      email: actualEmail || undefined,
      stripeCustomerId: stripeCustomerId || undefined,
      stripePaymentMethodId: stripePaymentMethodId || undefined,
      buildingSlug: form.buildingSlug,
      vendorId: form.vendorId,
    });
    setSubmitted(true);
    queueQuery.refetch();
  };

  const handleDispatch = async (orderId: number) => {
    await dispatchMutation.mutateAsync({ orderId, status: "collected" });
    queueQuery.refetch();
  };

  if (submitted) {
    return (
      <div className="text-center py-20">
        <Check className="w-12 h-12 mx-auto mb-4 text-black" />
        <p className="text-lg font-medium">Order created.</p>
        <Button
          variant="outline"
          className="mt-4 border-black text-black"
          onClick={() => {
            setSubmitted(false);
            setPhone("");
            setPrefilled(false);
            setForm({
              firstName: "", lastName: "", email: "", address: "", unit: "",
              specialInstructions: "", serviceType: "wash_fold",
              pickupDate: new Date().toISOString().split("T")[0],
              pickupTimeWindow: TIME_WINDOWS[0], deliveryDate: "", deliveryTimeWindow: "",
              buildingSlug: SUPPORTED_BUILDINGS[0].value, vendorId: undefined,
            });
          }}
        >
          Create Another
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold mb-6">New Order</h2>

      {/* Phone search */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Phone</label>
        <div className="flex gap-2">
          <Input
            ref={phoneRef}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setPrefilled(false); }}
            placeholder="(323) 555-1234"
            className="bg-white border-black/20"
          />
          {searchQuery.data && !prefilled && (
            <Button variant="outline" className="border-black text-black shrink-0" onClick={handlePrefill}>
              <Search className="w-4 h-4 mr-1" /> Prefill
            </Button>
          )}
        </div>
        {searchQuery.data && !prefilled && (
          <p className="text-xs text-black/50 mt-1">
            Found: {searchQuery.data.firstName} {searchQuery.data.lastName}
            {searchQuery.data.stripeCustomerId ? " (card on file)" : ""}
          </p>
        )}
      </div>

      {/* Customer fields */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">First Name</label>
          <Input ref={firstNameRef} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="bg-white border-black/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Last Name</label>
          <Input ref={lastNameRef} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="bg-white border-black/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Email (optional)</label>
          <Input ref={emailRef} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white border-black/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Unit</label>
          <Input ref={unitRef} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="bg-white border-black/20" />
        </div>
      </div>
      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Address</label>
        <Input ref={addressRef} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-white border-black/20" />
      </div>
      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Special Instructions</label>
        <Input value={form.specialInstructions} onChange={(e) => setForm({ ...form, specialInstructions: e.target.value })} className="bg-white border-black/20" />
      </div>

      {/* Building + Vendor */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Building</label>
          <select
            value={form.buildingSlug}
            onChange={(e) => setForm({ ...form, buildingSlug: e.target.value })}
            className="w-full h-9 px-3 text-sm border border-black/20 bg-white"
          >
            {SUPPORTED_BUILDINGS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Vendor (optional)</label>
          <select
            value={form.vendorId ?? ""}
            onChange={(e) => setForm({ ...form, vendorId: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full h-9 px-3 text-sm border border-black/20 bg-white"
          >
            <option value="">Auto-assign</option>
            {vendorsQuery.data?.filter(v => v.isActive).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Service type */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-2">Service</label>
        <div className="flex gap-2">
          {(["wash_fold", "dry_cleaning"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setForm({ ...form, serviceType: s })}
              className={`px-4 py-2 text-sm border transition-colors ${
                form.serviceType === s ? "bg-black text-white border-black" : "bg-white text-black border-black/20 hover:border-black/40"
              }`}
            >
              {s === "wash_fold" ? "Wash & Fold" : "Dry Cleaning"}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Pickup Date</label>
          <Input type="date" value={form.pickupDate} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} className="bg-white border-black/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Pickup Window</label>
          <select
            value={form.pickupTimeWindow}
            onChange={(e) => setForm({ ...form, pickupTimeWindow: e.target.value })}
            className="w-full h-9 px-3 text-sm border border-black/20 bg-white"
          >
            {TIME_WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Delivery Date (optional)</label>
          <Input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} className="bg-white border-black/20" />
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Delivery Window (optional)</label>
          <select
            value={form.deliveryTimeWindow}
            onChange={(e) => setForm({ ...form, deliveryTimeWindow: e.target.value })}
            className="w-full h-9 px-3 text-sm border border-black/20 bg-white"
          >
            <option value="">Same as pickup</option>
            {TIME_WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>

      <Button
        className="bg-black text-white hover:bg-black/90 w-full"
        onClick={handleSubmit}
        disabled={createOrder.isPending}
      >
        {createOrder.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
        Create Order
      </Button>

      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Dispatch Queue</h3>
          <span className="text-xs text-black/40">
            {queueQuery.data?.length || 0} pending
          </span>
        </div>
        {!queueQuery.data?.length ? (
          <p className="text-sm text-black/40 border border-black/10 p-3">
            No unassigned requests in queue.
          </p>
        ) : (
          <div className="space-y-2">
            {queueQuery.data.map((order) => (
              <div
                key={order.id}
                className="border border-black/10 p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {order.firstName} {order.lastName}
                  </p>
                  <p className="text-xs text-black/50 truncate">
                    Unit {order.unit || "—"} · {order.pickupDate} · {order.pickupTimeWindow}
                  </p>
                  <p className="text-xs text-black/40 truncate">{order.address}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-black text-black text-xs shrink-0"
                  onClick={() => handleDispatch(order.id)}
                  disabled={dispatchMutation.isPending}
                >
                  {dispatchMutation.isPending ? (
                    <Loader2 className="animate-spin w-3.5 h-3.5 mr-1" />
                  ) : null}
                  Dispatch
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== INTAKE TAB ===== */
function IntakeTab() {
  const { data: orders, isLoading, refetch } = trpc.admin.listByStatus.useQuery({ status: "collected" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const deleteOrder = trpc.admin.deleteOrder.useMutation();

  const handleDelete = async (orderId: number) => {
    await deleteOrder.mutateAsync({ orderId });
    setDeleteConfirm(null);
    refetch();
  };

  if (isLoading) return <Loader2 className="animate-spin w-6 h-6 text-black/30 mx-auto mt-10" />;
  if (!orders?.length) return <p className="text-black/40 text-center mt-10">No collected orders awaiting intake.</p>;

  if (selectedId) {
    return <IntakeDetail orderId={selectedId} onBack={() => { setSelectedId(null); refetch(); }} />;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Intake</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/50 uppercase tracking-wider">
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Unit</th>
              <th className="py-2 pr-4">Address</th>
              <th className="py-2 pr-4">Service</th>
              <th className="py-2 pr-4">Pickup Date</th>
              <th className="py-2 pr-4">Notes</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                <td className="py-3 pr-4">{o.firstName} {o.lastName}</td>
                <td className="py-3 pr-4">{o.unit || "—"}</td>
                <td className="py-3 pr-4 max-w-[180px] truncate">{o.address}</td>
                <td className="py-3 pr-4">{o.serviceType === "wash_fold" ? "W&F" : "DC"}</td>
                <td className="py-3 pr-4">{formatDate(o.pickupDate)}</td>
                <td className="py-3 pr-4 max-w-[200px] truncate text-black/50">{o.specialInstructions || "—"}</td>
                <td className="py-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-black text-black text-xs"
                    onClick={() => setSelectedId(o.id)}
                  >
                    Open
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-500 text-red-500 hover:bg-red-50 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(o.id);
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white p-6 max-w-sm w-full mx-4 rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Delete Order</h3>
            <p className="text-black/60 mb-4">Are you sure you want to delete this order? This action cannot be undone.</p>
            <div className="flex gap-2">
              <Button
                className="bg-red-500 text-white hover:bg-red-600 flex-1"
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteOrder.isPending}
              >
                {deleteOrder.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                Delete
              </Button>
              <Button variant="outline" className="border-black/20 flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== INTAKE DETAIL ===== */
function IntakeDetail({ orderId, onBack }: { orderId: number; onBack: () => void }) {
  const { data: order, isLoading } = trpc.admin.getOrder.useQuery({ id: orderId });
  const saveIntake = trpc.admin.saveIntake.useMutation();
  const chargeCard = trpc.admin.chargeCard.useMutation();

  // Wash & fold state
  const [weightLbs, setWeightLbs] = useState("");
  const [selectedUpcharges, setSelectedUpcharges] = useState<Record<string, boolean>>({});
  const [flatRateQtys, setFlatRateQtys] = useState<Record<string, number>>({});

  // Dry cleaning state
  const [dcQtys, setDcQtys] = useState<Record<string, number>>({});

  // Shared
  const [discountPercent, setDiscountPercent] = useState("0");
  const [chargeResult, setChargeResult] = useState<{ success: boolean; error?: string; isFirstPaidOrder?: boolean; portalJwt?: string | null } | null>(null);

  const isWF = order?.serviceType === "wash_fold";

  // Calculate totals
  const totals = useMemo(() => {
    if (!order) return { subtotalCents: 0, totalCents: 0 };
    const disc = parseFloat(discountPercent) || 0;

    // Calculate W&F section
    const w = parseFloat(weightLbs) || 0;
    const upcharges: Record<string, UpchargeEntry> = {};
    WF_UPCHARGES.forEach((u) => {
      if (selectedUpcharges[u.id]) {
        upcharges[u.id] = { label: u.label, unit_price_cents: u.priceCents, qty: 1, total_cents: u.priceCents };
      }
    });
    const flatRate: Record<string, UpchargeEntry> = {};
    WF_FLAT_RATE_TEXTILES.forEach((f) => {
      const qty = flatRateQtys[f.id] || 0;
      if (qty > 0) {
        flatRate[f.id] = { label: f.label, unit_price_cents: f.priceCents, qty, total_cents: f.priceCents * qty };
      }
    });
    const wfTotal = calcWashFoldTotal(w, upcharges, flatRate, disc);

    // Calculate DC section
    const items: Record<string, DryCleanEntry> = {};
    DC_ITEMS.forEach((item) => {
      const qty = dcQtys[item.id] || 0;
      if (qty > 0) {
        items[item.id] = { label: item.label, category: item.category, unit_price_cents: item.priceCents, qty, total_cents: item.priceCents * qty };
      }
    });
    const dcTotal = calcDryCleanTotal(items, disc);

    // Combine both sections
    return {
      subtotalCents: wfTotal.subtotalCents + dcTotal.subtotalCents,
      totalCents: wfTotal.totalCents + dcTotal.totalCents
    };
  }, [order, weightLbs, selectedUpcharges, flatRateQtys, dcQtys, discountPercent]);

  const handleCharge = async () => {
    if (!order) return;

    // Build JSON data
    const upchargesJson: Record<string, UpchargeEntry> = {};
    WF_UPCHARGES.forEach((u) => {
      if (selectedUpcharges[u.id]) {
        upchargesJson[u.id] = { label: u.label, unit_price_cents: u.priceCents, qty: 1, total_cents: u.priceCents };
      }
    });
    WF_FLAT_RATE_TEXTILES.forEach((f) => {
      const qty = flatRateQtys[f.id] || 0;
      if (qty > 0) {
        upchargesJson[f.id] = { label: f.label, unit_price_cents: f.priceCents, qty, total_cents: f.priceCents * qty };
      }
    });

    const drycleanItemsJson: Record<string, DryCleanEntry> = {};
    DC_ITEMS.forEach((item) => {
      const qty = dcQtys[item.id] || 0;
      if (qty > 0) {
        drycleanItemsJson[item.id] = { label: item.label, category: item.category, unit_price_cents: item.priceCents, qty, total_cents: item.priceCents * qty };
      }
    });

    // Save intake data first
    await saveIntake.mutateAsync({
      orderId: order.id,
      weightLbs: isWF ? parseFloat(weightLbs) || 0 : undefined,
      subtotal: centsToDollars(totals.subtotalCents),
      discountPercent: discountPercent || "0",
      total: centsToDollars(totals.totalCents),
      upchargesJson: isWF ? upchargesJson : undefined,
      drycleanItemsJson: !isWF ? drycleanItemsJson : undefined,
    });

    // Charge
    const result = await chargeCard.mutateAsync({
      orderId: order.id,
      amountCents: totals.totalCents,
    });
    setChargeResult(result);
  };

  if (isLoading || !order) return <Loader2 className="animate-spin w-6 h-6 text-black/30 mx-auto mt-10" />;

  // Success state
  if (chargeResult?.success) {
    return (
      <div className="max-w-xl">
        <div className="text-center py-12">
          <Check className="w-16 h-16 mx-auto mb-4 text-black" />
          <p className="text-xl font-semibold mb-1">Charged successfully.</p>
          <p className="text-black/50 text-sm">${centsToDollars(totals.totalCents)} — {order.firstName} {order.lastName}</p>

          {chargeResult.isFirstPaidOrder && chargeResult.portalJwt && (
            <div className="mt-8 p-4 border border-black/20 text-left">
              <p className="text-xs font-medium text-black/50 uppercase tracking-wider mb-2">Portal Enrollment</p>
              <p className="text-sm text-black/60 mb-3">First paid order. Copy the link below and send to the customer.</p>
              <CopyButton text={`https://bldg.chat/foropusla/welcome?token=${chargeResult.portalJwt}`} />
            </div>
          )}
        </div>
        <Button variant="outline" className="border-black text-black" onClick={onBack}>Back to Intake</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <button onClick={onBack} className="text-sm text-black/50 hover:text-black mb-4 flex items-center gap-1">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-start justify-between mb-6">
        <h2 className="text-lg font-semibold">
          Order #{order.id} — {order.firstName} {order.lastName}
        </h2>
        <div className="text-right">
          <p className="text-xs text-black/40">Unit {order.unit || "—"}</p>
          <p className="text-xs text-black/50 max-w-[200px] text-right">{order.address}</p>
        </div>
      </div>

      {order.specialInstructions && (
        <p className="text-sm text-black/60 mb-4 p-3 bg-black/5 border border-black/10">
          Notes: {order.specialInstructions}
        </p>
      )}

      {/* Error state */}
      {chargeResult && !chargeResult.success && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 text-red-800 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {chargeResult.error}
        </div>
      )}

      <WashFoldIntake
        weightLbs={weightLbs}
        setWeightLbs={setWeightLbs}
        selectedUpcharges={selectedUpcharges}
        setSelectedUpcharges={setSelectedUpcharges}
        flatRateQtys={flatRateQtys}
        setFlatRateQtys={setFlatRateQtys}
      />
      
      <DryCleanIntake dcQtys={dcQtys} setDcQtys={setDcQtys} />

      {/* Discount */}
      <div className="mt-6 mb-4">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Discount %</label>
        <Input
          type="number"
          value={discountPercent}
          onChange={(e) => setDiscountPercent(e.target.value)}
          className="w-32 bg-white border-black/20"
          min="0"
          max="100"
        />
      </div>

      {/* Totals */}
      <div className="border-t border-black/10 pt-4 mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-black/50">Subtotal</span>
          <span>${centsToDollars(totals.subtotalCents)}</span>
        </div>
        {parseFloat(discountPercent) > 0 && (
          <div className="flex justify-between text-sm mb-1">
            <span className="text-black/50">Discount ({discountPercent}%)</span>
            <span>-${centsToDollars(totals.subtotalCents - totals.totalCents)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-semibold mt-2">
          <span>Total</span>
          <span>${centsToDollars(totals.totalCents)}</span>
        </div>
        {isWF && totals.subtotalCents === WF_MINIMUM_SUBTOTAL_CENTS && parseFloat(weightLbs) > 0 && (
          <p className="text-xs text-black/40 mt-1">$45.00 minimum applied</p>
        )}
      </div>

      <Button
        className="bg-black text-white hover:bg-black/90 w-full"
        onClick={handleCharge}
        disabled={totals.totalCents < 50 || chargeCard.isPending || saveIntake.isPending}
      >
        {(chargeCard.isPending || saveIntake.isPending) ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
        Charge Card — ${centsToDollars(totals.totalCents)}
      </Button>
    </div>
  );
}

/* ===== WASH & FOLD INTAKE ===== */
function WashFoldIntake({
  weightLbs, setWeightLbs, selectedUpcharges, setSelectedUpcharges, flatRateQtys, setFlatRateQtys,
}: {
  weightLbs: string;
  setWeightLbs: (v: string) => void;
  selectedUpcharges: Record<string, boolean>;
  setSelectedUpcharges: (v: Record<string, boolean>) => void;
  flatRateQtys: Record<string, number>;
  setFlatRateQtys: (v: Record<string, number>) => void;
}) {
  return (
    <>
      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Weight (lbs)</label>
        <Input
          type="number"
          step="0.1"
          value={weightLbs}
          onChange={(e) => setWeightLbs(e.target.value)}
          placeholder="0.0"
          className="w-40 bg-white border-black/20"
        />
        {parseFloat(weightLbs) > 0 && (
          <p className="text-xs text-black/40 mt-1">
            Base: {weightLbs} lbs × $2.50 = ${centsToDollars(Math.round(parseFloat(weightLbs) * WF_RATE_PER_LB_CENTS))}
          </p>
        )}
      </div>

      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-2">Upcharges</label>
        <div className="flex flex-wrap gap-2">
          {WF_UPCHARGES.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUpcharges({ ...selectedUpcharges, [u.id]: !selectedUpcharges[u.id] })}
              className={`px-3 py-1.5 text-xs border transition-colors ${
                selectedUpcharges[u.id]
                  ? "bg-black text-white border-black"
                  : "bg-white text-black border-black/20 hover:border-black/40"
              }`}
            >
              {u.label} {u.priceCents > 0 ? `+$${centsToDollars(u.priceCents)}` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-2">Flat-Rate Textiles</label>
        <div className="space-y-2">
          {WF_FLAT_RATE_TEXTILES.map((f) => (
            <div key={f.id} className="flex items-center justify-between border border-black/10 px-3 py-2">
              <span className="text-sm">{f.label} — ${centsToDollars(f.priceCents)}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFlatRateQtys({ ...flatRateQtys, [f.id]: Math.max(0, (flatRateQtys[f.id] || 0) - 1) })}
                  className="w-7 h-7 border border-black/20 text-sm flex items-center justify-center hover:bg-black/5"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm">{flatRateQtys[f.id] || 0}</span>
                <button
                  onClick={() => setFlatRateQtys({ ...flatRateQtys, [f.id]: (flatRateQtys[f.id] || 0) + 1 })}
                  className="w-7 h-7 border border-black/20 text-sm flex items-center justify-center hover:bg-black/5"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ===== DRY CLEAN INTAKE ===== */
function DryCleanIntake({
  dcQtys, setDcQtys,
}: {
  dcQtys: Record<string, number>;
  setDcQtys: (v: Record<string, number>) => void;
}) {
  const categories = useMemo(() => {
    const cats: Record<string, typeof DC_ITEMS> = {};
    DC_ITEMS.forEach((item) => {
      if (!cats[item.category]) cats[item.category] = [];
      cats[item.category].push(item);
    });
    return cats;
  }, []);

  return (
    <div className="space-y-6">
      {Object.entries(categories).map(([cat, items]) => (
        <div key={cat}>
          <h3 className="text-xs font-medium text-black/50 uppercase tracking-wider mb-2">{cat}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {items.map((item) => {
              const qty = dcQtys[item.id] || 0;
              return (
                <button
                  key={item.id}
                  onClick={() => setDcQtys({ ...dcQtys, [item.id]: qty + 1 })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (qty > 0) setDcQtys({ ...dcQtys, [item.id]: qty - 1 });
                  }}
                  className={`relative p-2 border text-left text-xs transition-colors ${
                    qty > 0
                      ? "bg-black text-white border-black"
                      : "bg-white text-black border-black/15 hover:border-black/30"
                  }`}
                >
                  <span className="block">{item.label}</span>
                  <span className="block text-[10px] opacity-60">${centsToDollars(item.priceCents)}</span>
                  {qty > 0 && (
                    <span className="absolute top-1 right-1 bg-white text-black text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full">
                      {qty}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-black/40">Click to add. Right-click to remove.</p>
    </div>
  );
}

/* ===== PROCESSING TAB ===== */
function ProcessingTab() {
  const { data: orders, isLoading, refetch } = trpc.admin.listByStatus.useQuery({ status: "processing" });
  const markReady = trpc.admin.markReady.useMutation();
  const [modal, setModal] = useState<{ orderId: number; serviceType: string } | null>(null);
  const [bagCount, setBagCount] = useState("1");
  const [garmentCount, setGarmentCount] = useState("");

  const handleMarkReady = async () => {
    if (!modal) return;
    await markReady.mutateAsync({
      orderId: modal.orderId,
      bagCount: parseInt(bagCount) || 1,
      garmentCount: garmentCount ? parseInt(garmentCount) : undefined,
    });
    setModal(null);
    setBagCount("1");
    setGarmentCount("");
    refetch();
  };

  if (isLoading) return <Loader2 className="animate-spin w-6 h-6 text-black/30 mx-auto mt-10" />;
  if (!orders?.length) return <p className="text-black/40 text-center mt-10">No orders in processing.</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Processing</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/50 uppercase tracking-wider">
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Unit</th>
              <th className="py-2 pr-4">Service</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2 pr-4">Paid</th>
              <th className="py-2 pr-4">Notes</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                <td className="py-3 pr-4">{o.firstName} {o.lastName}</td>
                <td className="py-3 pr-4">{o.unit || "—"}</td>
                <td className="py-3 pr-4">{o.serviceType === "wash_fold" ? "W&F" : "DC"}</td>
                <td className="py-3 pr-4">${o.total || "0.00"}</td>
                <td className="py-3 pr-4">{o.paid ? "Yes" : "No"}</td>
                <td className="py-3 pr-4 max-w-[200px] truncate text-black/50">{o.specialInstructions || "—"}</td>
                <td className="py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-black text-black text-xs"
                    onClick={() => setModal({ orderId: o.id, serviceType: o.serviceType })}
                  >
                    Mark Ready
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mark Ready Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setModal(null)}>
          <div className="bg-white p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Mark Ready</h3>
            <div className="mb-4">
              <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Bag Count</label>
              <Input type="number" value={bagCount} onChange={(e) => setBagCount(e.target.value)} min="1" className="bg-white border-black/20" />
            </div>
            {modal.serviceType === "dry_cleaning" && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Garment Count</label>
                <Input type="number" value={garmentCount} onChange={(e) => setGarmentCount(e.target.value)} className="bg-white border-black/20" />
              </div>
            )}
            <div className="flex gap-2">
              <Button className="bg-black text-white hover:bg-black/90 flex-1" onClick={handleMarkReady} disabled={markReady.isPending}>
                {markReady.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                Confirm
              </Button>
              <Button variant="outline" className="border-black/20" onClick={() => setModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== READY TAB ===== */
function ReadyTab() {
  const { data: orders, isLoading, refetch } = trpc.admin.listByStatus.useQuery({ status: "ready" });
  const updateStatus = trpc.admin.updateStatus.useMutation();

  const handleDeliver = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "delivered" });
    refetch();
  };

  if (isLoading) return <Loader2 className="animate-spin w-6 h-6 text-black/30 mx-auto mt-10" />;
  if (!orders?.length) return <p className="text-black/40 text-center mt-10">No orders ready for delivery.</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Ready for Delivery</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/50 uppercase tracking-wider">
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Unit</th>
              <th className="py-2 pr-4">Address</th>
              <th className="py-2 pr-4">Delivery</th>
              <th className="py-2 pr-4">Window</th>
              <th className="py-2 pr-4">Bags</th>
              <th className="py-2 pr-4">Garments</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                <td className="py-3 pr-4">{o.firstName} {o.lastName}</td>
                <td className="py-3 pr-4">{o.unit || "—"}</td>
                <td className="py-3 pr-4 max-w-[200px] truncate">{o.address}</td>
                <td className="py-3 pr-4">{formatDate(o.deliveryDate || "")}</td>
                <td className="py-3 pr-4">{o.deliveryTimeWindow || "—"}</td>
                <td className="py-3 pr-4">{o.bagCount || "—"}</td>
                <td className="py-3 pr-4">{o.garmentCount || "—"}</td>
                <td className="py-3 pr-4">${o.total || "0.00"}</td>
                <td className="py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-black text-black text-xs"
                    onClick={() => handleDeliver(o.id)}
                    disabled={updateStatus.isPending}
                  >
                    Mark Delivered
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== PICKUPS TAB (DRIVER VIEW INSIDE ADMIN) ===== */
function PickupsTab() {
  const [weekOffset, setWeekOffset] = useState(0);
  const dates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  // Use local date formatting to avoid timezone shifts
  const todayLocal = new Date();
  const todayStr = todayLocal.getFullYear() + "-" + String(todayLocal.getMonth() + 1).padStart(2, "0") + "-" + String(todayLocal.getDate()).padStart(2, "0");
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const { data: pickups, refetch: refetchPickups } = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "new",
    dateField: "pickupDate",
  });

  const { data: deliveries, refetch: refetchDeliveries } = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "ready",
    dateField: "deliveryDate",
  });

  const updateStatus = trpc.admin.updateStatus.useMutation();

  const handleCollect = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "collected" });
    refetchPickups();
  };

  const handleDeliver = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "delivered" });
    refetchDeliveries();
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Pickups & Deliveries</h2>

      {/* Day selector */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
        <button onClick={() => setWeekOffset(weekOffset - 1)} className="p-1 hover:bg-black/5">
          <ChevronLeft className="w-5 h-5" />
        </button>
        {dates.map((d) => (
          <button
            key={d.value}
            onClick={() => setSelectedDate(d.value)}
            className={`px-3 py-2 text-xs whitespace-nowrap border transition-colors ${
              selectedDate === d.value
                ? "bg-black text-white border-black"
                : d.isToday
                ? "bg-white text-black border-black/40"
                : "bg-white text-black/60 border-black/10 hover:border-black/30"
            }`}
          >
            {d.label}
          </button>
        ))}
        <button onClick={() => setWeekOffset(weekOffset + 1)} className="p-1 hover:bg-black/5">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Pickups */}
      <div className="mb-8">
        <h3 className="text-xs font-medium text-black/50 uppercase tracking-wider mb-3">
          Pickups ({pickups?.length || 0})
        </h3>
        {!pickups?.length ? (
          <p className="text-sm text-black/30">No pickups for this day.</p>
        ) : (
          <div className="space-y-2">
            {pickups.map((o) => (
              <StopCard key={o.id} order={o} action="Mark Collected" onAction={() => handleCollect(o.id)} isPending={updateStatus.isPending} />
            ))}
          </div>
        )}
      </div>

      {/* Deliveries */}
      <div>
        <h3 className="text-xs font-medium text-black/50 uppercase tracking-wider mb-3">
          Deliveries ({deliveries?.length || 0})
        </h3>
        {!deliveries?.length ? (
          <p className="text-sm text-black/30">No deliveries for this day.</p>
        ) : (
          <div className="space-y-2">
            {deliveries.map((o) => (
              <StopCard key={o.id} order={o} action="Mark Delivered" onAction={() => handleDeliver(o.id)} isPending={updateStatus.isPending} showBags />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== STOP CARD (used in Pickups tab and Driver) ===== */
export function StopCard({
  order,
  action,
  onAction,
  isPending,
  showBags,
}: {
  order: Order;
  action: string;
  onAction: () => void;
  isPending: boolean;
  showBags?: boolean;
}) {
  const fullAddress = order.address + (order.unit ? `, Unit ${order.unit}` : "");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  const normalizedPhone = order.phone.replace(/[^\d+]/g, "");
  const phoneDigits = normalizedPhone.startsWith("+") ? normalizedPhone : normalizedPhone.replace(/^1/, "+1") || normalizedPhone;

  // Parse address into street and city/state/zip
  const addressParts = order.address.split(",").map((s: string) => s.trim());
  const streetLine = addressParts[0] || order.address;
  const cityStateZip = addressParts.length > 1 ? addressParts.slice(1).join(", ") : "";

  return (
    <div className="border border-black/10 p-4">
      {/* Customer name + unit + service badge */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-sm">{order.firstName} {order.lastName}</p>
          <p className="text-xs text-black/50">Unit {order.unit || "—"} · {order.pickupTimeWindow}</p>
        </div>
        <span className="text-[10px] text-black/30 uppercase tracking-wider">
          {order.serviceType === "wash_fold" ? "W&F" : "DC"}
        </span>
      </div>

      {/* Full address — tappable → Google Maps */}
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-1.5 text-xs text-black/60 hover:text-black mb-2 group"
      >
        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div>
          <span className="underline group-hover:text-black">{streetLine}</span>
          {cityStateZip && (
            <span className="block text-[11px] text-black/40">{cityStateZip}</span>
          )}
        </div>
      </a>

      {/* Phone + Call/Text icons */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-black/60">{order.phone}</span>
        <a href={`tel:${phoneDigits}`} title="Call" className="text-black/40 hover:text-black transition-colors">
          <Phone className="w-3.5 h-3.5" />
        </a>
        <a href={`sms:${phoneDigits}`} title="Text" className="text-black/40 hover:text-black transition-colors">
          <MessageSquare className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Bags for deliveries */}
      {showBags && (
        <div className="flex items-center gap-1.5 text-xs text-black/60 mb-2">
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span>
            {order.bagCount || 0} bag{(order.bagCount || 0) !== 1 ? "s" : ""}
            {order.garmentCount ? ` · ${order.garmentCount} garments` : ""}
          </span>
        </div>
      )}

      {/* Special instructions */}
      {order.specialInstructions && (
        <p className="text-xs text-black/40 italic mb-3">{order.specialInstructions}</p>
      )}

      {/* Action button */}
      <Button
        variant="outline"
        size="sm"
        className="border-black text-black text-xs w-full sm:w-auto"
        onClick={onAction}
        disabled={isPending}
      >
        {action}
      </Button>
    </div>
  );
}

/* ===== SHARED COMPONENTS ===== */
function OrderTable({
  orders,
  columns,
  onOpen,
}: {
  orders: Order[];
  columns: string[];
  onOpen: (id: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-xs text-black/50 uppercase tracking-wider">
            {columns.map((c) => (
              <th key={c} className="py-2 pr-4">{c}</th>
            ))}
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-black/5 hover:bg-black/[0.02] cursor-pointer" onClick={() => onOpen(o.id)}>
              <td className="py-3 pr-4">{o.firstName} {o.lastName}</td>
              <td className="py-3 pr-4">{o.unit || "—"}</td>
              <td className="py-3 pr-4">{o.serviceType === "wash_fold" ? "W&F" : "DC"}</td>
              <td className="py-3 pr-4">{formatDate(o.pickupDate)}</td>
              <td className="py-3 pr-4 max-w-[200px] truncate text-black/50">{o.specialInstructions || "—"}</td>
              <td className="py-3">
                <Button variant="outline" size="sm" className="border-black text-black text-xs">Open</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 w-full p-3 bg-black/5 border border-black/10 text-sm hover:bg-black/10 transition-colors"
    >
      {copied ? <Check className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
      <span className="truncate">{copied ? "Copied!" : text}</span>
    </button>
  );
}

/* ===== VENDORS TAB ===== */
function VendorsTab() {
  const vendorsQuery = trpc.admin.listVendors.useQuery();
  const createVendorMutation = trpc.admin.createVendor.useMutation();
  const updateActiveMutation = trpc.admin.updateVendorActive.useMutation();
  const createAccountMutation = trpc.admin.createConnectAccount.useMutation();
  const onboardingLinkMutation = trpc.admin.createConnectOnboardingLink.useMutation();
  const statusMutation = trpc.admin.getConnectAccountStatus.useMutation();

  const [newVendor, setNewVendor] = useState({ name: "", email: "", country: "US", platformFeePercent: "5" });
  const [creating, setCreating] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<number, { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; currentlyDue: string[]; pastDue: string[]; disabledReason: string | null }>>({});
  const setVendorUserPasswordMutation = trpc.admin.setVendorUserPassword.useMutation();
  const updateVendorBrandingMutation = trpc.admin.updateVendorBranding.useMutation();
  const updateVendorSlugMutation = trpc.admin.updateVendorSlug.useMutation();
  const [vendorEdits, setVendorEdits] = useState<Record<number, { slug: string; brandName: string; logoUrl: string }>>({});
  const [vendorPassword, setVendorPassword] = useState<Record<number, { email: string; password: string }>>({});

  const handleCreateVendor = async () => {
    if (!newVendor.name.trim()) return;
    setCreating(true);
    try {
      const feeVal = parseFloat(newVendor.platformFeePercent);
      await createVendorMutation.mutateAsync({
        name: newVendor.name,
        email: newVendor.email || undefined,
        country: newVendor.country || undefined,
        platformFeePercent: !isNaN(feeVal) && feeVal >= 0 && feeVal <= 100 ? feeVal : undefined,
      });
      setNewVendor({ name: "", email: "", country: "US", platformFeePercent: "5" });
      vendorsQuery.refetch();
    } finally {
      setCreating(false);
    }
  };

  const handleCreateAccount = async (vendorId: number) => {
    await createAccountMutation.mutateAsync({ vendorId });
    vendorsQuery.refetch();
  };

  const handleOpenOnboarding = async (vendorId: number) => {
    const result = await onboardingLinkMutation.mutateAsync({ vendorId });
    window.open(result.url, "_blank");
  };

  const handleCopyOnboarding = async (vendorId: number) => {
    const result = await onboardingLinkMutation.mutateAsync({ vendorId });
    await navigator.clipboard.writeText(result.url);
  };

  const handleRefreshStatus = async (vendorId: number) => {
    const result = await statusMutation.mutateAsync({ vendorId });
    setStatusMap(prev => ({ ...prev, [vendorId]: result }));
    vendorsQuery.refetch();
  };

  const handleToggleActive = async (vendorId: number, isActive: boolean) => {
    await updateActiveMutation.mutateAsync({ vendorId, isActive });
    vendorsQuery.refetch();
  };

  const handleSetVendorUserPassword = async (vendorId: number, email: string, password: string) => {
    await setVendorUserPasswordMutation.mutateAsync({ vendorId, email, password });
    setVendorPassword(prev => ({ ...prev, [vendorId]: { email: "", password: "" } }));
  };

  const handleUpdateVendorBranding = async (vendorId: number, brandName: string | null, logoUrl: string | null) => {
    await updateVendorBrandingMutation.mutateAsync({ vendorId, brandName, logoUrl });
    vendorsQuery.refetch();
  };

  const handleUpdateVendorSlug = async (vendorId: number, slug: string) => {
    await updateVendorSlugMutation.mutateAsync({ vendorId, slug });
    vendorsQuery.refetch();
  };

  const vendors = vendorsQuery.data ?? [];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Vendors</h2>
        <span className="text-xs text-black/40">Platform fee: {import.meta.env.VITE_PLATFORM_FEE_PERCENT ?? "5"}%</span>
      </div>

      {/* Create vendor form */}
      <div className="border border-black/10 p-4 mb-8">
        <h3 className="text-sm font-semibold mb-3">Add Vendor</h3>
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-xs text-black/50 uppercase tracking-wider mb-1">Name</label>
            <input value={newVendor.name} onChange={e => setNewVendor(v => ({ ...v, name: e.target.value }))} placeholder="Laundry Butler" className="w-full border border-black/20 rounded px-3 py-2 text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs text-black/50 uppercase tracking-wider mb-1">Email (optional)</label>
            <input value={newVendor.email} onChange={e => setNewVendor(v => ({ ...v, email: e.target.value }))} placeholder="vendor@example.com" className="w-full border border-black/20 rounded px-3 py-2 text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs text-black/50 uppercase tracking-wider mb-1">Country</label>
            <input value={newVendor.country} onChange={e => setNewVendor(v => ({ ...v, country: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="US" maxLength={2} className="w-full border border-black/20 rounded px-3 py-2 text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs text-black/50 uppercase tracking-wider mb-1">Platform Fee (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={newVendor.platformFeePercent}
              onChange={e => setNewVendor(v => ({ ...v, platformFeePercent: e.target.value }))}
              placeholder="5"
              className="w-full border border-black/20 rounded px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>
        <p className="text-xs text-black/30 mb-2">Name state: "{newVendor.name}"</p>
        <Button className="bg-black text-white hover:bg-black/90" onClick={handleCreateVendor} disabled={creating}>
          {creating ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
          Create Vendor
        </Button>
      </div>

      {/* Vendor list */}
      {vendorsQuery.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin w-6 h-6 text-black/30" /></div>
      ) : vendors.length === 0 ? (
        <p className="text-sm text-black/40 border border-black/10 p-4">No vendors yet. Add one above.</p>
      ) : (
        <div className="space-y-4">
          {vendors.map(vendor => {
            const badge = connectStatusBadge(vendor);
            const liveStatus = statusMap[vendor.id];
            const currentlyDue: string[] = liveStatus?.currentlyDue ?? (vendor.currentlyDue ? JSON.parse(vendor.currentlyDue) : []);
            const pastDue: string[] = liveStatus?.pastDue ?? (vendor.pastDue ? JSON.parse(vendor.pastDue) : []);
            const disabledReason = liveStatus?.disabledReason ?? vendor.disabledReason;
            const payoutsEnabled = liveStatus?.payoutsEnabled ?? vendor.payoutsEnabled;
            const chargesEnabled = liveStatus?.chargesEnabled ?? vendor.chargesEnabled;
            const detailsSubmitted = liveStatus?.detailsSubmitted ?? vendor.detailsSubmitted;

            return (
              <div key={vendor.id} className="border border-black/10 p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{vendor.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                      {!vendor.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-black/10 text-black/50">Inactive</span>}
                    </div>
                    {vendor.email && <p className="text-xs text-black/40 mt-0.5">{vendor.email} · {vendor.country ?? "US"}</p>}
                    <p className="text-xs text-black/40 mt-0.5">
                      Platform fee: {vendor.platformFeePercent != null ? `${parseFloat(vendor.platformFeePercent as string)}%` : `${import.meta.env.VITE_PLATFORM_FEE_PERCENT ?? "5"}% (global default)`}
                    </p>
                    {vendor.stripeConnectAccountId && (
                      <p className="text-xs text-black/30 mt-0.5 font-mono">
                        {vendor.stripeConnectAccountId.slice(0, 8)}…{vendor.stripeConnectAccountId.slice(-4)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleActive(vendor.id, !vendor.isActive)}
                    className="text-xs text-black/40 hover:text-black underline shrink-0"
                  >
                    {vendor.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>

                {/* Vendor portal: slug, brand, logo, password */}
                <div className="mb-3 p-3 bg-black/5 rounded text-xs space-y-2">
                  <p className="font-medium text-black/70">Vendor portal</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-black/50 mb-0.5">Slug (e.g. laundrybutler)</label>
                      <div className="flex gap-1">
                        <input
                          value={vendorEdits[vendor.id]?.slug ?? vendor.slug ?? ""}
                          onChange={e => setVendorEdits(v => ({ ...v, [vendor.id]: { ...v[vendor.id], slug: e.target.value, brandName: v[vendor.id]?.brandName ?? vendor.brandName ?? "", logoUrl: v[vendor.id]?.logoUrl ?? vendor.logoUrl ?? "" } }))}
                          placeholder="laundrybutler"
                          className="flex-1 border border-black/20 rounded px-2 py-1.5 text-sm"
                        />
                        <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={() => handleUpdateVendorSlug(vendor.id, vendorEdits[vendor.id]?.slug ?? vendor.slug ?? "")}>
                          Set
                        </Button>
                      </div>
                      {vendor.slug && <p className="text-black/40 mt-0.5 text-[10px]">→ [slug].ops.bldg.chat</p>}
                    </div>
                    <div>
                      <label className="block text-black/50 mb-0.5">Brand name</label>
                      <div className="flex gap-1">
                        <input
                          value={vendorEdits[vendor.id]?.brandName ?? vendor.brandName ?? vendor.name}
                          onChange={e => setVendorEdits(v => ({ ...v, [vendor.id]: { ...v[vendor.id], slug: v[vendor.id]?.slug ?? vendor.slug ?? "", brandName: e.target.value, logoUrl: v[vendor.id]?.logoUrl ?? vendor.logoUrl ?? "" } }))}
                          placeholder="Brand"
                          className="flex-1 border border-black/20 rounded px-2 py-1.5 text-sm"
                        />
                        <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={() => handleUpdateVendorBranding(vendor.id, vendorEdits[vendor.id]?.brandName ?? vendor.brandName ?? null, vendorEdits[vendor.id]?.logoUrl ?? vendor.logoUrl ?? null)}>
                          Set
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-black/50 mb-0.5">Logo URL</label>
                      <input
                        value={vendorEdits[vendor.id]?.logoUrl ?? vendor.logoUrl ?? ""}
                        onChange={e => setVendorEdits(v => ({ ...v, [vendor.id]: { ...v[vendor.id], slug: v[vendor.id]?.slug ?? vendor.slug ?? "", brandName: v[vendor.id]?.brandName ?? vendor.brandName ?? "", logoUrl: e.target.value } }))}
                        placeholder="https://..."
                        className="w-full border border-black/20 rounded px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-black/10">
                    <label className="block text-black/50 mb-1">Set vendor user password</label>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="email"
                        value={vendorPassword[vendor.id]?.email ?? ""}
                        onChange={e => setVendorPassword(v => ({ ...v, [vendor.id]: { ...v[vendor.id], email: e.target.value, password: v[vendor.id]?.password ?? "" } }))}
                        placeholder="vendor@example.com"
                        className="border border-black/20 rounded px-2 py-1.5 text-sm w-40"
                      />
                      <input
                        type="password"
                        value={vendorPassword[vendor.id]?.password ?? ""}
                        onChange={e => setVendorPassword(v => ({ ...v, [vendor.id]: { ...v[vendor.id], email: v[vendor.id]?.email ?? "", password: e.target.value } }))}
                        placeholder="Password (min 6)"
                        className="border border-black/20 rounded px-2 py-1.5 text-sm w-32"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        disabled={!(vendorPassword[vendor.id]?.email && vendorPassword[vendor.id]?.password?.length >= 6)}
                        onClick={() => {
                          const pw = vendorPassword[vendor.id];
                          if (pw?.email && pw?.password) handleSetVendorUserPassword(vendor.id, pw.email, pw.password);
                        }}
                      >
                        Set / Reset password
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Status indicators */}
                {vendor.stripeConnectAccountId && (
                  <div className="flex gap-4 mb-3 text-xs text-black/50">
                    <span className={payoutsEnabled ? "text-green-600" : ""}>{payoutsEnabled ? "✓" : "✗"} Payouts</span>
                    <span className={chargesEnabled ? "text-green-600" : ""}>{chargesEnabled ? "✓" : "✗"} Charges</span>
                    <span className={detailsSubmitted ? "text-green-600" : ""}>{detailsSubmitted ? "✓" : "✗"} Details submitted</span>
                  </div>
                )}

                {/* Requirements */}
                {(currentlyDue.length > 0 || pastDue.length > 0 || disabledReason) && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 text-xs">
                    {disabledReason && <p className="font-medium text-red-700 mb-1">Disabled: {disabledReason}</p>}
                    {currentlyDue.length > 0 && (
                      <div className="mb-1">
                        <span className="font-medium text-amber-800">Currently due:</span>
                        <ul className="mt-0.5 space-y-0.5 text-amber-700">
                          {currentlyDue.map(r => <li key={r}>· {r}</li>)}
                        </ul>
                      </div>
                    )}
                    {pastDue.length > 0 && (
                      <div>
                        <span className="font-medium text-red-800">Past due:</span>
                        <ul className="mt-0.5 space-y-0.5 text-red-700">
                          {pastDue.map(r => <li key={r}>· {r}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {!vendor.stripeConnectAccountId ? (
                    <Button
                      size="sm"
                      className="bg-black text-white hover:bg-black/90 text-xs"
                      onClick={() => handleCreateAccount(vendor.id)}
                      disabled={createAccountMutation.isPending}
                    >
                      {createAccountMutation.isPending ? <Loader2 className="animate-spin w-3 h-3 mr-1" /> : null}
                      Create Connect Account
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-black text-black text-xs"
                        onClick={() => handleOpenOnboarding(vendor.id)}
                        disabled={onboardingLinkMutation.isPending}
                      >
                        {onboardingLinkMutation.isPending ? <Loader2 className="animate-spin w-3 h-3 mr-1" /> : null}
                        Open Onboarding
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-black text-black text-xs"
                        onClick={() => handleCopyOnboarding(vendor.id)}
                        disabled={onboardingLinkMutation.isPending}
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Copy Link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-black text-black text-xs"
                        onClick={() => handleRefreshStatus(vendor.id)}
                        disabled={statusMutation.isPending}
                      >
                        {statusMutation.isPending ? <Loader2 className="animate-spin w-3 h-3 mr-1" /> : null}
                        Refresh Status
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
