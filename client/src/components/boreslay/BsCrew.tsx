import { Coins, Compass, Flame, Handshake, ShieldCheck, Target } from "lucide-react";

const CREW = [
  {
    name: "Spark",
    role: "Field Commander",
    desc: "You, in dragon form. Every real win the crew brings home makes Spark stronger. Your business is the power-up.",
    icon: Flame,
  },
  {
    name: "Sage",
    role: "Live Strategist",
    desc: "Fights beside you when a human voice is required. Context, talking points, and the counter to the objection — in your ear, mid-battle.",
    icon: Target,
  },
  {
    name: "Scout",
    role: "Opportunity Hunter",
    desc: "Finds the money you already earned but never collected: dormant customers, cold estimates, open capacity, follow-ups that fell through the cracks.",
    icon: Compass,
  },
  {
    name: "Closer",
    role: "Follow-Through Specialist",
    desc: "Closer does the part you hate. The second message. The third reminder. The \"just checking in\" you were supposed to send last Tuesday. Never tired, never awkward, never forgets — and it keeps going until the customer books, pays, says no, or needs you.",
    icon: Handshake,
  },
  {
    name: "Treasurer",
    role: "True Net Tracker",
    desc: "The one who tells you the truth. Booked revenue minus labor, fuel, supplies, and vendors. Applause is not profit.",
    icon: Coins,
  },
  {
    name: "Guardian",
    role: "Reputation Defender",
    desc: "Runs the review missions, spots the unhappy customer before the one-star lands, and defends the thing that brings you every new job: your name.",
    icon: ShieldCheck,
  },
];

export function BsCrew() {
  return (
    <section id="crew" style={{ padding: "72px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(32px, 4.6vw, 48px)", margin: "0 0 20px" }}>
          The crew comes with the game.
        </h2>
        <div style={{ maxWidth: 720, display: "grid", gap: 14, marginBottom: 36 }}>
          <p style={{ color: "var(--bs-ink-soft)", fontSize: 17 }}>
            The characters you play for fun in every other game do the heavy lifting for real in
            this one.
          </p>
          <p style={{ color: "var(--bs-ink-soft)", fontSize: 16 }}>
            You don't hire them. You don't train them. You don't write prompts, build workflows,
            or learn to "manage AI agents." They're characters. They ship inside the game —
            already trained on the boring work of a service business, already hunting.
          </p>
          <p style={{ color: "var(--bs-ink-soft)", fontSize: 16 }}>
            If you've ever played an RPG, you already know how this works: your party fights
            beside you without being told how to swing. Scout doesn't need a job description.
            Closer doesn't need a Monday standup. Sage doesn't need onboarding.
          </p>
          <p style={{ color: "var(--bs-ink-soft)", fontSize: 16 }}>
            Here is the entire management structure: you press mission buttons. They do mission
            work. The only thing they ever wait for is your thumb — and only where you've told
            them to wait.
          </p>
          <p style={{ color: "var(--bs-ink)", fontWeight: 700, fontSize: 16.5 }}>
            They don't replace you. They un-bury you. Every hour they spend chasing, reminding,
            sorting, and following through is an hour handed back to the only person in the
            building who can't be automated: the owner.
          </p>
        </div>
        <div className="bs-crew-grid">
          {CREW.map(member => (
            <div
              key={member.name}
              style={{
                borderRadius: 14,
                border: "1.5px solid var(--bs-line)",
                background: "var(--bs-surface)",
                padding: "18px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--bs-navy)", color: "#fff" }}>
                  <member.icon size={19} />
                </div>
                <div>
                  <p className="bs-display" style={{ fontSize: 18, margin: 0 }}>{member.name}</p>
                  <p style={{ fontSize: 12.5, color: "var(--bs-ink-soft)", margin: 0 }}>{member.role}</p>
                </div>
              </div>
              <p style={{ fontSize: 14, color: "var(--bs-ink-soft)", margin: 0 }}>{member.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
