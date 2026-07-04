import { Compass, Sparkles, Swords, Trophy } from "lucide-react";

const BEATS = [
  {
    icon: Compass,
    title: "You scout the map.",
    body: "Scout sweeps your customer list and your territory for buried treasure: jobs you priced but never landed, regulars who vanished, unpaid balances, prospects worth a first move.",
  },
  {
    icon: Swords,
    title: "You deploy the raid.",
    body: "Sage writes the words — your voice, never corporate. Closer runs the raid and keeps every thread alive while you keep fighting.",
  },
  {
    icon: Sparkles,
    title: "You get called for the boss.",
    body: "When a conversation gets valuable enough to need a human, a Reality Rift opens and the game calls you in — with Sage carrying the history, the objection, and your next line.",
  },
  {
    icon: Trophy,
    title: "The loot drops.",
    body: "A booking. A paid invoice. A regular back on the schedule. Real dollars post to the ledger, Spark levels up, the kingdom grows.",
  },
];

export function BsGameLoop() {
  return (
    <section id="how" style={{ padding: "72px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(30px, 4.4vw, 46px)", margin: "0 0 20px", maxWidth: 760 }}>
          How the game scores points in the real world
        </h2>
        <p style={{ color: "var(--bs-ink-soft)", fontSize: 17, maxWidth: 760, margin: "0 0 40px" }}>
          Every game you've ever loved runs the same loop: scout the map, deploy the squad,
          fight the boss, collect the loot. BORESLAY runs that exact loop. The only difference is
          what's on the other side of the screen — the map is your market, the raid is real
          outreach, and the loot clears your bank.
        </p>

        <div className="bs-loop-grid">
          {BEATS.map((beat, i) => (
            <div key={beat.title} style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bs-navy)", color: "#fff", flexShrink: 0 }}>
                  <beat.icon size={20} />
                </div>
                <span className="bs-mono" style={{ fontSize: 13, color: "var(--bs-ink-soft)" }}>
                  BEAT {i + 1}
                </span>
              </div>
              <h3 className="bs-display" style={{ fontSize: 22, margin: "0 0 8px" }}>{beat.title}</h3>
              <p style={{ color: "var(--bs-ink-soft)", fontSize: 15.5, margin: 0 }}>{beat.body}</p>
            </div>
          ))}
        </div>

        <p style={{ color: "var(--bs-ink)", fontWeight: 700, fontSize: 17, marginTop: 40, maxWidth: 620 }}>
          You never leave the game to go "do marketing." The game is the doing. Playing BORESLAY
          and growing the business are the same physical act.
        </p>
      </div>
    </section>
  );
}
