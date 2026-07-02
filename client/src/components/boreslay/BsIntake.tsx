import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  BOOKING_URL,
  BUSINESS_TYPES,
  MONTHLY_VOLUMES,
  PRIMARY_NEEDS,
  submitBoreslayLead,
  type BsIntakeAnswers,
} from "./bsLead";

type StepDef = {
  key: "businessType" | "primaryNeed" | "monthlyVolume";
  title: string;
  options: readonly string[];
};

const STEPS: StepDef[] = [
  {
    key: "businessType",
    title: "What kind of business do you run?",
    options: BUSINESS_TYPES,
  },
  {
    key: "primaryNeed",
    title: "What do you need most right now?",
    options: PRIMARY_NEEDS,
  },
  {
    key: "monthlyVolume",
    title: "Roughly how many jobs a month?",
    options: MONTHLY_VOLUMES,
  },
];

const EMPTY: BsIntakeAnswers = {
  businessType: "",
  primaryNeed: "",
  monthlyVolume: "",
  businessName: "",
  name: "",
  phone: "",
  email: "",
};

export function BsIntakeForm({ dark = false }: { dark?: boolean }) {
  const [step, setStep] = useState(0); // 0..2 chips, 3 contact, 4 done
  const [answers, setAnswers] = useState<BsIntakeAnswers>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (key: StepDef["key"], value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    setStep(s => s + 1);
  };

  const contactValid =
    answers.businessName.trim().length > 1 &&
    answers.name.trim().length > 1 &&
    answers.phone.replace(/\D/g, "").length >= 10 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(answers.email.trim());

  const handleSubmit = async () => {
    if (!contactValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitBoreslayLead({
        ...answers,
        businessName: answers.businessName.trim(),
        name: answers.name.trim(),
        phone: answers.phone.trim(),
        email: answers.email.trim(),
      });
      setStep(4);
    } catch (err) {
      console.error("[Boreslay] lead submit failed", err);
      setError("That didn't go through. Give it one more try — or text us and we'll take it from there.");
    } finally {
      setSubmitting(false);
    }
  };

  const headingColor = dark ? "#F5F0E8" : "var(--bs-ink)";
  const subColor = dark ? "rgba(245,240,232,0.72)" : "var(--bs-ink-soft)";

  if (step === 4) {
    return (
      <div className="bs-fade-up" style={{ textAlign: "center", padding: "8px 0" }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 16px",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "rgba(46, 160, 67, 0.15)",
            color: "#2EA043",
          }}
        >
          <Check size={30} strokeWidth={3} />
        </div>
        <h3 className="bs-display" style={{ fontSize: 32, color: headingColor, marginBottom: 10 }}>
          Your first mission is ready to build.
        </h3>
        {BOOKING_URL ? (
          <>
            <p style={{ color: subColor, maxWidth: 440, margin: "0 auto 20px" }}>
              Pick a 15-minute time and Adam will walk you through it — built around{" "}
              {answers.businessName || "your business"}, not a canned pitch.
            </p>
            <a className="bs-cta" href={BOOKING_URL} target="_blank" rel="noreferrer">
              Pick a 15-minute time with Adam
            </a>
          </>
        ) : (
          <p style={{ color: subColor, maxWidth: 440, margin: "0 auto" }}>
            You're in. <strong style={{ color: headingColor }}>Adam will text you within the hour</strong> to
            set up your first mission. No contract. Nothing sends without your approval.
          </p>
        )}
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="bs-fade-up" key="contact">
        <button
          type="button"
          onClick={() => setStep(2)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: 0,
            color: subColor,
            fontSize: 15,
            cursor: "pointer",
            marginBottom: 12,
            padding: 0,
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h3 className="bs-display" style={{ fontSize: 30, color: headingColor, marginBottom: 4 }}>
          Where should the mission go?
        </h3>
        <p style={{ color: subColor, fontSize: 16, marginBottom: 18 }}>
          15 minutes, phone or Zoom. No contract to look.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <input
            className="bs-field"
            placeholder="Business name"
            value={answers.businessName}
            onChange={e => setAnswers(p => ({ ...p, businessName: e.target.value }))}
          />
          <input
            className="bs-field"
            placeholder="Your name"
            value={answers.name}
            onChange={e => setAnswers(p => ({ ...p, name: e.target.value }))}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input
              className="bs-field"
              placeholder="Phone"
              type="tel"
              inputMode="tel"
              value={answers.phone}
              onChange={e => setAnswers(p => ({ ...p, phone: e.target.value }))}
            />
            <input
              className="bs-field"
              placeholder="Email"
              type="email"
              inputMode="email"
              value={answers.email}
              onChange={e => setAnswers(p => ({ ...p, email: e.target.value }))}
            />
          </div>
          {error ? (
            <p style={{ color: "#E5484D", fontSize: 15, margin: 0 }}>{error}</p>
          ) : null}
          <button
            type="button"
            className="bs-cta"
            style={{ width: "100%", opacity: contactValid ? 1 : 0.55 }}
            disabled={!contactValid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Sending…" : "Show Me My First Customer Mission"}
            {!submitting && <ArrowRight size={20} />}
          </button>
          <p style={{ color: subColor, fontSize: 13.5, textAlign: "center", margin: 0 }}>
            We text you, nobody else does. No spam, no list-selling.
          </p>
        </div>
      </div>
    );
  }

  const current = STEPS[step];
  return (
    <div className="bs-fade-up" key={current.key}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "none",
              border: 0,
              color: subColor,
              cursor: "pointer",
              padding: 0,
            }}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <span className="bs-mono" style={{ fontSize: 13, color: subColor }}>
          {step + 1} / 4
        </span>
      </div>
      <h3 className="bs-display" style={{ fontSize: 30, color: headingColor, marginBottom: 18 }}>
        {current.title}
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {current.options.map(option => (
          <button
            key={option}
            type="button"
            className="bs-chip"
            data-selected={answers[current.key] === option}
            onClick={() => pick(current.key, option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BsIntakeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prev;
    };
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Get your first revenue mission"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(26, 23, 18, 0.62)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bs-fade-up"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          maxHeight: "90dvh",
          overflowY: "auto",
          borderRadius: 18,
          background: "var(--bs-bg)",
          border: "1px solid var(--bs-line)",
          padding: "28px 26px",
          boxShadow: "0 30px 80px rgba(26,23,18,0.35)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            display: "grid",
            placeItems: "center",
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid var(--bs-line)",
            background: "var(--bs-surface)",
            color: "var(--bs-ink-soft)",
            cursor: "pointer",
          }}
        >
          <X size={18} />
        </button>
        <BsIntakeForm />
      </div>
    </div>
  );
}
