/**
 * Schedule Pickup Modal — 6-step wizard
 * 
 * Step 1: Service Selection (Wash & Fold / Dry Cleaning)
 * Step 2: Pickup Schedule (Date + Time Window)
 * Step 3: Address & Details
 * Step 4: Contact Info
 * Step 5: Card on File (Stripe Elements)
 * Step 6: Success
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const LOGO_FULL = "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png";

const pf = { fontFamily: '"Playfair Display", Georgia, serif' };
const cg = { fontFamily: '"Cormorant Garamond", Georgia, serif' };

// Publishable key from env (live in prod, test in dev). Never commit keys.
const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = stripePk ? loadStripe(stripePk) : Promise.resolve(null);

/* ===== TYPES ===== */
interface FormData {
  serviceType: "wash_fold" | "dry_cleaning" | null;
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
  onClose: () => void;
}

/* ===== SHARED UI COMPONENTS ===== */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-4 left-4 text-black/60 hover:text-black transition-colors cursor-pointer"
      aria-label="Go back"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}

function BlackButton({
  children,
  onClick,
  disabled = false,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-black text-white hover:bg-black/90 disabled:bg-black/40 disabled:cursor-not-allowed transition-colors cursor-pointer"
      style={{
        ...cg,
        fontSize: "0.95rem",
        fontWeight: 500,
        letterSpacing: "0.1em",
        padding: "14px 28px",
        borderRadius: "3px",
        border: "none",
      }}
    >
      {children}
    </button>
  );
}

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[1.4rem] md:text-[1.6rem] text-center mb-6"
      style={{ ...pf, fontWeight: 500 }}
    >
      {children}
    </h2>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder = "",
  required = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[0.85rem] text-black/60 mb-1" style={cg}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-black/20 rounded px-3 py-2.5 text-[0.95rem] focus:outline-none focus:border-black/50 transition-colors bg-white"
        style={cg}
      />
    </div>
  );
}

/* ===== STEP 1: SERVICE SELECTION ===== */
function Step1({
  formData,
  setFormData,
  onNext,
}: {
  formData: FormData;
  setFormData: (d: FormData) => void;
  onNext: () => void;
}) {
  const select = (type: "wash_fold" | "dry_cleaning") => {
    setFormData({ ...formData, serviceType: type });
  };

  return (
    <div>
      {/* Logo */}
      <div className="flex justify-center mb-6">
        <img src={LOGO_FULL} alt="Laundry Butler" className="w-[180px] h-auto" />
      </div>

      <StepHeading>What do you need?</StepHeading>

      <div className="space-y-3 mb-8">
        <button
          onClick={() => select("wash_fold")}
          className={`w-full text-left border rounded-md px-5 py-4 transition-all cursor-pointer ${
            formData.serviceType === "wash_fold"
              ? "border-black bg-black/5"
              : "border-black/20 hover:border-black/40"
          }`}
        >
          <div className="text-[1.1rem]" style={{ ...pf, fontWeight: 500 }}>
            Wash &amp; Fold
          </div>
          <div className="text-[0.9rem] text-black/60 mt-0.5" style={cg}>
            $2.50/lb
          </div>
        </button>

        <button
          onClick={() => select("dry_cleaning")}
          className={`w-full text-left border rounded-md px-5 py-4 transition-all cursor-pointer ${
            formData.serviceType === "dry_cleaning"
              ? "border-black bg-black/5"
              : "border-black/20 hover:border-black/40"
          }`}
        >
          <div className="text-[1.1rem]" style={{ ...pf, fontWeight: 500 }}>
            Dry Cleaning
          </div>
          <div className="text-[0.9rem] text-black/60 mt-0.5" style={cg}>
            Per garment
          </div>
        </button>
      </div>

      <BlackButton onClick={onNext} disabled={!formData.serviceType}>
        CONTINUE
      </BlackButton>
    </div>
  );
}

