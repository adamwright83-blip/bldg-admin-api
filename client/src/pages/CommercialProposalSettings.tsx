import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
import { DEFAULT_COMMERCIAL_PROPOSAL_SERVICES } from "@shared/commercialProposal";

type FormState = {
  storeName: string;
  operatorName: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  logoUrl: string;
  commercialPricePerPound: string;
  minimumOrder: string;
  turnaroundLabel: string;
  pickupScheduleLabel: string;
  serviceAreaLabel: string;
  insuranceLabel: string;
  services: string;
};

const EMPTY_FORM: FormState = {
  storeName: "",
  operatorName: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  logoUrl: "",
  commercialPricePerPound: "",
  minimumOrder: "",
  turnaroundLabel: "",
  pickupScheduleLabel: "",
  serviceAreaLabel: "",
  insuranceLabel: "",
  services: "",
};

export default function CommercialProposalSettings() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const profileQuery = trpc.system.commercialProposal.profile.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );
  const saveProfile = trpc.system.commercialProposal.saveProfile.useMutation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    setForm({
      storeName: profile.storeName,
      operatorName: profile.operatorName,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      address: profile.address,
      logoUrl: profile.logoUrl ?? "",
      commercialPricePerPound: (
        profile.commercialPricePerPoundCents / 100
      ).toFixed(2),
      minimumOrder:
        profile.minimumOrderCents === null
          ? ""
          : (profile.minimumOrderCents / 100).toFixed(2),
      turnaroundLabel: profile.turnaroundLabel,
      pickupScheduleLabel: profile.pickupScheduleLabel,
      serviceAreaLabel: profile.serviceAreaLabel,
      insuranceLabel: profile.insuranceLabel ?? "",
      services: profile.services.join("\n"),
    });
  }, [profileQuery.data]);

  if (authLoading)
    return (
      <main className="min-h-screen bg-slate-950 grid place-items-center text-white">
        <Loader2 className="animate-spin" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role="admin" onSuccess={() => window.location.reload()} />
    );

  const field = (key: keyof FormState, label: string, type = "text") => (
    <label className="grid gap-2 text-sm text-slate-300">
      <span className="font-semibold">{label}</span>
      <input
        type={type}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        value={form[key]}
        onChange={event =>
          setForm(current => ({ ...current, [key]: event.target.value }))
        }
        className="min-h-11 rounded-xl border border-white/15 bg-black/30 px-3 text-white outline-none focus:border-orange-400"
      />
    </label>
  );

  const save = async () => {
    setMessage(null);
    try {
      const pricePerPound = Number(form.commercialPricePerPound);
      const minimumOrder = form.minimumOrder.trim()
        ? Number(form.minimumOrder)
        : null;
      if (!Number.isFinite(pricePerPound) || pricePerPound <= 0)
        throw new Error("Enter a valid commercial price per pound");
      if (
        minimumOrder !== null &&
        (!Number.isFinite(minimumOrder) || minimumOrder < 0)
      )
        throw new Error("Enter a valid minimum order or leave it blank");
      const services = form.services
        .split("\n")
        .map(value => value.trim())
        .filter(Boolean);
      await saveProfile.mutateAsync({
        storeName: form.storeName,
        operatorName: form.operatorName,
        phone: form.phone,
        email: form.email,
        website: form.website,
        address: form.address,
        logoUrl: form.logoUrl.trim() || null,
        commercialPricePerPoundCents: Math.round(pricePerPound * 100),
        minimumOrderCents:
          minimumOrder === null ? null : Math.round(minimumOrder * 100),
        turnaroundLabel: form.turnaroundLabel,
        pickupScheduleLabel: form.pickupScheduleLabel,
        serviceAreaLabel: form.serviceAreaLabel,
        insuranceLabel: form.insuranceLabel.trim() || null,
        services,
      });
      setMessage("Commercial proposal profile saved");
      await profileQuery.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Profile could not be saved"
      );
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.2em] text-orange-400">
              DAYFORGE COLLATERAL
            </span>
            <h1 className="mt-2 text-3xl font-black">
              Commercial proposal profile
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              These persisted tenant facts become the source for every proposal.
              Nothing is borrowed from demo copy or browser storage.
            </p>
          </div>
          <Link
            href="/commercial-missions"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Missions
          </Link>
        </header>

        <section className="grid gap-5 rounded-2xl border border-white/10 bg-slate-900 p-5 md:grid-cols-2 md:p-7">
          {profileQuery.isLoading ? (
            <p className="inline-flex items-center gap-2 text-sm text-slate-400 md:col-span-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading saved
              profile…
            </p>
          ) : null}
          {profileQuery.error ? (
            <p role="alert" className="text-sm text-red-300 md:col-span-2">
              {profileQuery.error.message}
            </p>
          ) : null}
          {!profileQuery.isLoading &&
          !profileQuery.error &&
          !profileQuery.data ? (
            <p className="rounded-xl border border-orange-400/20 bg-orange-400/5 p-3 text-sm text-orange-100 md:col-span-2">
              Complete this once before generating production collateral.
              DayForge intentionally provides no fictional operator profile.
            </p>
          ) : null}
          {field("storeName", "Store / operating brand")}
          {field("operatorName", "Operator name")}
          {field("phone", "Commercial phone", "tel")}
          {field("email", "Commercial email", "email")}
          {field("website", "Website", "url")}
          {field("logoUrl", "Logo URL", "url")}
          <div className="md:col-span-2">
            {field("address", "Store address")}
          </div>
          {field(
            "commercialPricePerPound",
            "Commercial price per pound ($)",
            "number"
          )}
          {field("minimumOrder", "Minimum order ($, optional)", "number")}
          {field("turnaroundLabel", "Turnaround promise")}
          {field("pickupScheduleLabel", "Pickup schedule")}
          {field("serviceAreaLabel", "Service area")}
          {field("insuranceLabel", "Insurance / terms note (optional)")}
          <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
            <span className="font-semibold">Services · one per line</span>
            <textarea
              rows={7}
              value={form.services}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  services: event.target.value,
                }))
              }
              className="rounded-xl border border-white/15 bg-black/30 p-3 text-white outline-none focus:border-orange-400"
            />
          </label>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-orange-400/40 px-4 font-bold text-orange-200"
            onClick={() =>
              setForm(current => ({
                ...current,
                services: DEFAULT_COMMERCIAL_PROPOSAL_SERVICES.join("\n"),
              }))
            }
          >
            <Sparkles className="h-4 w-4" /> Use laundry service defaults
          </button>
          <button
            type="button"
            disabled={
              saveProfile.isPending ||
              profileQuery.isLoading ||
              Boolean(profileQuery.error)
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 font-black text-white disabled:opacity-50"
            onClick={() => void save()}
          >
            {saveProfile.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save production profile
          </button>
          {message ? (
            <p role="status" className="text-sm text-slate-300 md:col-span-2">
              {message}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
