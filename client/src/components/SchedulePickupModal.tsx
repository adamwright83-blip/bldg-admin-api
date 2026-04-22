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
const BUTLER_ACCENT = "#d42f76";
const BUTLER_ACCENT_DARK = "#b21a5c";

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

function DateWindowSummary({ formData }: { formData: FormData }) {
  if (!formData.pickupDate && !formData.pickupTimeWindow) {
    return <span className="text-[#876c77]">Choose your preferred time</span>;
  }

  return (
    <span className="text-[#321a24]">
      {formData.pickupDate || "Date"}
      {formData.pickupDate && formData.pickupTimeWindow ? " • " : ""}
      {formData.pickupTimeWindow || "Window"}
    </span>
  );
}

function StagePills({ currentStage }: { currentStage: number }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Booking progress">
      {STAGES.map((stage, index) => {
        const stageIndex = index + 1;
        const active = stageIndex === currentStage;
        const complete = stageIndex < currentStage;

        return (
          <li key={stage} className="min-w-0">
            <div
              className={cn(
                "rounded-full border px-2 py-1 text-center text-[11px] font-semibold tracking-[0.02em] transition-colors",
                complete && "border-[#e17ca6] bg-[#ffe0ee] text-[#9f2c5f]",
                active && "border-[#d42f76] bg-[#fff0f7] text-[#ad1d5b]",
                !active && !complete && "border-[#ead7df] bg-white text-[#85636f]"
              )}
            >
              <span className="truncate">{stage}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function BookingSummary({ formData }: { formData: FormData }) {
  return (
    <div className="rounded-2xl border border-[#eedee5] bg-white p-3.5 text-sm shadow-[0_8px_20px_rgba(194,129,156,0.12)]">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#946978]">
        <span>Order Summary</span>
        <span className="inline-flex items-center gap-1 text-[#b06f89]">
          <Lock className="h-3 w-3" aria-hidden />
          Secure
        </span>
      </div>
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[#8f6e7a]">Service</dt>
          <dd className="font-medium text-[#311821]">{formatServiceLabel(formData.serviceType)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[#8f6e7a]">Pickup</dt>
          <dd className="text-right font-medium">
            <DateWindowSummary formData={formData} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[#8f6e7a]">Location</dt>
          <dd className="max-w-[68%] truncate text-right font-medium text-[#311821]">
            {formData.address.trim() || "Add address in Preferences"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function AccentButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[14px] font-semibold tracking-[0.02em] text-white shadow-[0_12px_30px_rgba(183,36,98,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(183,36,98,0.4)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
      style={{
        background: `linear-gradient(135deg, ${BUTLER_ACCENT} 0%, ${BUTLER_ACCENT_DARK} 100%)`,
      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

function GhostButton({
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
      className="inline-flex w-full items-center justify-center rounded-xl border border-[#e7d2dd] bg-white px-4 py-3 text-[14px] font-semibold text-[#7f5566] transition-colors hover:bg-[#fff7fb] disabled:cursor-not-allowed disabled:opacity-60"
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
      <span className="text-[12px] font-medium tracking-[0.01em] text-[#785764]">
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
        className="w-full rounded-xl border border-[#e8d7df] bg-white px-3.5 py-2.5 text-[14px] text-[#2f1b24] outline-none transition-all placeholder:text-[#b69aa7] focus:border-[#d65a90] focus:ring-2 focus:ring-[#f6c8dd]"
      />
    </label>
  );
}

function StepFrame({
  title,
  subtitle,
  icon,
  children,
  onBack,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-[#ffe7f1] p-2.5 text-[#c52a6b]">{icon}</div>
          <div>
            <h3 className="text-[23px] font-semibold leading-[1.15] text-[#2a1720]">{title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[#88616f]">{subtitle}</p>
          </div>
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#ead9e2] bg-white text-[#7f5868] transition-colors hover:bg-[#fff3f9]"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
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

  const itemClass = (active: boolean) =>
    cn(
      "w-full rounded-2xl border px-4 py-3 text-left transition-all",
      active
        ? "border-[#d74b87] bg-[#fff0f7] shadow-[0_8px_20px_rgba(213,73,133,0.18)]"
        : "border-[#e8d9e0] bg-white hover:border-[#dca0bc]"
    );

  return (
    <StepFrame
      title="Book a Pickup"
      subtitle="Choose your service to begin. Specialty Care remains pricing-only."
      icon={<Shirt className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-3">
        <button type="button" className={itemClass(formData.serviceType === "wash_fold")} onClick={() => select("wash_fold")}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[16px] font-semibold text-[#2b1720]">Wash &amp; Fold</span>
            <span className="rounded-full bg-[#ffe3ef] px-2.5 py-1 text-[12px] font-semibold text-[#b31d5f]">
              ${centsToDollars(WF_RATE_PER_LB_CENTS)}/lb
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[#886170]">Premium wash + dry + fold with concierge pickup and return.</p>
        </button>

        <button
          type="button"
          className={itemClass(formData.serviceType === "dry_cleaning")}
          onClick={() => select("dry_cleaning")}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[16px] font-semibold text-[#2b1720]">Dry Cleaning</span>
            <span className="rounded-full bg-[#ffe3ef] px-2.5 py-1 text-[12px] font-semibold text-[#b31d5f]">
              {dcMinCents != null
                ? `From $${centsToDollars(dcMinCents)}`
                : "Per garment"}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[#886170]">Expert garment care for delicates, tailoring-grade finishes, and formalwear.</p>
        </button>
      </div>

      <div className="rounded-xl border border-[#f2dde6] bg-[#fff7fb] px-3 py-2 text-[12px] text-[#8f6e7a]">
        <span className="font-semibold text-[#6f4d5b]">Secure checkout:</span> card is saved on Stripe after order details are confirmed.
      </div>

      <AccentButton onClick={onNext} disabled={!formData.serviceType}>
        Continue to Preferences
      </AccentButton>
    </StepFrame>
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
    <StepFrame
      title="Pickup Preferences"
      subtitle="Tell us where to collect and any concierge instructions."
      icon={<Home className="h-5 w-5" aria-hidden />}
      onBack={onBack}
    >
      <div className="space-y-3.5">
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
          <span className="text-[12px] font-medium tracking-[0.01em] text-[#785764]">Special Instructions</span>
          <textarea
            value={formData.specialInstructions}
            onChange={(event) =>
              setFormData({ ...formData, specialInstructions: event.target.value })
            }
            placeholder="Leave with concierge, front desk notes, gate code, etc."
            rows={3}
            className="w-full resize-none rounded-xl border border-[#e8d7df] bg-white px-3.5 py-2.5 text-[14px] text-[#2f1b24] outline-none transition-all placeholder:text-[#b69aa7] focus:border-[#d65a90] focus:ring-2 focus:ring-[#f6c8dd]"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <AccentButton onClick={onNext} disabled={!formData.address.trim()}>
          Continue to Date &amp; Time
        </AccentButton>
      </div>
    </StepFrame>
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
    <StepFrame
      title="Date & Time"
      subtitle="Pick a 2-hour window that works best for pickup."
      icon={<CalendarClock className="h-5 w-5" aria-hidden />}
      onBack={onBack}
    >
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
          <span className="text-[12px] font-medium tracking-[0.01em] text-[#785764]">
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
                    "rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors",
                    active
                      ? "border-[#d74b87] bg-[#fff0f7] text-[#8b2550]"
                      : "border-[#e8d7df] bg-white text-[#684754] hover:border-[#dca0bc]"
                  )}
                >
                  {window}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#f2dde6] bg-[#fff7fb] px-3 py-2 text-[12px] text-[#8f6e7a]">
        Earliest pickup date is {minDate} to ensure routing and concierge handoff quality.
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <AccentButton
          onClick={onNext}
          disabled={!formData.pickupDate || !formData.pickupTimeWindow}
        >
          Continue to Review
        </AccentButton>
      </div>
    </StepFrame>
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
    <StepFrame
      title="Review & Contact"
      subtitle="Final contact details before we save your card on file."
      icon={<User className="h-5 w-5" aria-hidden />}
      onBack={onBack}
    >
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

      <div className="grid gap-3 sm:grid-cols-2">
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

      {error ? (
        <p className="rounded-xl border border-[#f3d0df] bg-[#fff2f8] px-3 py-2 text-[12px] text-[#a52c61]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <AccentButton onClick={onSubmit} disabled={!canContinue} loading={loading}>
          {loading ? "Creating Order..." : "Create Order"}
        </AccentButton>
      </div>
    </StepFrame>
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
    <StepFrame
      title="Secure Card on File"
      subtitle="Your card will only be charged when your order is processed."
      icon={<Lock className="h-5 w-5" aria-hidden />}
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

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <GhostButton onClick={onBack} disabled={loading}>
          Back
        </GhostButton>
        <AccentButton
          onClick={handleSubmit}
          loading={loading}
          disabled={!stripe || !clientSecret || confirmCardMutation.isPending || !stripePk}
        >
          {loading ? "Saving..." : "Save Card & Place Order"}
        </AccentButton>
      </div>
    </StepFrame>
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
    <StepFrame
      title="You’re Booked"
      subtitle="Your pickup request was submitted successfully."
      icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
    >
      <div className="rounded-2xl border border-[#e8d7df] bg-white p-4">
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

      <AccentButton onClick={handleContinue} loading={loading}>
        {loading ? "Redirecting..." : "Continue"}
      </AccentButton>
    </StepFrame>
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
        "relative flex w-full flex-col overflow-hidden border border-[#ead9e1] bg-[#fff9f7] shadow-[0_24px_40px_rgba(149,77,110,0.22)]",
        isModal ? "h-full rounded-none sm:h-auto sm:max-h-[94vh] sm:max-w-[560px] sm:rounded-[28px]" : "rounded-[28px]",
        className
      )}
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal ? true : undefined}
      aria-label="Book a pickup"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="sticky top-0 z-10 border-b border-[#ead9e1] bg-[#fff9f7]/95 px-4 py-3 backdrop-blur sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-3">
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

        <StagePills currentStage={currentStage} />
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

      <div className="grid grid-cols-3 border-t border-[#ead9e1] bg-white/80 px-3 py-2 text-[11px] text-[#7f606d] sm:px-5 sm:text-[11px]">
        <div className="inline-flex items-center justify-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Beverly Hills + Century City
        </div>
        <div className="inline-flex items-center justify-center gap-1.5 border-x border-[#ead9e1]">
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          2-Hour Window
        </div>
        <a
          className="inline-flex items-center justify-center gap-1.5 hover:text-[#b3225f]"
          href={`tel:${tenant.supportPhone.replace(/[^\d+]/g, "")}`}
        >
          <Phone className="h-3.5 w-3.5" aria-hidden />
          {tenant.supportPhone}
        </a>
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