/* ===== STEP 2: PICKUP SCHEDULE ===== */
function Step2({
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
  // Get tomorrow's date as minimum
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <div>
      <BackButton onClick={onBack} />
      <StepHeading>Schedule Your Pickup</StepHeading>

      <div className="mb-4">
        <label className="block text-[0.85rem] text-black/60 mb-1" style={cg}>
          Pickup Date <span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={formData.pickupDate}
          min={minDate}
          onChange={(e) => setFormData({ ...formData, pickupDate: e.target.value })}
          className="w-full border border-black/20 rounded px-3 py-2.5 text-[0.95rem] focus:outline-none focus:border-black/50 transition-colors bg-white"
          style={cg}
        />
      </div>

      <div className="mb-8">
        <label className="block text-[0.85rem] text-black/60 mb-2" style={cg}>
          Time Window <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {["7:00am – 9:00am", "9:00am – 11:00am", "11:00am – 1:00pm", "7:00pm – 9:00pm"].map((window) => (
            <button
              key={window}
              onClick={() => setFormData({ ...formData, pickupTimeWindow: window })}
              className={`w-full text-left border rounded-md px-4 py-3 transition-all cursor-pointer text-[0.95rem] ${
                formData.pickupTimeWindow === window
                  ? "border-black bg-black/5"
                  : "border-black/20 hover:border-black/40"
              }`}
              style={cg}
            >
              {window}
            </button>
          ))}
        </div>
      </div>

      <BlackButton
        onClick={onNext}
        disabled={!formData.pickupDate || !formData.pickupTimeWindow}
      >
        CONTINUE
      </BlackButton>
    </div>
  );
}

/* ===== STEP 3: ADDRESS & DETAILS ===== */
function Step3({
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
    <div>
      <BackButton onClick={onBack} />
      <StepHeading>Pickup Details</StepHeading>

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

      <div className="mb-6">
        <label className="block text-[0.85rem] text-black/60 mb-1" style={cg}>
          Special Instructions
        </label>
        <textarea
          value={formData.specialInstructions}
          onChange={(e) =>
            setFormData({ ...formData, specialInstructions: e.target.value })
          }
          placeholder="Leave with concierge, etc."
          rows={3}
          className="w-full border border-black/20 rounded px-3 py-2.5 text-[0.95rem] focus:outline-none focus:border-black/50 transition-colors bg-white resize-none"
          style={cg}
        />
      </div>

      <BlackButton onClick={onNext} disabled={!formData.address.trim()}>
        CONTINUE
      </BlackButton>
    </div>
  );
}

/* ===== STEP 4: CONTACT INFO ===== */
function Step4({
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
  const canContinue =
    formData.firstName.trim() && formData.lastName.trim() && formData.phone.trim();

  return (
    <div>
      <BackButton onClick={onBack} />
      <StepHeading>Your Information</StepHeading>

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

      <InputField
        label="Phone"
        value={formData.phone}
        onChange={(v) => setFormData({ ...formData, phone: v })}
        type="tel"
        placeholder="(310) 555-0100"
        required
      />

      <InputField
        label="Email"
        value={formData.email}
        onChange={(v) => setFormData({ ...formData, email: v })}
        type="email"
        placeholder="Optional"
      />

      <div className="mt-4">
        <BlackButton onClick={onNext} disabled={!canContinue}>
          CONTINUE
        </BlackButton>
      </div>
    </div>
  );
}

/* ===== STEP 5: CARD ON FILE (Stripe Elements) ===== */
function Step5Inner({
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const setupIntentMutation = trpc.orders.createSetupIntent.useMutation();
  const confirmCardMutation = trpc.orders.confirmCard.useMutation();

  // Create SetupIntent when this step mounts
  useEffect(() => {
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
          setError("Failed to initialize payment. Please try again.");
          console.error("SetupIntent error:", err);
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret || !customerId) return;

    setLoading(true);
    setError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError("Card element not found.");
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

    // Save the payment method ID to the order
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
  };

  return (
    <div>
      <BackButton onClick={onBack} />
      <StepHeading>Card on File</StepHeading>

      <p
        className="text-[0.9rem] text-black/60 text-center mb-6 leading-relaxed"
        style={cg}
      >
        Your card will not be charged now. It will be kept
        securely on file for when your order is processed.
      </p>

      <div className="border border-black/20 rounded px-4 py-3 mb-4 bg-white">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                fontFamily: '"Cormorant Garamond", Georgia, serif',
                color: "#1a1a1a",
                "::placeholder": {
                  color: "#9ca3af",
                },
              },
              invalid: {
                color: "#dc2626",
              },
            },
          }}
        />
      </div>

      {error && (
        <p className="text-red-600 text-[0.85rem] mb-4 text-center" style={cg}>
          {error}
        </p>
      )}

      <BlackButton
        onClick={handleSubmit}
        disabled={loading || !stripe || !clientSecret}
      >
        {loading ? "SAVING..." : "SAVE CARD & PLACE ORDER"}
      </BlackButton>
    </div>
  );
}

