import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { CustomerProfileDrawer } from "@/components/CustomerProfileDrawer";
import { CustomersTab } from "@/components/CustomersTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Check, Copy, AlertCircle, ChevronLeft, ChevronRight, MapPin, Phone, MessageSquare, Package, Menu, Trash2, Camera, Mic, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WF_UPCHARGES,
  WF_FLAT_RATE_TEXTILES,
  WF_RATE_PER_LB_CENTS,
  WF_MINIMUM_SUBTOTAL_CENTS,
  calcWashFoldTotal,
  calcDryCleanTotal,
  centsToDollars,
  type UpchargeEntry,
  type DryCleanEntry,
} from "@shared/pricing";
import type { Order } from "@shared/types";
import {
  ADMIN_WORKSPACE_TABS as TABS,
  type AdminWorkspaceTab as Tab,
} from "@/admin/adminPaths";
import { getResidentWebOrigin } from "@/const";

const SUPPORTED_BUILDINGS: { label: string; value: string }[] = [
  { label: "OPUS LA", value: "opusla" },
  { label: "Century Park East", value: "centuryparkeast" },
];

/** Build drycleanItemsJson: keys = catalog slug (legacy DC item id). Uses DB catalog prices; falls back to saved JSON for unknown slugs. */
function buildDrycleanLineItems(
  catalogRows: Array<{ slug: string; name: string; category: string; standardPriceCents: number }>,
  dcQtys: Record<string, number>,
  legacyJson: Record<string, DryCleanEntry> | null | undefined
): Record<string, DryCleanEntry> {
  const bySlug = new Map(catalogRows.map((r) => [r.slug, r]));
  const out: Record<string, DryCleanEntry> = {};
  for (const [slug, qty] of Object.entries(dcQtys)) {
    if (!qty || qty <= 0) continue;
    const row = bySlug.get(slug);
    if (row) {
      out[slug] = {
        label: row.name,
        category: row.category,
        unit_price_cents: row.standardPriceCents,
        qty,
        total_cents: row.standardPriceCents * qty,
      };
    } else if (legacyJson && legacyJson[slug]) {
      const leg = legacyJson[slug];
      out[slug] = {
        label: leg.label,
        category: leg.category,
        unit_price_cents: leg.unit_price_cents,
        qty,
        total_cents: leg.unit_price_cents * qty,
      };
    }
  }
  return out;
}

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
  Customers: null,
  Intake: "collected",
  Processing: "processing",
  Ready: "ready",
  Pickups: null,
  Requests: null,
  Leads: null,
  Vendors: null,
};

/* ===== Utility ===== */
function formatDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type ReceiptCustomer = {
  orderId?: number | null;
  orderStatus?: string | null;
  serviceType?: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
};

type ParsedReceipt = {
  receiptIntakeId?: number;
  receiptImageUrl?: string | null;
  vendorName: string | null;
  receiptNumber: string | null;
  lines: Array<{ rawLabel: string; qty: number; unitPriceCents: number | null; lineTotalCents: number | null }>;
  dryCleanerRetailTotalCents: number;
  confidence: number;
  warnings: string[];
};

