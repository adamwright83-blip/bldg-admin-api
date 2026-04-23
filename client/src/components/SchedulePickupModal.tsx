import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { getResidentWebOrigin } from "@/const";
import { useTenant } from "@/hooks/useTenant";
import { WF_RATE_PER_LB_CENTS, centsToDollars } from "@shared/pricing";
import { useCatalogDryCleanMinCents } from "@/components/CatalogDryCleanPricing";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Home,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Shirt,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SchedulePickupModalClassic from "@/components/SchedulePickupModalClassic";

const DEFAULT_LOGO_FULL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png";

const TIME_WINDOWS = [
  "7:00am – 9:00am",
  "9:00am – 11:00am",
  "11:00am – 1:00pm",
  "7:00pm – 9:00pm",
] as const;

const STRIPE_TEST_HINT = "Stripe: test";
const ACCENT = "#d42f76";
const ACCENT_DEEP = "#b21a5c";

// Publishable key from env (live in prod, test in dev). Never commit keys.
const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = stripePk ? loadStripe(stripePk) : Promise.resolve(null);

type ServiceType = "wash_fold" | "dry_cleaning";
type Presentation = "modal" | "rail";

interface FormData {
  serviceType: ServiceType | null;
  pickupDate: string;
  pickupTimeWindow: string;
  address: string;
  unit: string;
  specialInstructions: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

interface SchedulePickupModalProps {
  onClose?: () => void;
  presentation?: Presentation;
  className?: string;
}

const STAGES = ["Service", "Preferences", "Date & Time", "Review"] as const;

function formatServiceLabel(serviceType: ServiceType | null): string {
  if (serviceType === "wash_fold") return "Wash & Fold";
  if (serviceType === "dry_cleaning") return "Dry Cleaning";
  return "Select a service";
}

function getCurrentStage(step: number): number {
  if (step <= 1) return 1;
  if (step === 2) return 2;
  if (step === 3) return 3;
  return 4;
}

function StageStepper({ currentStage }: { currentStage: number }) {
  return (
    <ol className="flex items-center gap-1.5 lg:gap-2" aria-label="Booking progress">
      {STAGES.map((stage, index) => {
        const stageIndex = index + 1;
        const complete = stageIndex < currentStage;
        const active = stageIndex === currentStage;

        return (
          <li key={stage} className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              className={cn(
                "inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[10.5px] font-semibold transition-colors lg:rounded-[14px] lg:px-2.5 lg:py-1.5 lg:text-[11.5px]",
                complete && "border-[#de80a8] bg-[#ffe7f2] text-[#9c2a5c]",
                active && "border-[#d24784] bg-[#fff3f9] text-[#a8205c]",
                !active && !complete && "border-[#ead8e0] bg-white text-[#896775]"
              )}
            >
              <span
                className={cn(
                  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] lg:h-5 lg:w-5 lg:text-[10px]",
                  active && "bg-[#ffd9ea] text-[#a8205c]",
                  complete && "bg-[#ffd9ea] text-[#a8205c]",
                  !active && !complete && "bg-[#f7edf2] text-[#8f6b7a]"
                )}
              >
                {complete ? <Check className="h-2.5 w-2.5" aria-hidden /> : stageIndex}
              </span>
              <span className="truncate">{stage}</span>
            </div>
            {index < STAGES.length - 1 ? (
              <span className="h-px w-2 shrink-0 bg-[#e8d6df] lg:w-3" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[#f0e0e7] bg-white px-3 py-2">
      <div className="inline-flex min-w-0 items-center gap-2 text-[12px] text-[#876674]">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ffeaf3] text-[#b52d68]">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className="min-w-0 truncate text-right text-[12.5px] font-semibold text-[#351f29]">{value}</div>
    </div>
  );
}

function BookingSummary({ formData }: { formData: FormData }) {
  const pickupLabel = formData.pickupDate
    ? `${formData.pickupDate}${formData.pickupTimeWindow ? ` • ${formData.pickupTimeWindow}` : ""}`
    : "Choose your preferred window";

  return (
    <div className="rounded-2xl border border-[#ecdbe4] bg-[linear-gradient(170deg,#fffdfc_0%,#fff4f8_100%)] p-3.5 shadow-[0_10px_20px_rgba(171,96,129,0.11)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#976a7c]">Order Summary</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#a17084]">
          <Lock className="h-3 w-3" aria-hidden />
          Secure
        </span>
      </div>
      <div className="space-y-1.5">
        <SummaryRow
          label="Service"
          value={formatServiceLabel(formData.serviceType)}
          icon={<Shirt className="h-3.5 w-3.5" aria-hidden />}
        />
        <SummaryRow
          label="Pickup"
          value={pickupLabel}
          icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
        />
        <SummaryRow
          label="Location"
          value={formData.address.trim() || "Add address in Preferences"}
          icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}
        />
      </div>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled = false,
  loading = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-semibold text-white shadow-[0_14px_24px_rgba(178,31,97,0.34)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_28px_rgba(178,31,97,0.42)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 lg:h-[58px] lg:rounded-[19px] lg:text-[16px]"
      style={{ background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DEEP} 100%)` }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[#e7d1dc] bg-white px-4 text-[14px] font-semibold text-[#7f5868] transition-colors hover:bg-[#fff5fa] disabled:cursor-not-allowed disabled:opacity-60 lg:h-[52px] lg:rounded-[16px] lg:text-[15px]"
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder = "",
  required = false,
  type = "text",
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  min?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium tracking-[0.01em] text-[#7e5b6a]">
        {label}
        {required ? <span className="text-[#cc2f73]"> *</span> : null}
      </span>
      <input
        type={type}
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-10 w-full rounded-xl border border-[#e8d7df] bg-white px-3.5 text-[14px] text-[#2f1b24] outline-none transition-all placeholder:text-[#b99eaa] focus:border-[#d65a90] focus:ring-2 focus:ring-[#f6c8dd] lg:h-[52px] lg:rounded-[14px] lg:text-[14.5px]"
      />
    </label>
  );
}

function StepContainer({
  title,
  subtitle,
  icon,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#ffe8f2] text-[#bc2c68]">
            {icon}
          </div>
          <div>
            <h3 className="text-[22px] font-semibold leading-[1.14] text-[#2a1720]">{title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[#866272]">{subtitle}</p>
          </div>
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#ead9e1] bg-white text-[#7f5868] transition-colors hover:bg-[#fff3f9]"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StepService({
  formData,
  setFormData,
  onNext,
}: {
  formData: FormData;
  setFormData: (d: FormData) => void;
  onNext: () => void;
}) {
  const dcMinCents = useCatalogDryCleanMinCents();

  const select = (serviceType: ServiceType) => {
    setFormData({ ...formData, serviceType });
  };

  const tileClass = (active: boolean) =>
    cn(
      "w-full rounded-2xl border px-4 py-3 text-left transition-all",
      active
        ? "border-[#d24e87] bg-[#fff0f7] shadow-[0_8px_20px_rgba(200,74,133,0.18)]"
        : "border-[#e8d9e0] bg-white hover:border-[#dda6c0]"
    );

  return (
    <StepContainer
      title="Book a Pickup"
      subtitle="Choose your service to begin."
      icon={<Shirt className="h-4.5 w-4.5" aria-hidden />}
    >
      <div className="space-y-2.5">
        <button type="button" className={`${tileClass(formData.serviceType === "wash_fold")} min-h-[76px] lg:rounded-[18px]`} onClick={() => select("wash_fold")}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[16px] font-semibold text-[#2b1720]">Wash &amp; Fold</span>
            <span className="rounded-full bg-[#ffe3ef] px-2.5 py-1 text-[11px] font-semibold text-[#ad1d5d]">
              ${centsToDollars(WF_RATE_PER_LB_CENTS)}/lb
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[#886170]">Premium wash + dry + fold with concierge pickup and return.</p>
        </button>

        <button type="button" className={`${tileClass(formData.serviceType === "dry_cleaning")} min-h-[76px] lg:rounded-[18px]`} onClick={() => select("dry_cleaning")}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[16px] font-semibold text-[#2b1720]">Dry Cleaning</span>
            <span className="rounded-full bg-[#ffe3ef] px-2.5 py-1 text-[11px] font-semibold text-[#ad1d5d]">
              {dcMinCents != null ? `From $${centsToDollars(dcMinCents)}` : "Per garment"}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[#886170]">Expert garment care for delicates, tailoring-grade finishes, and formalwear.</p>
        </button>
      </div>

      <div className="rounded-xl border border-[#f0dbe5] bg-[#fff7fb] px-3 py-2 text-[12px] text-[#876575]">
        Specialty Care is currently marketing-only and not included in online checkout.
      </div>

      <PrimaryButton onClick={onNext} disabled={!formData.serviceType}>
        Continue to Preferences
      </PrimaryButton>
    </StepContainer>
  );
}

function StepPreferences({
  formData,
  setFormData,
  onNext,
  onBack,
}: {
  formData: FormData;
  setFormData: (d: FormData) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <StepContainer
      title="Pickup Preferences"
      subtitle="Tell us where to collect and any concierge notes."
      icon={<Home className="h-4.5 w-4.5" aria-hidden />}
      onBack={onBack}
    >
      <div className="rounded-xl border border-[#f0dfe7] bg-white p-3">
        <div className="space-y-3">
          <InputField
            label="Address"
            value={formData.address}
            onChange={(v) => setFormData({ ...formData, address: v })}
            placeholder="123 Wilshire Blvd, Los Angeles, CA"
            required
          />
          <InputField
            label="Unit / Apt"
            value={formData.unit}
            onChange={(v) => setFormData({ ...formData, unit: v })}
            placeholder="Unit 2401"
          />
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium tracking-[0.01em] text-[#7e5b6a]">Special Instructions</span>
            <textarea
              value={formData.specialInstructions}
              onChange={(event) => setFormData({ ...formData, specialInstructions: event.target.value })}
              placeholder="Leave with concierge, front desk notes, gate code, etc."
              rows={3}
              className="w-full resize-none rounded-xl border border-[#e8d7df] bg-white px-3.5 py-2.5 text-[14px] text-[#2f1b24] outline-none transition-all placeholder:text-[#b99eaa] focus:border-[#d65a90] focus:ring-2 focus:ring-[#f6c8dd]"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton onClick={onNext} disabled={!formData.address.trim()}>
          Continue to Date &amp; Time
        </PrimaryButton>
      </div>
    </StepContainer>
  );
}

function StepDateTime({
  formData,
  setFormData,
  onNext,
  onBack,
}: {
  formData: FormData;
  setFormData: (d: FormData) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <StepContainer
      title="Date & Time"
      subtitle="Select a 2-hour window for pickup."
      icon={<CalendarClock className="h-4.5 w-4.5" aria-hidden />}
      onBack={onBack}
    >
      <div className="rounded-xl border border-[#f0dfe7] bg-white p-3">
        <div className="space-y-3.5">
          <InputField
            type="date"
            label="Pickup Date"
            value={formData.pickupDate}
            onChange={(v) => setFormData({ ...formData, pickupDate: v })}
            min={minDate}
            required
          />

          <div className="space-y-1.5">
            <span className="text-[12px] font-medium tracking-[0.01em] text-[#7e5b6a]">
              Time Window <span className="text-[#cc2f73]">*</span>
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TIME_WINDOWS.map((window) => {
                const active = formData.pickupTimeWindow === window;
                return (
                  <button
                    key={window}
                    type="button"
                    onClick={() => setFormData({ ...formData, pickupTimeWindow: window })}
                    className={cn(
                      "h-10 rounded-xl border px-3 text-left text-[13px] font-medium transition-colors lg:h-[52px] lg:rounded-[14px] lg:text-[13.5px]",
                      active
                        ? "border-[#d74b87] bg-[#fff0f7] text-[#8b2550]"
                        : "border-[#e8d7df] bg-white text-[#6a4957] hover:border-[#dca0bc]"
                    )}
                  >
                    {window}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#f0dbe5] bg-[#fff7fb] px-3 py-2 text-[12px] text-[#876575]">
        Earliest pickup date is {minDate} to maintain concierge-level routing quality.
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton onClick={onNext} disabled={!formData.pickupDate || !formData.pickupTimeWindow}>
          Continue to Review
        </PrimaryButton>
      </div>
    </StepContainer>
  );
}

function StepReview({
  formData,
  setFormData,
  onSubmit,
  onBack,
  loading,
  error,
}: {
  formData: FormData;
  setFormData: (d: FormData) => void;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  const canContinue =
    formData.firstName.trim() && formData.lastName.trim() && formData.phone.trim();

  return (
    <StepContainer
      title="Review & Contact"
      subtitle="Final details before secure card setup."
      icon={<User className="h-4.5 w-4.5" aria-hidden />}
      onBack={onBack}
    >
      <div className="rounded-xl border border-[#f0dfe7] bg-white p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="First Name"
            value={formData.firstName}
            onChange={(v) => setFormData({ ...formData, firstName: v })}
            required
          />
          <InputField
            label="Last Name"
            value={formData.lastName}
            onChange={(v) => setFormData({ ...formData, lastName: v })}
            required
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <InputField
            label="Phone"
            value={formData.phone}
            onChange={(v) => setFormData({ ...formData, phone: v })}
            type="tel"
            placeholder="(323) 555-0100"
            required
          />
          <InputField
            label="Email"
            value={formData.email}
            onChange={(v) => setFormData({ ...formData, email: v })}
            type="email"
            placeholder="Optional"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#f3d0df] bg-[#fff2f8] px-3 py-2 text-[12px] text-[#a52c61]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton onClick={onSubmit} disabled={!canContinue} loading={loading}>
          {loading ? "Creating Order..." : "Create Order"}
        </PrimaryButton>
      </div>
    </StepContainer>
  );
}

function StepCardOnFile({
  formData,
  orderId,
  onSuccess,
  onBack,
}: {
  formData: FormData;
  orderId: number;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const isDev = import.meta.env.DEV;
  const isTestKey = stripePk.startsWith("pk_test_");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const initializedRef = useRef(false);
  const setupIntentMutation = trpc.orders.createSetupIntent.useMutation();
  const confirmCardMutation = trpc.orders.confirmCard.useMutation();

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    setupIntentMutation.mutate(
      {
        orderId,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email || undefined,
        phone: formData.phone,
      },
      {
        onSuccess: (data) => {
          setClientSecret(data.clientSecret);
          setCustomerId(data.customerId);
        },
        onError: (err) => {
          console.error("SetupIntent error:", err);
          setError("Failed to initialize payment. Please try again.");
        },
      }
    );
  }, [formData.email, formData.firstName, formData.lastName, formData.phone, orderId, setupIntentMutation]);

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret || !customerId) return;

    setLoading(true);
    setError(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setError("Card input failed to load. Please refresh and try again.");
        setLoading(false);
        return;
      }

      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: `${formData.firstName} ${formData.lastName}`,
            email: formData.email || undefined,
            phone: formData.phone,
          },
        },
      });

      if (result.error) {
        setError(result.error.message || "Card setup failed.");
        setLoading(false);
        return;
      }

      if (result.setupIntent?.payment_method) {
        await confirmCardMutation.mutateAsync({
          orderId,
          stripeCustomerId: customerId,
          stripePaymentMethodId:
            typeof result.setupIntent.payment_method === "string"
              ? result.setupIntent.payment_method
              : result.setupIntent.payment_method.id,
        });
      }

      setLoading(false);
      onSuccess();
    } catch (err) {
      console.error("Card confirmation error:", err);
      setError("Unable to save card. Please try again.");
      setLoading(false);
    }
  };

  return (
    <StepContainer
      title="Secure Card on File"
      subtitle="Your card is securely saved and charged only when your order is processed."
      icon={<Lock className="h-4.5 w-4.5" aria-hidden />}
      onBack={onBack}
    >
      {isDev && isTestKey ? (
        <p className="rounded-xl border border-[#f3dfc3] bg-[#fff8eb] px-3 py-2 text-[12px] text-[#9f6d1f]">
          {STRIPE_TEST_HINT}
        </p>
      ) : null}

      {!stripePk ? (
        <p className="rounded-xl border border-[#f3d0df] bg-[#fff2f8] px-3 py-2 text-[12px] text-[#a52c61]" role="alert">
          Stripe publishable key is not configured.
        </p>
      ) : null}

      <div className="rounded-xl border border-[#e8d7df] bg-white px-4 py-3">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#2f1b24",
                fontFamily: '"DM Sans", system-ui, sans-serif',
                "::placeholder": {
                  color: "#b69aa7",
                },
              },
              invalid: {
                color: "#b3265f",
              },
            },
          }}
        />
      </div>

      {error ? (
        <p className="rounded-xl border border-[#f3d0df] bg-[#fff2f8] px-3 py-2 text-[12px] text-[#a52c61]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SecondaryButton onClick={onBack} disabled={loading}>Back</SecondaryButton>
        <PrimaryButton
          onClick={handleSubmit}
          loading={loading}
          disabled={!stripe || !clientSecret || confirmCardMutation.isPending || !stripePk}
        >
          {loading ? "Saving..." : "Save Card & Place Order"}
        </PrimaryButton>
      </div>
    </StepContainer>
  );
}

function StepSuccess({
  orderId,
  supportPhone,
}: {
  orderId: number;
  supportPhone: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generateTokenMutation = trpc.orders.generatePortalToken.useMutation();
  const supportPhoneHref = `tel:${supportPhone.replace(/[^\d+]/g, "")}`;

  const handleContinue = async () => {
    setLoading(true);
    setError(null);

    try {
      const { token } = await generateTokenMutation.mutateAsync({ orderId });
      const welcome = new URL("/welcome", `${getResidentWebOrigin()}/`);
      welcome.searchParams.set("token", token);
      window.location.href = welcome.toString();
    } catch (err) {
      console.error("Failed to generate portal token:", err);
      setLoading(false);
      setError("Unable to continue right now. Please try again in a moment.");
    }
  };

  return (
    <StepContainer
      title="You’re Booked"
      subtitle="Your pickup request was submitted successfully."
      icon={<CheckCircle2 className="h-4.5 w-4.5" aria-hidden />}
    >
      <div className="rounded-xl border border-[#ead7e1] bg-white p-3">
        <p className="text-[14px] leading-relaxed text-[#724f5d]">
          Need to update details? Call or text{" "}
          <a href={supportPhoneHref} className="font-semibold text-[#b0215d] underline underline-offset-2">
            {supportPhone}
          </a>
          .
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#f3d0df] bg-[#fff2f8] px-3 py-2 text-[12px] text-[#a52c61]" role="alert">
          {error}
        </p>
      ) : null}

      <PrimaryButton onClick={handleContinue} loading={loading}>
        {loading ? "Redirecting..." : "Continue"}
      </PrimaryButton>
    </StepContainer>
  );
}

function BookingExperience({
  presentation = "modal",
  className,
  onClose,
}: SchedulePickupModalProps) {
  const { tenant } = useTenant();
  const [step, setStep] = useState(1);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>({
    serviceType: null,
    pickupDate: "",
    pickupTimeWindow: "",
    address: "",
    unit: "",
    specialInstructions: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
  });

  const createOrderMutation = trpc.orders.create.useMutation();
  const currentStage = useMemo(() => getCurrentStage(step), [step]);
  const isModal = presentation === "modal";

  const handleCreateOrder = async () => {
    if (!formData.serviceType) return;

    setSubmitError(null);

    try {
      const result = await createOrderMutation.mutateAsync({
        serviceType: formData.serviceType,
        pickupDate: formData.pickupDate,
        pickupTimeWindow: formData.pickupTimeWindow,
        address: formData.address,
        unit: formData.unit || undefined,
        specialInstructions: formData.specialInstructions || undefined,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        email: formData.email || undefined,
      });
      setOrderId(result.orderId);
      setStep(5);
    } catch (err) {
      console.error("Failed to create order:", err);
      setSubmitError("Unable to create your order. Please verify details and try again.");
    }
  };

  const panelBody = (
    <section
      className={cn(
        "relative flex w-full flex-col overflow-hidden border border-[#ead9e1] bg-[linear-gradient(180deg,#fffaf8_0%,#fff5f8_100%)] shadow-[0_24px_40px_rgba(149,77,110,0.23)]",
        isModal ? "h-full rounded-none sm:h-auto sm:max-h-[94vh] sm:max-w-[560px] sm:rounded-[30px]" : "rounded-[30px]",
        className
      )}
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal ? true : undefined}
      aria-label="Book a pickup"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="sticky top-0 z-10 border-b border-[#ead9e1] bg-[#fff9f7]/97 px-4 py-3 backdrop-blur sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-3 lg:mb-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src={tenant.logoUrl || DEFAULT_LOGO_FULL}
              alt={tenant.brandName}
              className="h-9 w-auto max-w-[160px] object-contain"
            />
            <span className="rounded-full bg-[#ffe6f1] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#b11f5c]">
              Book a Pickup
            </span>
          </div>
          {isModal && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#ead9e1] bg-white text-[#7f5868] transition-colors hover:bg-[#fff3f9]"
              aria-label="Close booking"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <StageStepper currentStage={currentStage} />
      </div>

      <div className={cn("space-y-4 px-4 pb-5 pt-4 sm:px-5", isModal ? "overflow-y-auto" : "")}>
        <BookingSummary formData={formData} />

        {step === 1 ? (
          <StepService formData={formData} setFormData={setFormData} onNext={() => setStep(2)} />
        ) : null}

        {step === 2 ? (
          <StepPreferences
            formData={formData}
            setFormData={setFormData}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        ) : null}

        {step === 3 ? (
          <StepDateTime
            formData={formData}
            setFormData={setFormData}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        ) : null}

        {step === 4 ? (
          <StepReview
            formData={formData}
            setFormData={setFormData}
            onSubmit={handleCreateOrder}
            onBack={() => setStep(3)}
            loading={createOrderMutation.isPending}
            error={submitError}
          />
        ) : null}

        {step === 5 && orderId ? (
          <Elements stripe={stripePromise}>
            <StepCardOnFile
              formData={formData}
              orderId={orderId}
              onSuccess={() => setStep(6)}
              onBack={() => setStep(4)}
            />
          </Elements>
        ) : null}

        {step === 6 && orderId ? (
          <StepSuccess orderId={orderId} supportPhone={tenant.supportPhone} />
        ) : null}
      </div>

      <div className="border-t border-[#ead9e1] bg-[linear-gradient(180deg,#fff_0%,#fff8fb_100%)] px-3 py-2.5 sm:px-5">
        <div className="grid grid-cols-1 gap-1.5 text-[11px] text-[#7f606d] sm:grid-cols-3">
          <div className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#efdde6] bg-white px-2 py-1.5">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Beverly Hills + Century City
          </div>
          <div className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#efdde6] bg-white px-2 py-1.5">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            2-Hour Window
          </div>
          <a
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#efdde6] bg-white px-2 py-1.5 transition-colors hover:text-[#b3225f]"
            href={`tel:${tenant.supportPhone.replace(/[^\d+]/g, "")}`}
          >
            <Phone className="h-3.5 w-3.5" aria-hidden />
            {tenant.supportPhone}
          </a>
        </div>
      </div>
    </section>
  );

  if (!isModal) {
    return panelBody;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1e101640] p-0 sm:items-center sm:bg-black/55 sm:p-4"
      onClick={onClose}
    >
      {panelBody}
    </div>
  );
}

export function SchedulePickupRail({ className }: { className?: string }) {
  return <BookingExperience presentation="rail" className={className} />;
}

export default function SchedulePickupModal({ onClose }: SchedulePickupModalProps) {
  const { tenant } = useTenant();

  if (tenant.templateType !== "butler") {
    return <SchedulePickupModalClassic onClose={onClose ?? (() => {})} />;
  }

  return <BookingExperience presentation="modal" onClose={onClose} />;
}
