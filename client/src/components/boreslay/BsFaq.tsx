import { ChevronDown } from "lucide-react";
import { useState } from "react";

const FAQS = [
  {
    q: "I'm not technical. Can I actually run this?",
    a: "If you can read a text message and reply YES or NO, you can run BORESLAY. Setup is done with you on a call, and after that the product hands you one next action a day. There is nothing to configure and no dashboard homework.",
  },
  {
    q: "Is this another marketing agency?",
    a: "No. Agencies charge $1,500+ a month, take weeks to start, and send you reports about impressions. BORESLAY goes out and gets business — new customers, reviews, win-backs, follow-up — and reports in dollars booked. You see every message before it goes out.",
  },
  {
    q: "What if it doesn't pay for itself?",
    a: "The math is public: at typical job sizes, 2–3 recovered customers cover the month. On your first call Adam builds your first mission from your real numbers — if the math doesn't work for your shop, he'll tell you that on the call and you keep your money.",
  },
  {
    q: "Do messages send without my OK?",
    a: "Never. Every mission is staged for your approval — you read the exact texts and emails before anything leaves the building. No surprise blasts, no AI freelancing with your customers.",
  },
  {
    q: "Am I signing a contract?",
    a: "A three-month initial commitment, then month-to-month. No annual contract, no cancellation fee. Three months exists because campaigns need a few cycles to show their real numbers.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1.5px solid var(--bs-line)", borderRadius: 14, background: "var(--bs-surface)" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          padding: "18px 20px",
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "var(--bs-ink)",
          fontSize: 17.5,
          fontWeight: 600,
          fontFamily: "inherit",
        }}
      >
        {q}
        <ChevronDown
          size={20}
          style={{
            flexShrink: 0,
            color: "var(--bs-ink-soft)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease",
          }}
        />
      </button>
      {open ? (
        <p style={{ padding: "0 20px 18px", margin: 0, color: "var(--bs-ink-soft)", fontSize: 16.5 }}>{a}</p>
      ) : null}
    </div>
  );
}

export function BsFaq() {
  return (
    <section id="faq" style={{ padding: "76px 0 8px" }}>
      <div className="bs-container" style={{ maxWidth: 760 }}>
        <h2 className="bs-display" style={{ fontSize: "clamp(36px, 5vw, 54px)", margin: "0 0 28px" }}>
          Fair questions
        </h2>
        <div style={{ display: "grid", gap: 12 }}>
          {FAQS.map(f => (
            <FaqItem key={f.q} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}