type ReceiptMatch = {
  rawLabel: string;
  matchedCatalogSlug: string | null;
  matchedCatalogName: string | null;
  category: string | null;
  qty: number;
  dryCleanerRetailLineTotalCents: number | null;
  laundryButlerUnitPriceCents: number | null;
  laundryButlerLineTotalCents: number;
  confidence: number;
  warning: string | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function money(cents: number | null | undefined): string {
  return `$${centsToDollars(cents ?? 0)}`;
}

function ResendSheetsButton({ orderId }: { orderId: number }) {
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const resend = trpc.admin.resendToSheets.useMutation();

  const onClick = async () => {
    setBusy(true);
    try {
      const r = await resend.mutateAsync({ orderId });
      if (r.success) toast.success("Sent to Sheets");
      else toast.error(r.error ?? "Failed");
    } catch {
      toast.error("Failed");
    } finally {
      setBusy(false);
      setCooldown(true);
      window.setTimeout(() => setCooldown(false), 3000);
    }
  };

  return (
    <button
      type="button"
      className="text-xs px-2 py-1.5 rounded border border-black/15 bg-white hover:bg-black/5 disabled:opacity-40 disabled:pointer-events-none leading-none"
      onClick={onClick}
      disabled={busy || cooldown}
      title="Resend revenue to Google Sheets"
    >
      📊
    </button>
  );
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
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [newOrderPhoneSeed, setNewOrderPhoneSeed] = useState<string | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const debouncedCustomerQuery = useDebounce(customerSearchQuery, 300);
  const searchOrders = trpc.admin.searchOrdersForReceipt.useQuery(
    { q: debouncedCustomerQuery },
    { enabled: debouncedCustomerQuery.length >= 2 }
  );
  const requestsCount = trpc.admin.countNewCoordinatedRequests.useQuery(undefined, { enabled: isAuthenticated });
  const leadsCount = trpc.admin.countUnreadLeads.useQuery(undefined, { enabled: isAuthenticated });

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
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open menu"
                    className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-black/60 hover:bg-black/5 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                  >
                    <Menu className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-black/40">
                    Shortcuts
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href="/catalog" className="flex items-center gap-2 text-sm">
                      <Package className="h-4 w-4 text-black/60" />
                      Manage Catalog
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="text-sm font-semibold tracking-widest uppercase">Laundry Butler</span>
            </div>
            <span className="text-xs text-black/40">{user?.name || "Admin"}</span>
          </div>
          <div className="flex gap-0 -mb-px overflow-x-auto">
            {TABS.map((tab) => {
              const isRequests = tab === "Requests";
              const isLeads = tab === "Leads";
              const reqCount = isRequests ? requestsCount.data ?? 0 : 0;
              const leadCount = isLeads ? leadsCount.data ?? 0 : 0;
              let label: React.ReactNode = tab;
              if (isRequests && reqCount >= 1) {
                label = <>Requests <span className="text-green-600 font-semibold">({reqCount})</span></>;
              } else if (isLeads && leadCount >= 1) {
                label = <>Leads <span className="text-green-600 font-semibold">({leadCount})</span></>;
              }
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab
                      ? "border-black text-black"
                      : "border-transparent text-black/40 hover:text-black/70"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <AdminCustomerSearchBlock
        customerSearchQuery={customerSearchQuery}
        setCustomerSearchQuery={setCustomerSearchQuery}
        debouncedCustomerQuery={debouncedCustomerQuery}
        searchOrders={searchOrders}
        setProfilePhone={setProfilePhone}
        onPrefillNewOrder={(phone) => {
          setNewOrderPhoneSeed(phone);
          setActiveTab("New Order");
          setCustomerSearchQuery("");
        }}
      />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <AdminTabPanels
          activeTab={activeTab}
          setProfilePhone={setProfilePhone}
          newOrderPhoneSeed={newOrderPhoneSeed}
          onConsumePhoneSeed={() => setNewOrderPhoneSeed(null)}
        />
      </div>

      <CustomerProfileDrawer
        open={profilePhone !== null}
        onOpenChange={(open) => {
          if (!open) setProfilePhone(null);
        }}
        phone={profilePhone}
        onPrefillNewOrder={(p) => {
          setNewOrderPhoneSeed(p);
          setActiveTab("New Order");
        }}
      />
    </div>
  );
}

/* ===== NEW ORDER TAB ===== */
function NewOrderTab({
  onOpenProfile,
  phoneSeed,
  onConsumePhoneSeed,
}: {
  onOpenProfile: (phone: string) => void;
  phoneSeed: string | null;
  onConsumePhoneSeed: () => void;
}) {
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

  const pendingSeedPrefill = useRef(false);

  useEffect(() => {
    if (phoneSeed) {
      setPhone(phoneSeed);
      setPrefilled(false);
      pendingSeedPrefill.current = true;
      onConsumePhoneSeed();
    }
  }, [phoneSeed, onConsumePhoneSeed]);

  /** After header search selects a customer, auto-fill the form when searchCustomer returns. */
  useEffect(() => {
    if (!pendingSeedPrefill.current) return;
    if (phone.length < 7) return;
    if (searchQuery.isFetching) return;
    if (!searchQuery.isFetched) return;

    pendingSeedPrefill.current = false;

    const d = searchQuery.data;
    if (d == null) return;

    const norm = (p: string) => p.replace(/\D/g, "");
    if (norm(d.phone) !== norm(phone)) return;

    setForm((f) => ({
      ...f,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email || "",
      address: d.address || "",
      unit: d.unit || "",
      specialInstructions: d.specialInstructions || "",
    }));
    setStripeCustomerId(d.stripeCustomerId || null);
    setStripePaymentMethodId(d.stripePaymentMethodId || null);
    setPrefilled(true);
  }, [phone, searchQuery.isFetching, searchQuery.isFetched, searchQuery.data]);

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
        <div className="flex gap-2 flex-wrap">
          <Input
            ref={phoneRef}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setPrefilled(false); }}
            placeholder="(323) 555-1234"
            className="bg-white border-black/20"
          />
          {searchQuery.data && !prefilled && (
            <>
              <Button variant="outline" className="border-black text-black shrink-0" onClick={handlePrefill}>
                <Search className="w-4 h-4 mr-1" /> Prefill
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-black/30 text-black shrink-0"
                onClick={() => onOpenProfile(searchQuery.data!.phone)}
              >
                View profile
              </Button>
            </>
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
function DryCleanReceiptIntakeCard({
  onCreated,
  autoOpen = false,
}: {
  onCreated: (orderId: number) => void;
  autoOpen?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<{ mimeType: "image/jpeg" | "image/png" | "image/webp"; base64: string } | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [matches, setMatches] = useState<ReceiptMatch[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<ReceiptCustomer | null>(null);
  const [summary, setSummary] = useState<{
    dryCleanerRetailTotalCents: number;
    partnerCostCents: number;
    laundryButlerRetailSubtotalCents: number;
    customerTotalCentsAtDraft: number;
    estimatedGrossMarginCents: number;
    warnings: string[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 250);
  const parseReceipt = trpc.admin.dryCleanReceipt.parseReceipt.useMutation();
  const matchReceipt = trpc.admin.dryCleanReceipt.matchReceiptToCatalog.useMutation();
  const createDraft = trpc.admin.dryCleanReceipt.createOrderFromReceipt.useMutation();
  const customerQuery = trpc.admin.searchCustomersForAssignment.useQuery(
    { search: debouncedQuery },
    { enabled: open && debouncedQuery.trim().length >= 2 && !selectedCustomer }
  );
  const catalogQuery = trpc.admin.catalog.list.useQuery({ includeArchived: false }, { enabled: open && !!summary });
  const catalogRows = useMemo(
    () => (catalogQuery.data ?? []).filter((r) => (r.serviceType ?? "dry_clean") === "dry_clean" || r.serviceType === "alteration"),
    [catalogQuery.data]
  );

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  const refreshSummary = useCallback((nextMatches: ReceiptMatch[], dryTotal?: number) => {
    const dryCleanerRetailTotalCents = dryTotal ?? nextMatches.reduce((s, m) => s + (m.dryCleanerRetailLineTotalCents ?? 0), 0);
    const laundryButlerRetailSubtotalCents = nextMatches.reduce((s, m) => s + m.laundryButlerLineTotalCents, 0);
    const partnerCostCents = Math.round(dryCleanerRetailTotalCents * 0.6);
    setSummary({
      dryCleanerRetailTotalCents,
      partnerCostCents,
      laundryButlerRetailSubtotalCents,
      customerTotalCentsAtDraft: laundryButlerRetailSubtotalCents,
      estimatedGrossMarginCents: laundryButlerRetailSubtotalCents - partnerCostCents,
      warnings: nextMatches.map((m) => m.warning).filter((w): w is string => !!w),
    });
  }, []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use a JPEG, PNG, or WebP receipt photo.");
      return;
    }
    setOpen(true);
    setPreviewUrl(URL.createObjectURL(file));
    setParsed(null);
    setMatches([]);
    setSummary(null);
    setSelectedCustomer(null);
    setPhotoData(null);
    const base64 = await fileToBase64(file);
    setPhotoData({ mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64 });
  };

  const runSpeech = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition is not available in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event: any) => setQuery(event.results?.[0]?.[0]?.transcript ?? "");
    recognition.start();
  };

  const selectCustomer = async (customer: ReceiptCustomer) => {
    if (!photoData && !parsed) return;
    setSelectedCustomer(customer);
    setQuery(`${customer.firstName} ${customer.lastName}`);
    const parsedReceipt = parsed ?? await parseReceipt.mutateAsync(photoData!);
    setParsed(parsedReceipt);
    const result = await matchReceipt.mutateAsync({
      receiptIntakeId: parsedReceipt.receiptIntakeId,
      lines: parsedReceipt.lines,
      dryCleanerRetailTotalCents: parsedReceipt.dryCleanerRetailTotalCents,
    });
    setMatches(result.matches);
    setSummary(result);
  };

  const setLineMatch = (idx: number, slug: string) => {
    const item = catalogRows.find((r) => r.slug === slug);
    const next = matches.map((m, i) => i === idx ? {
      ...m,
      matchedCatalogSlug: item?.slug ?? null,
      matchedCatalogName: item?.name ?? null,
      category: item?.category ?? null,
      laundryButlerUnitPriceCents: item?.standardPriceCents ?? null,
      laundryButlerLineTotalCents: item ? item.standardPriceCents * m.qty : 0,
      confidence: item ? 1 : 0,
      warning: item ? null : "No Laundry Butler catalog item selected.",
    } : m);
    setMatches(next);
    refreshSummary(next, summary?.dryCleanerRetailTotalCents ?? parsed?.dryCleanerRetailTotalCents);
  };

  const setLineQty = (idx: number, qty: number) => {
    const next = matches.map((m, i) => {
      if (i !== idx) return m;
      const cleanQty = Math.max(0, Math.round(qty || 0));
      return { ...m, qty: cleanQty, laundryButlerLineTotalCents: (m.laundryButlerUnitPriceCents ?? 0) * cleanQty };
    });
    setMatches(next);
    refreshSummary(next, summary?.dryCleanerRetailTotalCents ?? parsed?.dryCleanerRetailTotalCents);
  };

  const handleCreateDraft = async () => {
    if (!parsed?.receiptIntakeId || !selectedCustomer || !summary) return;
    const res = await createDraft.mutateAsync({
      receiptIntakeId: parsed.receiptIntakeId,
      selectedCustomer,
      reviewedMatches: matches,
      dryCleanerRetailTotalCents: summary.dryCleanerRetailTotalCents,
      partnerCostCents: summary.partnerCostCents,
      laundryButlerRetailSubtotalCents: summary.laundryButlerRetailSubtotalCents,
      customerTotalCentsAtDraft: summary.customerTotalCentsAtDraft,
      receiptNumber: parsed.receiptNumber,
      parseJson: parsed,
      warnings: [...(parsed.warnings ?? []), ...(summary.warnings ?? [])],
    });
    if (res.dryCleaningCostSheet?.ok) {
      toast.success("Intake draft created. Dry-cleaning cost sent to Sheets.");
    } else {
      toast.success("Intake draft created. No card was charged.");
      if (res.dryCleaningCostSheet && !res.dryCleaningCostSheet.ok) {
        toast.error(`Cost sheet write skipped: ${res.dryCleaningCostSheet.reason}`);
      }
    }
    onCreated(res.orderId);
  };

  return (
    <div className="mb-6 border border-black/10 bg-black/[0.02] p-3 sm:p-4">
      <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-md border border-black bg-black px-4 py-4 text-center text-sm font-semibold text-white hover:bg-black/90">
        {parseReceipt.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        Convert dry clean receipt to order intake
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
      </label>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-3">
            {previewUrl ? <img src={previewUrl} alt="Dry-clean receipt preview" className="h-24 w-20 rounded object-cover border border-black/10" /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Who does this belong to?</p>
              <p className="text-xs text-black/50">Pick the Laundry Butler customer before matching catalog prices.</p>
            </div>
            <button type="button" aria-label="Close receipt intake" onClick={() => setOpen(false)} className="rounded p-2 text-black/45 hover:bg-black/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-2">
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedCustomer(null); }} placeholder="Search name, phone, unit, email, building" className="bg-white border-black/20" />
            <Button type="button" variant="outline" className="shrink-0 border-black/20" onClick={runSpeech} title="Speak customer name">
              <Mic className="h-4 w-4" />
            </Button>
          </div>

          {!selectedCustomer && (customerQuery.data?.length ?? 0) > 0 && (
            <div className="divide-y divide-black/5 border border-black/10 bg-white">
              {customerQuery.data!.map((c) => (
                <button key={`${c.phone}-${c.unit ?? ""}`} type="button" onClick={() => void selectCustomer(c)} className="block w-full px-3 py-3 text-left hover:bg-black/[0.03]">
                  <span className="block text-sm font-medium">{c.firstName} {c.lastName}</span>
                  <span className="block text-xs text-black/50">
                    {c.phone} · Unit {c.unit || "—"} · {c.buildingSlug || c.address || "—"}
                    {c.orderId ? ` · Order #${c.orderId}${c.serviceType === "dry_cleaning" ? " dry clean" : ""}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selectedCustomer && (
            <div className="rounded-md border border-black/10 bg-white p-3 text-sm">
              Selected: <strong>{selectedCustomer.firstName} {selectedCustomer.lastName}</strong>
              <span className="text-black/50"> · Unit {selectedCustomer.unit || "—"} · {selectedCustomer.phone}</span>
            </div>
          )}

          {(parseReceipt.isPending || matchReceipt.isPending) && (
            <div className="flex items-center gap-2 text-sm text-black/55"><Loader2 className="h-4 w-4 animate-spin" /> Reading receipt and matching catalog items...</div>
          )}

          {parsed && summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="border border-black/10 bg-white p-3 text-sm">
                  <p>Dry cleaner retail: <strong>{money(summary.dryCleanerRetailTotalCents)}</strong></p>
                  <p>Laundry Butler partner cost: <strong>{money(summary.partnerCostCents)}</strong></p>
                  <p className="mt-1 text-xs text-black/55">Because partner discount is 40%, Laundry Butler pays 60% of dry cleaner retail.</p>
                </div>
                <div className="border border-black/10 bg-white p-3 text-sm">
                  <p>Laundry Butler retail subtotal: <strong>{money(summary.laundryButlerRetailSubtotalCents)}</strong></p>
                  <p>Customer discount: <strong>entered later on intake screen</strong></p>
                  <p>Estimated margin before customer discount: <strong>{money(summary.estimatedGrossMarginCents)}</strong></p>
                </div>
              </div>

              <div className="space-y-3">
                {matches.map((m, idx) => (
                  <div key={`${m.rawLabel}-${idx}`} className="border border-black/10 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{m.rawLabel}</p>
                        <p className="text-xs text-black/50">Dry cleaner line: {money(m.dryCleanerRetailLineTotalCents)} · AI confidence {Math.round(m.confidence * 100)}%</p>
                      </div>
                      <Input type="number" min={0} value={m.qty} onChange={(e) => setLineQty(idx, Number(e.target.value))} className="w-20 border-black/20 bg-white text-sm" />
                    </div>
                    <select value={m.matchedCatalogSlug ?? ""} onChange={(e) => setLineMatch(idx, e.target.value)} className="mt-3 w-full rounded border border-black/20 bg-white px-3 py-2 text-sm">
                      <option value="">Choose Laundry Butler item</option>
                      {catalogRows.map((r) => <option key={r.slug} value={r.slug}>{r.name} · {money(r.standardPriceCents)}</option>)}
                    </select>
                    <p className="mt-2 text-sm">Laundry Butler line total: <strong>{money(m.laundryButlerLineTotalCents)}</strong></p>
                    {m.warning ? <p className="mt-2 text-xs text-amber-700">{m.warning}</p> : null}
                  </div>
                ))}
              </div>

              {[...(parsed.warnings ?? []), ...(summary.warnings ?? [])].length > 0 && (
                <div className="border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {[...(parsed.warnings ?? []), ...(summary.warnings ?? [])].map((w, i) => <p key={`${w}-${i}`}>{w}</p>)}
                </div>
              )}

              <Button className="w-full bg-black text-white hover:bg-black/90" onClick={handleCreateDraft} disabled={!selectedCustomer || createDraft.isPending || matches.every((m) => !m.matchedCatalogSlug)}>
                {createDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create intake draft
              </Button>
              <p className="text-center text-xs text-black/45">No customer discount is applied here, and no card is charged.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IntakeTab({
  initialSelectedOrderId = null,
  quickReceiptOpen = false,
}: {
  initialSelectedOrderId?: number | null;
  quickReceiptOpen?: boolean;
}) {
  const { data: orders, isLoading, refetch } = trpc.admin.listByStatus.useQuery({ status: "collected" });
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedOrderId);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const deleteOrder = trpc.admin.deleteOrder.useMutation();

  useEffect(() => {
    setSelectedId(initialSelectedOrderId);
  }, [initialSelectedOrderId]);

  const handleDelete = async (orderId: number) => {
    await deleteOrder.mutateAsync({ orderId });
    setDeleteConfirm(null);
    refetch();
  };

  if (selectedId) {
    return <IntakeDetail orderId={selectedId} onBack={() => { setSelectedId(null); refetch(); }} />;
  }

  if (isLoading) return <Loader2 className="animate-spin w-6 h-6 text-black/30 mx-auto mt-10" />;
  const receiptCta = (
    <DryCleanReceiptIntakeCard
      autoOpen={quickReceiptOpen}
      onCreated={(orderId) => {
        window.history.pushState(null, "", `/intake?orderId=${orderId}`);
        setSelectedId(orderId);
        void refetch();
      }}
    />
  );
  if (!orders?.length) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Intake</h2>
        {receiptCta}
        <p className="text-black/40 text-center mt-10">No collected orders awaiting intake.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Intake</h2>
      {receiptCta}
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
              <th className="py-2 pr-2 w-10"></th>
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
                <td className="py-3 pr-2 align-middle">
                  {o.paid ? <ResendSheetsButton orderId={o.id} /> : <span className="text-black/20 text-xs">—</span>}
                </td>
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
  const generatePortalToken = trpc.orders.generatePortalToken.useMutation();

  const catalogQuery = trpc.admin.catalog.list.useQuery(
    { includeArchived: false },
    { enabled: !!order && order.serviceType === "dry_cleaning" }
  );
  const catalogRows = useMemo(
    () =>
      (catalogQuery.data ?? [])
        .filter((r) => {
          const st = r.serviceType ?? "dry_clean";
          return st === "dry_clean" || st === "alteration";
        })
        .map((r) => ({
          slug: r.slug,
          name: r.name,
          category: r.category,
          standardPriceCents: r.standardPriceCents,
        })),
    [catalogQuery.data]
  );

  // Wash & fold state
  const [weightLbs, setWeightLbs] = useState("");
  const [bags, setBags] = useState<number[]>([]);
  const [selectedUpcharges, setSelectedUpcharges] = useState<Record<string, boolean>>({});
  const [flatRateQtys, setFlatRateQtys] = useState<Record<string, number>>({});

  // Running weight = saved bags + current valid unsaved input. Single source of truth
  // fed into existing W&F pricing + saveIntake so multi-bag intake doesn't touch schema.
  const currentInputWeight = (() => {
    const n = parseFloat(weightLbs);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const effectiveWeightLbs = bags.reduce((s, b) => s + b, 0) + currentInputWeight;

  // Dry cleaning state
  const [dcQtys, setDcQtys] = useState<Record<string, number>>({});

  // Shared
  const [discountPercent, setDiscountPercent] = useState("0");
  const [chargeResult, setChargeResult] = useState<{
    success: boolean;
    error?: string;
    isFirstPaidOrder?: boolean;
    receiptUrl?: string;
    portalWelcomeUrl?: string;
  } | null>(null);

  const hydratedOrderId = useRef<number | null>(null);
  useEffect(() => {
    if (!order || order.serviceType !== "dry_cleaning") return;
    if (hydratedOrderId.current === order.id) return;
    hydratedOrderId.current = order.id;
    const raw = order.drycleanItemsJson;
    if (!raw || typeof raw !== "object") return;
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, DryCleanEntry>)) {
      if (v && typeof v.qty === "number" && v.qty > 0) next[k] = v.qty;
    }
    setDcQtys(next);
  }, [order]);

  const isWF = order?.serviceType === "wash_fold";

  // Calculate totals
  const totals = useMemo(() => {
    if (!order) return { subtotalCents: 0, totalCents: 0 };
    const disc = parseFloat(discountPercent) || 0;

    // Calculate W&F section
    const w = effectiveWeightLbs;
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

    // Calculate DC section (catalog + legacy JSON for unknown slugs)
    const items = buildDrycleanLineItems(
      catalogRows,
      dcQtys,
      order.drycleanItemsJson as Record<string, DryCleanEntry> | null | undefined
    );
    const dcTotal = calcDryCleanTotal(items, disc);

    // Only the order's service type counts (avoid W&F $45 minimum on dry-cleaning-only orders)
    if (order.serviceType === "dry_cleaning") {
      return {
        subtotalCents: dcTotal.subtotalCents,
        totalCents: dcTotal.totalCents,
      };
    }
    return {
      subtotalCents: wfTotal.subtotalCents,
      totalCents: wfTotal.totalCents,
    };
  }, [order, effectiveWeightLbs, selectedUpcharges, flatRateQtys, dcQtys, discountPercent, catalogRows]);

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

    const drycleanItemsJson = buildDrycleanLineItems(
      catalogRows,
      dcQtys,
      order.drycleanItemsJson as Record<string, DryCleanEntry> | null | undefined
    );

    // Save intake data first
    await saveIntake.mutateAsync({
      orderId: order.id,
      weightLbs: isWF ? effectiveWeightLbs : undefined,
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
    if (!result.success) {
      setChargeResult(result);
      return;
    }

    let portalWelcomeUrl: string | undefined;
    if (result.isFirstPaidOrder) {
      try {
        const { token } = await generatePortalToken.mutateAsync({ orderId: order.id });
        const welcome = new URL("/welcome", `${getResidentWebOrigin()}/`);
        welcome.searchParams.set("token", token);
        portalWelcomeUrl = welcome.toString();
      } catch (err) {
        console.error("Failed to generate portal welcome link:", err);
        toast.error(
          "Charged successfully, but the portal enrollment link could not be created. Use the receipt link below."
        );
      }
    }

    setChargeResult({
      success: true,
      isFirstPaidOrder: result.isFirstPaidOrder,
      receiptUrl: result.receiptUrl,
      portalWelcomeUrl,
    });
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

          <a
            href={`/receipt/${order.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center justify-center rounded-md border border-black bg-white px-4 py-2 text-sm font-medium text-black hover:bg-black/5 w-full max-w-xs"
          >
            View digital receipt (open to screenshot)
          </a>

          {chargeResult.receiptUrl ? (
            <div className="mt-6 p-4 border border-black/20 text-left w-full max-w-md mx-auto">
              <p className="text-xs font-medium text-black/50 uppercase tracking-wider mb-2">Customer receipt (app)</p>
              <p className="text-sm text-black/60 mb-3">Copy this link to text or email — it opens their receipt in one tap.</p>
              <CopyButton text={chargeResult.receiptUrl} />
            </div>
          ) : null}

          {chargeResult.isFirstPaidOrder && chargeResult.portalWelcomeUrl ? (
            <div className="mt-6 p-4 border border-black/20 text-left w-full max-w-md mx-auto">
              <p className="text-xs font-medium text-black/50 uppercase tracking-wider mb-2">Portal enrollment</p>
              <p className="text-sm text-black/60 mb-3">First paid order. Copy the link below and send to the customer.</p>
              <CopyButton text={chargeResult.portalWelcomeUrl} />
            </div>
          ) : null}
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
        <div>
          <h2 className="text-lg font-semibold">
            Order #{order.id} — {order.firstName} {order.lastName}
          </h2>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-black/45">
            {isWF ? "Service: Wash & fold" : "Service: Dry cleaning"}
          </p>
        </div>
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

      {isWF ? (
        <>
          <div className="mb-4 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2.5 text-xs text-black/70">
            <strong className="text-black">Catalog SKUs</strong> (dress shirts, alterations, etc.)
            only appear on intake for orders created as <strong>Dry cleaning</strong>. This job is{" "}
            <strong>Wash &amp; fold</strong> — use weight and flat-rate items below. To charge catalog
            items, create a new order with service <strong>Dry cleaning</strong>.
          </div>
          <WashFoldIntake
            weightLbs={weightLbs}
            setWeightLbs={setWeightLbs}
            bags={bags}
            setBags={setBags}
            effectiveWeightLbs={effectiveWeightLbs}
            selectedUpcharges={selectedUpcharges}
            setSelectedUpcharges={setSelectedUpcharges}
            flatRateQtys={flatRateQtys}
            setFlatRateQtys={setFlatRateQtys}
          />
        </>
      ) : catalogQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-black/30" />
        </div>
      ) : catalogRows.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No dry-clean SKUs for this tenant. Run{" "}
          <code className="rounded bg-white/80 px-1">pnpm seed:catalog</code> or add items in{" "}
          <a href="/catalog" className="font-medium underline">
            Catalog
          </a>
          .
        </div>
      ) : (
        <DryCleanIntake dcQtys={dcQtys} setDcQtys={setDcQtys} catalogRows={catalogRows} />
      )}

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
function formatBagWeight(n: number): string {
  return `${n}lb`;
}

function WashFoldIntake({
  weightLbs, setWeightLbs, bags, setBags, effectiveWeightLbs,
  selectedUpcharges, setSelectedUpcharges, flatRateQtys, setFlatRateQtys,
}: {
  weightLbs: string;
  setWeightLbs: (v: string) => void;
  bags: number[];
  setBags: (v: number[]) => void;
  effectiveWeightLbs: number;
  selectedUpcharges: Record<string, boolean>;
  setSelectedUpcharges: (v: Record<string, boolean>) => void;
  flatRateQtys: Record<string, number>;
  setFlatRateQtys: (v: Record<string, number>) => void;
}) {
  const weightInputRef = useRef<HTMLInputElement>(null);

  const addBag = () => {
    const n = parseFloat(weightLbs);
    if (!Number.isFinite(n) || n <= 0) return;
    setBags([...bags, n]);
    setWeightLbs("");
    weightInputRef.current?.focus();
  };

  const removeBag = (idx: number) => {
    setBags(bags.filter((_, i) => i !== idx));
  };

  return (
    <>
      <div className="mb-6">
        <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">Weight (lbs)</label>
        <div className="flex items-center gap-2">
          <Input
            ref={weightInputRef}
            type="number"
            step="0.1"
            value={weightLbs}
            onChange={(e) => setWeightLbs(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBag();
              }
            }}
            placeholder="0.0"
            className="w-40 bg-white border-black/20"
          />
          <Button
            type="button"
            variant="outline"
            onClick={addBag}
            className="border-black text-black h-9 px-3 text-sm"
          >
            Next Bag
          </Button>
        </div>
        {bags.length > 0 && (
          <ul className="mt-2 space-y-1">
            {bags.map((b, i) => (
              <li
                key={`${i}-${b}`}
                className="flex items-center justify-between w-40 text-sm text-black/80 border border-black/10 px-2 py-1"
              >
                <span>{formatBagWeight(b)}</span>
                <button
                  type="button"
                  onClick={() => removeBag(i)}
                  aria-label={`Remove bag ${i + 1}`}
                  className="text-black/40 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {effectiveWeightLbs > 0 && (
          <p className="text-xs text-black/40 mt-1">
            Base: {effectiveWeightLbs} lbs × $2.50 = ${centsToDollars(Math.round(effectiveWeightLbs * WF_RATE_PER_LB_CENTS))}
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
  dcQtys,
  setDcQtys,
  catalogRows,
}: {
  dcQtys: Record<string, number>;
  setDcQtys: (v: Record<string, number>) => void;
  catalogRows: Array<{ slug: string; name: string; category: string; standardPriceCents: number }>;
}) {
  const categories = useMemo(() => {
    const cats: Record<string, typeof catalogRows> = {};
    catalogRows.forEach((item) => {
      if (!cats[item.category]) cats[item.category] = [];
      cats[item.category].push(item);
    });
    return cats;
  }, [catalogRows]);

  return (
    <div className="space-y-6">
      {Object.entries(categories).map(([cat, items]) => (
        <div key={cat}>
          <h3 className="text-xs font-medium text-black/50 uppercase tracking-wider mb-2">{cat}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {items.map((item) => {
              const qty = dcQtys[item.slug] || 0;
              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => setDcQtys({ ...dcQtys, [item.slug]: qty + 1 })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (qty > 0) setDcQtys({ ...dcQtys, [item.slug]: qty - 1 });
                  }}
                  className={`relative p-2 border text-left text-xs transition-colors ${
                    qty > 0
                      ? "bg-black text-white border-black"
                      : "bg-white text-black border-black/15 hover:border-black/30"
                  }`}
                >
                  <span className="block">{item.name}</span>
                  <span className="block text-[10px] opacity-60">${centsToDollars(item.standardPriceCents)}</span>
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
              <th className="py-2 pr-2">Receipt</th>
              <th className="py-2 pr-2 w-10"></th>
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
                <td className="py-3 pr-2">
                  {o.paid ? (
                    <a
                      href={`/receipt/${o.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 underline whitespace-nowrap"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-black/30 text-xs">—</span>
                  )}
                </td>
                <td className="py-3 pr-2 align-middle">
                  {o.paid ? <ResendSheetsButton orderId={o.id} /> : <span className="text-black/20 text-xs">—</span>}
                </td>
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
              <th className="py-2 pr-2 w-10"></th>
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
                <td className="py-3 pr-2 align-middle">
                  {o.paid ? <ResendSheetsButton orderId={o.id} /> : <span className="text-black/20 text-xs">—</span>}
                </td>
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
              <StopCard
                key={o.id}
                order={o}
                action="Mark Collected"
                onAction={() => handleCollect(o.id)}
                isPending={updateStatus.isPending}
                showSheetsResend
              />
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
              <StopCard
                key={o.id}
                order={o}
                action="Mark Delivered"
                onAction={() => handleDeliver(o.id)}
                isPending={updateStatus.isPending}
                showBags
                showSheetsResend
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== REQUESTS TAB (coordinated requests from resident app) ===== */
function RequestsTab() {
  const utils = trpc.useUtils();
  const { data: requests, refetch } = trpc.admin.listCoordinatedRequests.useQuery();
  const updateStatus = trpc.admin.updateRequestStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        refetch(),
        utils.admin.countNewCoordinatedRequests.invalidate(),
      ]);
    },
  });

  const handleStatus = (requestId: number, status: string) => {
    updateStatus.mutateAsync({ requestId, status });
  };

  if (requests === undefined) {
    return (
      <div className="flex items-center gap-2 text-black/50">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading requests…</span>
      </div>
    );
  }

  if (!requests.length) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Requests</h2>
        <p className="text-sm text-black/50">No coordinated requests. Requests from the resident app (car-wash, grooming, other) will appear here.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Requests</h2>
      <p className="text-xs text-black/50 mb-4">Coordinated requests from bldg.chat (car-wash, grooming, other).</p>
      <div className="space-y-4">
        {requests.map((req) => (
          <RequestCard
            key={req.id}
            request={req}
            onStatus={handleStatus}
            isPending={updateStatus.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  onStatus,
  isPending,
}: {
  request: {
    id: number;
    serviceType: string | null;
    status: string | null;
    requestSummary: string | null;
    createdAt: Date | null;
    resident: {
      firstName: string | null;
      lastName: string | null;
      phoneE164: string | null;
      phone: string | null;
      buildingSlug: string | null;
      unit: string | null;
    } | null;
  };
  onStatus: (id: number, status: string) => void;
  isPending: boolean;
}) {
  const created = request.createdAt
    ? new Date(request.createdAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
    : "—";
  const residentName = request.resident
    ? [request.resident.firstName, request.resident.lastName].filter(Boolean).join(" ").trim() || "—"
    : "—";
  const building = request.resident?.buildingSlug ?? "—";
  const unit = request.resident?.unit ?? "—";
  const summary = request.requestSummary ?? "—";
  const rawPhone = request.resident?.phoneE164 || request.resident?.phone || "";
  const phone = rawPhone.replace(/[^\d+]/g, "") || "";
  const smsHref = phone ? `sms:${phone.startsWith("+") ? phone : "+1" + phone}` : null;

  return (
    <div className="border border-black/10 rounded-lg p-4 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-xs font-medium uppercase tracking-wider text-black/60">{request.serviceType ?? "—"}</span>
          <p className="font-medium text-sm mt-0.5">{residentName}</p>
          <p className="text-xs text-black/50">Unit {unit} · {building}</p>
        </div>
        <span className="text-xs text-black/40">{created}</span>
      </div>
      <p className="text-sm text-black/70 mb-3">{summary}</p>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-black/50">Status: {request.status ?? "new"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {smsHref ? (
          <a
            href={smsHref}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs border border-black/20 rounded hover:bg-black/5"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Text resident
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1.5 text-xs border border-black/10 rounded text-black/40">
            <MessageSquare className="w-3.5 h-3.5" />
            Text resident (no phone)
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-xs border-black/20"
          disabled
          title="Vendor phone not yet configured for these request types"
        >
          <Phone className="w-3.5 h-3.5 mr-1" />
          Call vendor
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs border-black/20"
          onClick={() => onStatus(request.id, "contacting-vendor")}
          disabled={isPending}
        >
          Contacting vendor
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs border-black/20"
          onClick={() => onStatus(request.id, "awaiting-vendor")}
          disabled={isPending}
        >
          Awaiting vendor confirmation
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs border-green-600 text-green-600 hover:bg-green-50"
          onClick={() => onStatus(request.id, "scheduled")}
          disabled={isPending}
        >
          Mark scheduled
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs border-black/20"
          onClick={() => onStatus(request.id, "closed")}
          disabled={isPending}
        >
          Close request
        </Button>
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
  showSheetsResend,
}: {
  order: Order;
  action: string;
  onAction: () => void;
  isPending: boolean;
  showBags?: boolean;
  /** Admin Pickups tab: show 📊 resend when order is paid */
  showSheetsResend?: boolean;
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

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-black text-black text-xs w-full sm:w-auto"
          onClick={onAction}
          disabled={isPending}
        >
          {action}
        </Button>
        {showSheetsResend && order.paid ? <ResendSheetsButton orderId={order.id} /> : null}
      </div>
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

/* ===== LEADS TAB ===== */
function LeadsTab() {
  const utils = trpc.useUtils();
  const { data: leads, isLoading, refetch } = trpc.admin.listLeads.useQuery();
  const updateStatus = trpc.admin.updateLeadStatus.useMutation({
    onSuccess: () => {
      refetch();
      utils.admin.countUnreadLeads.invalidate();
    },
  });
  const markAsRead = trpc.admin.markLeadAsRead.useMutation({
    onSuccess: () => {
      refetch();
      utils.admin.countUnreadLeads.invalidate();
    },
  });
  const markAsUnread = trpc.admin.markLeadAsUnread.useMutation({
    onSuccess: () => {
      refetch();
      utils.admin.countUnreadLeads.invalidate();
    },
  });
  const updateNotes = trpc.admin.updateLeadNotes.useMutation({
    onSuccess: () => refetch(),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingNotes, setEditingNotes] = useState<string>("");

  const selectedLead = selectedId ? leads?.find((l) => l.id === selectedId) : null;

  const handleOpenLead = (lead: typeof leads extends (infer T)[] | undefined ? T : never) => {
    setSelectedId(lead.id);
    setEditingNotes(lead.notes || "");
    if (!lead.isRead) {
      markAsRead.mutate({ leadId: lead.id });
    }
  };

  const handleStatusChange = (leadId: number, status: "New" | "Contacted" | "Qualified" | "Closed" | "Spam") => {
    updateStatus.mutate({ leadId, status });
  };

  const handleSaveNotes = () => {
    if (selectedId) {
      updateNotes.mutate({ leadId: selectedId, notes: editingNotes || null });
    }
  };

  const formatTimestamp = (date: Date | string | null) => {
    if (!date) return "—";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const statusColors: Record<string, string> = {
    New: "bg-green-100 text-green-700",
    Contacted: "bg-blue-100 text-blue-700",
    Qualified: "bg-purple-100 text-purple-700",
    Closed: "bg-black/10 text-black/60",
    Spam: "bg-red-100 text-red-700",
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-black/50">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading leads…</span>
      </div>
    );
  }

  if (selectedLead) {
    return (
      <div className="max-w-2xl">
        <button
          onClick={() => setSelectedId(null)}
          className="text-sm text-black/50 hover:text-black mb-4 flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" /> Back to Leads
        </button>

        <div className="border border-black/10 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{selectedLead.name}</h2>
              <p className="text-sm text-black/50">{selectedLead.email}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${statusColors[selectedLead.status] || "bg-black/10"}`}>
              {selectedLead.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Building</p>
              <p>{selectedLead.buildingName}</p>
            </div>
            <div>
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Role</p>
              <p>{selectedLead.role || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Units</p>
              <p>{selectedLead.numberOfUnits || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Phone</p>
              <p>{selectedLead.phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Source</p>
              <p>{selectedLead.source || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Source URL</p>
              <p className="truncate text-xs">{selectedLead.sourceUrl || "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-black/50 uppercase tracking-wider mb-1">Submitted</p>
              <p>{formatTimestamp(selectedLead.submittedAt)}</p>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-xs text-black/50 uppercase tracking-wider mb-2">Notes</label>
            <textarea
              value={editingNotes}
              onChange={(e) => setEditingNotes(e.target.value)}
              placeholder="Add internal notes..."
              className="w-full border border-black/20 px-3 py-2 text-sm bg-white resize-none"
              rows={3}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs border-black/20"
              onClick={handleSaveNotes}
              disabled={updateNotes.isPending}
            >
              {updateNotes.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Save Notes
            </Button>
          </div>

          <div className="border-t border-black/10 pt-4">
            <p className="text-xs text-black/50 uppercase tracking-wider mb-3">Actions</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-blue-500 text-blue-600 hover:bg-blue-50"
                onClick={() => handleStatusChange(selectedLead.id, "Contacted")}
                disabled={updateStatus.isPending}
              >
                Mark Contacted
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-purple-500 text-purple-600 hover:bg-purple-50"
                onClick={() => handleStatusChange(selectedLead.id, "Qualified")}
                disabled={updateStatus.isPending}
              >
                Mark Qualified
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-black/20"
                onClick={() => handleStatusChange(selectedLead.id, "Closed")}
                disabled={updateStatus.isPending}
              >
                Mark Closed
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => handleStatusChange(selectedLead.id, "Spam")}
                disabled={updateStatus.isPending}
              >
                Mark Spam
              </Button>
              {selectedLead.isRead ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-black/20"
                  onClick={() => markAsUnread.mutate({ leadId: selectedLead.id })}
                  disabled={markAsUnread.isPending}
                >
                  Mark Unread
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!leads?.length) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Leads</h2>
        <p className="text-sm text-black/50">No leads yet. Submissions from the "Add Your Building" form will appear here.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Leads</h2>
      <p className="text-xs text-black/50 mb-4">Building onboarding submissions from contact.bldg.chat</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/50 uppercase tracking-wider">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Building</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Units</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Submitted</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={`border-b border-black/5 hover:bg-black/[0.02] cursor-pointer ${!lead.isRead ? "bg-green-50/50" : ""}`}
                onClick={() => handleOpenLead(lead)}
              >
                <td className="py-3 pr-4 font-medium">
                  {!lead.isRead && <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2" />}
                  {lead.name}
                </td>
                <td className="py-3 pr-4">{lead.buildingName}</td>
                <td className="py-3 pr-4">{lead.role || "—"}</td>
                <td className="py-3 pr-4 max-w-[200px] truncate">{lead.email}</td>
                <td className="py-3 pr-4">{lead.numberOfUnits || "—"}</td>
                <td className="py-3 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[lead.status] || "bg-black/10"}`}>
                    {lead.status}
                  </span>
                </td>
                <td className="py-3 pr-4 text-black/50 text-xs">
                  {lead.submittedAt ? new Date(lead.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </td>
                <td className="py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-black text-black text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenLead(lead);
                    }}
                  >
                    Open
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

export function AdminCustomerSearchBlock({
  customerSearchQuery,
  setCustomerSearchQuery,
  debouncedCustomerQuery,
  searchOrders,
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
    data?: {
      id: number;
      firstName: string;
      lastName: string;
      phone: string;
      total: string | null;
      serviceType: string;
    }[];
  };
}) {
  return (
    <div className="border-b border-black/10 bg-white">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3">
        <div className="relative max-w-md">
          <input
            type="text"
            placeholder="Customer"
            value={customerSearchQuery}
            onChange={(e) => setCustomerSearchQuery(e.target.value)}
            className="w-full rounded-md border border-black/15 bg-neutral-100/80 px-3 py-2.5 text-sm text-black placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black/30"
          />
          {debouncedCustomerQuery.length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-auto rounded-md border border-black/15 bg-white shadow-lg">
              {searchOrders.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-black/30" />
                </div>
              ) : searchOrders.data?.length ? (
                <ul className="py-1">
                  {searchOrders.data.map((o) => (
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
                          {o.total ? `$${o.total}` : "—"} · {o.serviceType === "wash_fold" ? "W&F" : "DC"}
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
                <p className="px-3 py-4 text-sm text-black/50">No orders found.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminTabPanels({
  activeTab,
  setProfilePhone,
  newOrderPhoneSeed,
  onConsumePhoneSeed,
  initialSelectedOrderId,
  quickReceiptOpen,
}: {
  activeTab: Tab;
  setProfilePhone: (p: string) => void;
  newOrderPhoneSeed: string | null;
  onConsumePhoneSeed: () => void;
  initialSelectedOrderId?: number | null;
  quickReceiptOpen?: boolean;
}) {
  return (
    <>
      {activeTab === "New Order" && (
        <NewOrderTab
          onOpenProfile={(p) => setProfilePhone(p)}
          phoneSeed={newOrderPhoneSeed}
          onConsumePhoneSeed={onConsumePhoneSeed}
        />
      )}
      {activeTab === "Customers" && <CustomersTab onOpenProfile={(p) => setProfilePhone(p)} />}
      {activeTab === "Intake" && (
        <IntakeTab
          initialSelectedOrderId={initialSelectedOrderId}
          quickReceiptOpen={quickReceiptOpen}
        />
      )}
      {activeTab === "Processing" && <ProcessingTab />}
      {activeTab === "Ready" && <ReadyTab />}
      {activeTab === "Pickups" && <PickupsTab />}
      {activeTab === "Requests" && <RequestsTab />}
      {activeTab === "Leads" && <LeadsTab />}
      {activeTab === "Vendors" && <VendorsTab />}
    </>
  );
}
