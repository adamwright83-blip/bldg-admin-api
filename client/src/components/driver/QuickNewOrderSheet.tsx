import React from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CheckCircle2, ChevronDown, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useDebounce } from "@/hooks/useDebounce";
import { matchBuilding } from "@shared/buildings";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

type QuickOrderServiceType = "wash_fold" | "dry_cleaning";

type CustomerOption = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  address: string;
  unit: string | null;
  buildingSlug: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderCreated?: () => Promise<void> | void;
};

const PICKUP_WINDOWS = [
  "7:00am-9:00am",
  "9:00am-11:00am",
  "11:00am-1:00pm",
  "7:00pm-9:00pm",
];

function localDate(offset = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveBuildingSlug(
  selectedBuildingSlug: string | null | undefined,
  address: string
): string {
  const normalized = (selectedBuildingSlug || "").trim().toLowerCase();
  if (normalized && normalized !== "unknown" && normalized !== "unassigned") {
    return normalized;
  }
  const matched = matchBuilding(address);
  return matched?.slug || "unknown";
}

function formatCustomerName(customer: CustomerOption): string {
  const full = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
  return full || "Resident";
}

export function QuickNewOrderSheet({ open, onOpenChange, onOrderCreated }: Props) {
  const [isMounted, setIsMounted] = React.useState(false);
  const [customerQuery, setCustomerQuery] = React.useState("");
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerOption | null>(null);

  const [serviceType, setServiceType] = React.useState<QuickOrderServiceType>("wash_fold");
  const [pickupDate, setPickupDate] = React.useState(localDate(0));
  const [pickupTimeWindow, setPickupTimeWindow] = React.useState(PICKUP_WINDOWS[1]);

  const [address, setAddress] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [deliveryDate, setDeliveryDate] = React.useState("");
  const [deliveryTimeWindow, setDeliveryTimeWindow] = React.useState("");

  const [bags, setBags] = React.useState("");
  const [pieces, setPieces] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [showOptional, setShowOptional] = React.useState(false);

  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const serviceButtonRef = React.useRef<HTMLButtonElement>(null);

  const debouncedCustomerQuery = useDebounce(customerQuery, 140);

  const customersQuery = trpc.admin.listCustomers.useQuery(
    {
      search: debouncedCustomerQuery || undefined,
      sortBy: "lastOrder",
    },
    {
      enabled: open && !selectedCustomer && debouncedCustomerQuery.trim().length >= 1,
    }
  );

  const selectedCustomerProfile = trpc.admin.searchCustomer.useQuery(
    { phone: selectedCustomer?.phone || "" },
    {
      enabled: open && Boolean(selectedCustomer?.phone),
    }
  );

  const createOrder = trpc.admin.createOrder.useMutation();

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  const resetState = React.useCallback(() => {
    setCustomerQuery("");
    setSelectedCustomer(null);
    setServiceType("wash_fold");
    setPickupDate(localDate(0));
    setPickupTimeWindow(PICKUP_WINDOWS[1]);
    setAddress("");
    setUnit("");
    setDeliveryDate("");
    setDeliveryTimeWindow("");
    setBags("");
    setPieces("");
    setNotes("");
    setShowOptional(false);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    resetState();
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, resetState]);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const customerMatches = React.useMemo(() => {
    const rows = (customersQuery.data?.customers ?? []) as CustomerOption[];
    return rows.slice(0, 5);
  }, [customersQuery.data?.customers]);

  const canSubmit =
    Boolean(selectedCustomer) &&
    pickupDate.trim().length > 0 &&
    pickupTimeWindow.trim().length > 0 &&
    address.trim().length > 0 &&
    !createOrder.isPending;

  const handlePickCustomer = (customer: CustomerOption) => {
    sounds.press();
    haptics.tap();
    setSelectedCustomer(customer);
    setCustomerQuery(formatCustomerName(customer));
    setAddress(customer.address || "");
    setUnit(customer.unit || "");
    window.setTimeout(() => serviceButtonRef.current?.focus(), 40);
  };

  const handleChangeCustomer = () => {
    sounds.press();
    haptics.tap();
    setSelectedCustomer(null);
    setCustomerQuery("");
    setAddress("");
    setUnit("");
    window.setTimeout(() => searchInputRef.current?.focus(), 40);
  };

  const close = () => {
    if (createOrder.isPending) return;
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!selectedCustomer) return;

    const phone = (selectedCustomer.phone || "").trim();
    if (!phone) {
      toast.error("Selected customer has no phone number.");
      return;
    }

    const firstName =
      (selectedCustomer.firstName || "").trim() ||
      (selectedCustomer.lastName || "").trim() ||
      "Resident";
    const lastName = (selectedCustomer.lastName || "").trim() || "Resident";
    const email =
      selectedCustomerProfile.data?.email || selectedCustomer.email || undefined;
    const finalAddress = address.trim();
    const finalBuildingSlug = resolveBuildingSlug(
      selectedCustomer.buildingSlug,
      finalAddress
    );

    const quickMeta: string[] = [];
    if (bags.trim()) quickMeta.push(`Bags: ${bags.trim()}`);
    if (pieces.trim()) quickMeta.push(`Pieces: ${pieces.trim()}`);

    const instructionBlocks = [notes.trim()];
    if (quickMeta.length > 0) {
      instructionBlocks.push(`Driver quick capture - ${quickMeta.join(" | ")}`);
    }
    const specialInstructions = instructionBlocks.filter(Boolean).join("\n");

    try {
      await createOrder.mutateAsync({
        serviceType,
        pickupDate,
        pickupTimeWindow,
        deliveryDate: deliveryDate || undefined,
        deliveryTimeWindow: deliveryTimeWindow || undefined,
        address: finalAddress,
        unit: unit.trim() || undefined,
        specialInstructions: specialInstructions || undefined,
        firstName,
        lastName,
        phone,
        email,
        stripeCustomerId:
          selectedCustomerProfile.data?.stripeCustomerId || undefined,
        stripePaymentMethodId:
          selectedCustomerProfile.data?.stripePaymentMethodId || undefined,
        buildingSlug: finalBuildingSlug,
      });

      toast.success("Order created");
      haptics.impact();
      sounds.collect();
      await onOrderCreated?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Quick order create failed", error);
      haptics.error();
      toast.error("Could not create order. Please retry.");
    }
  };

  if (!open || !isMounted) return null;

  return createPortal(
    <div className="driver-game fixed inset-0 z-[120]">
      <button
        type="button"
        aria-label="Close quick order sheet"
        className="absolute inset-0 bg-black/70"
        onClick={close}
      />

      <section
        aria-modal="true"
        role="dialog"
        aria-label="Create new order"
        className="absolute inset-0 bg-void text-foreground flex flex-col"
      >
        <header className="px-4 pt-4 pb-3 border-b border-border/40 bg-void-light/85 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] tracking-[0.3em] uppercase text-neon/60">
                Quick Capture
              </p>
              <h2 className="font-display text-2xl uppercase tracking-[0.08em] text-foreground">
                Create New Order
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              className="h-10 w-10 border border-border/50 bg-void-light/60 flex items-center justify-center text-muted-foreground hover:text-neon transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 max-w-[320px]">
            Capture now in seconds. Full intake can happen later in admin.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-28">
          <div className="mt-4">
            <label
              htmlFor="quick-order-customer"
              className="block text-[10px] tracking-[0.24em] uppercase text-neon/70 mb-2 font-semibold"
            >
              Customer
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="quick-order-customer"
                ref={searchInputRef}
                type="text"
                autoComplete="off"
                readOnly={Boolean(selectedCustomer)}
                value={customerQuery}
                onChange={(event) => {
                  if (selectedCustomer) return;
                  setCustomerQuery(event.target.value);
                }}
                placeholder="Type customer name"
                className="w-full h-12 pl-10 pr-3 border border-border/50 bg-void-light/40 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-neon/60"
              />
            </div>
          </div>

          {!selectedCustomer ? (
            <div className="mt-3">
              {debouncedCustomerQuery.trim().length < 1 ? (
                <p className="text-[12px] text-muted-foreground border border-border/30 bg-void-light/30 px-3 py-3">
                  Start typing a customer name to find a match.
                </p>
              ) : customersQuery.isLoading ? (
                <div className="border border-border/30 bg-void-light/30 px-3 py-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching customers...
                </div>
              ) : customerMatches.length === 0 ? (
                <p className="text-[12px] text-muted-foreground border border-border/30 bg-void-light/30 px-3 py-3">
                  No match found. Keep typing or create customer in admin first.
                </p>
              ) : (
                <div className="space-y-2">
                  {customerMatches.map((customer) => (
                    <button
                      key={customer.phone}
                      type="button"
                      onClick={() => handlePickCustomer(customer)}
                      className="w-full text-left border border-border/35 bg-void-light/40 hover:border-neon/50 px-3 py-3 transition-colors"
                    >
                      <p className="font-display text-[15px] uppercase tracking-[0.08em] text-foreground">
                        {formatCustomerName(customer)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {customer.phone}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {customer.address || "No saved address"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mt-3 border border-neon/25 bg-neon/[0.06] px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-[15px] uppercase tracking-[0.08em] text-foreground">
                      {formatCustomerName(selectedCustomer)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {selectedCustomer.phone}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleChangeCustomer}
                    className="text-[11px] uppercase tracking-[0.2em] text-neon/80 hover:text-neon transition-colors"
                  >
                    Change
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-[10px] tracking-[0.24em] uppercase text-neon/70 mb-2 font-semibold">
                  Order Type
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    ref={serviceButtonRef}
                    type="button"
                    onClick={() => setServiceType("wash_fold")}
                    className={`h-12 px-3 text-[13px] font-semibold uppercase tracking-[0.1em] border transition-colors ${
                      serviceType === "wash_fold"
                        ? "border-neon/65 bg-neon/[0.16] text-neon"
                        : "border-border/45 bg-void-light/35 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Wash & Fold
                  </button>
                  <button
                    type="button"
                    onClick={() => setServiceType("dry_cleaning")}
                    className={`h-12 px-3 text-[13px] font-semibold uppercase tracking-[0.1em] border transition-colors ${
                      serviceType === "dry_cleaning"
                        ? "border-neon/65 bg-neon/[0.16] text-neon"
                        : "border-border/45 bg-void-light/35 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Dry Cleaning
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-[10px] tracking-[0.24em] uppercase text-neon/70 mb-2 font-semibold">
                  Pickup Date
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPickupDate(localDate(0))}
                    className={`h-11 border text-[12px] font-semibold uppercase tracking-[0.1em] ${
                      pickupDate === localDate(0)
                        ? "border-neon/65 bg-neon/[0.16] text-neon"
                        : "border-border/45 bg-void-light/35 text-muted-foreground"
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickupDate(localDate(1))}
                    className={`h-11 border text-[12px] font-semibold uppercase tracking-[0.1em] ${
                      pickupDate === localDate(1)
                        ? "border-neon/65 bg-neon/[0.16] text-neon"
                        : "border-border/45 bg-void-light/35 text-muted-foreground"
                    }`}
                  >
                    Tomorrow
                  </button>
                  <label className="h-11 border border-border/45 bg-void-light/35 px-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                    <CalendarDays className="w-3.5 h-3.5" />
                    <input
                      type="date"
                      value={pickupDate}
                      onChange={(event) => setPickupDate(event.target.value)}
                      className="w-full bg-transparent text-foreground outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[10px] tracking-[0.24em] uppercase text-neon/70 mb-2 font-semibold">
                  Pickup Window
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PICKUP_WINDOWS.map((window) => (
                    <button
                      key={window}
                      type="button"
                      onClick={() => setPickupTimeWindow(window)}
                      className={`h-11 px-2 border text-[12px] font-semibold ${
                        pickupTimeWindow === window
                          ? "border-neon/65 bg-neon/[0.16] text-neon"
                          : "border-border/45 bg-void-light/35 text-muted-foreground"
                      }`}
                    >
                      {window}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-[10px] tracking-[0.24em] uppercase text-neon/70 mb-2 font-semibold">
                  Pickup Address
                </label>
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Street address"
                  className="w-full h-12 px-3 border border-border/50 bg-void-light/40 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-neon/60"
                />
                <input
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder="Unit (optional)"
                  className="mt-2 w-full h-11 px-3 border border-border/50 bg-void-light/30 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-neon/60"
                />
              </div>

              <div className="mt-4 border border-border/35 bg-void-light/25">
                <button
                  type="button"
                  onClick={() => setShowOptional((prev) => !prev)}
                  className="w-full h-11 px-3 flex items-center justify-between text-[12px] uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Optional Details
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      showOptional ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showOptional ? (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={bags}
                        onChange={(event) => setBags(event.target.value.replace(/[^\d]/g, ""))}
                        inputMode="numeric"
                        placeholder="Bags"
                        className="h-11 px-3 border border-border/45 bg-void-light/35 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-neon/60"
                      />
                      <input
                        value={pieces}
                        onChange={(event) => setPieces(event.target.value.replace(/[^\d]/g, ""))}
                        inputMode="numeric"
                        placeholder="Pieces"
                        className="h-11 px-3 border border-border/45 bg-void-light/35 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-neon/60"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={(event) => setDeliveryDate(event.target.value)}
                        className="h-11 px-3 border border-border/45 bg-void-light/35 text-[13px] text-foreground focus:outline-none focus:border-neon/60"
                      />
                      <select
                        value={deliveryTimeWindow}
                        onChange={(event) => setDeliveryTimeWindow(event.target.value)}
                        className="h-11 px-3 border border-border/45 bg-void-light/35 text-[13px] text-foreground focus:outline-none focus:border-neon/60"
                      >
                        <option value="">Delivery window</option>
                        {PICKUP_WINDOWS.map((window) => (
                          <option key={window} value={window}>
                            {window}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={3}
                      placeholder="Notes (optional)"
                      className="w-full px-3 py-2 border border-border/45 bg-void-light/35 text-[13px] text-foreground placeholder:text-muted-foreground/70 resize-none focus:outline-none focus:border-neon/60"
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        <footer className="absolute inset-x-0 bottom-0 border-t border-border/45 bg-void-light/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="w-full h-[52px] border border-neon/40 bg-neon/[0.18] text-neon font-display text-[17px] uppercase tracking-[0.08em] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-neon/[0.24] flex items-center justify-center gap-2"
          >
            {createOrder.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {createOrder.isPending ? "Creating..." : "Create Order"}
          </button>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            Creates a real backend order for admin follow-up.
          </p>
        </footer>
      </section>
    </div>,
    document.body
  );
}
