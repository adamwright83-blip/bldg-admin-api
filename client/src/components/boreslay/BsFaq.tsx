import { ChevronDown } from "lucide-react";
import { useState } from "react";

const FAQS = [
  {
    q: "I'm not technical. Can I actually run this?",
    a: "Good — it wasn't built for software teams. If you can run a laundromat, a plumbing company, a landscaping crew, or a cleaning route, you can run this. The crew handles the system work and hands you clear missions, decisions, and next steps.",
  },
  {
    q: "Is this a marketing agency?",
    a: "No. No retainer, no account manager, no monthly deck explaining why nothing happened. BORESLAY is software with an AI crew built inside it. Some missions involve outreach, follow-up, reviews, or acquisition — but you're commanding a crew, not renting one.",
  },
  {
    q: "What if it doesn't pay for itself?",
    a: "Then the ledger will say so, in ink. True Net exists so you never have to take our word for what a mission produced. You'll see what it made and what it cost — every time.",
  },
  {
    q: "Do messages send without my approval?",
    a: "Not unless you explicitly turn that on. High-impact or sensitive outreach can be gated behind your approval before anything goes out. You decide how much rope the crew gets.",
  },
  {
    q: "Am I signing a long-term contract?",
    a: "No. Month to month. The game has to earn next month.",
  },
  {
    q: "Is the demo showing real customer activity?",
    a: "No. The public demo runs simulated business outcomes so anyone can play safely. Connected businesses run on their own live data and activity.",
  },
  {
    q: "Will BORESLAY work outside laundromats?",
    a: "It's being built first inside laundromats and service businesses — where the founder operates — then expanded to other owner-run businesses with the same sales, follow-up, payment, and retention fights.",
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