function Step5(props: {
  formData: FormData;
  orderId: number;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const isDev = import.meta.env.DEV;
  const isTestKey = stripePk.startsWith("pk_test_");
  return (
    <div className="relative">
      {isDev && isTestKey && (
        <span className="absolute top-0 right-0 text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
          Stripe: test
        </span>
      )}
      <Elements stripe={stripePromise}>
        <Step5Inner {...props} />
      </Elements>
    </div>
  );
}

/* ===== STEP 6: SUCCESS ===== */
function Step6({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const generateTokenMutation = trpc.orders.generatePortalToken.useMutation();

  const handleContinue = async () => {
    setLoading(true);
    try {
      const { token } = await generateTokenMutation.mutateAsync({ orderId });
      window.location.href = `https://app.bldg.chat/welcome?token=${token}`;
    } catch (err) {
      console.error("Failed to generate portal token:", err);
      setLoading(false);
    }
  };

  return (
    <div className="text-center py-4">
      {/* Rocket emoji as a fun break from formal branding */}
      <div className="text-[4rem] mb-4">🚀</div>

      <h2
        className="text-[1.5rem] md:text-[1.7rem] mb-4"
        style={{ ...pf, fontWeight: 500 }}
      >
        Congrats!
      </h2>
      <p
        className="text-[1.05rem] text-black/70 mb-2 leading-relaxed"
        style={cg}
      >
        Your order was placed successfully.
      </p>
      <p
        className="text-[0.95rem] text-black/60 mb-8 leading-relaxed"
        style={cg}
      >
        Call or text{" "}
        <a href="tel:+13238074661" className="text-black underline">
          (323) 807-4661
        </a>{" "}
        if you have requests or questions.
      </p>

      <BlackButton onClick={handleContinue} disabled={loading}>
        {loading ? "REDIRECTING..." : "CONTINUE"}
      </BlackButton>
    </div>
  );
}

/* ===== MAIN MODAL ===== */
export default function SchedulePickupModal({ onClose }: SchedulePickupModalProps) {
  const [step, setStep] = useState(1);
  const [orderId, setOrderId] = useState<number | null>(null);
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

  // After Step 4 (contact info), create the order in the database
  const handleStep4Next = async () => {
    if (!formData.serviceType) return;

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
      alert("Failed to create order. Please try again.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-[420px] max-h-[90vh] overflow-y-auto relative"
        style={{ padding: "32px 28px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-black/40 hover:text-black transition-colors cursor-pointer"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Step content */}
        {step === 1 && (
          <Step1
            formData={formData}
            setFormData={setFormData}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step2
            formData={formData}
            setFormData={setFormData}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3
            formData={formData}
            setFormData={setFormData}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4
            formData={formData}
            setFormData={setFormData}
            onNext={handleStep4Next}
            onBack={() => setStep(3)}
          />
        )}
        {step === 5 && orderId && (
          <Step5
            formData={formData}
            orderId={orderId}
            onSuccess={() => setStep(6)}
            onBack={() => setStep(4)}
          />
        )}
        {step === 6 && orderId && <Step6 orderId={orderId} onClose={onClose} />}
      </div>
    </div>
  );
}
