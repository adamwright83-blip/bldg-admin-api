import { useEffect } from "react";
import { Check, ChevronRight, Flag, Sparkles } from "lucide-react";
import type { PlayableMission } from "../state/GameState";
import { getAudioManager } from "../audio/AudioManager";
import { businessVictoryFeedback } from "../audio/haptics";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function VictoryCeremony(props: {
  mission: PlayableMission;
  onLanded: () => void;
}) {
  // This component only mounts for a genuinely verified capture — the
  // stronger, distinct victory pattern is reserved exactly for that.
  useEffect(() => {
    getAudioManager().play("victory_flag");
    businessVictoryFeedback();
  }, []);

  return (
    <section className="victory-ceremony" aria-live="polite">
      <div className="victory-particles" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <small>VICTORY BEAT 1 · AUTHORITATIVE BUSINESS OUTCOME</small>
      <h1>STRONGHOLD CAPTURED</h1>
      <h2>{props.mission.name}</h2>
      <div className="victory-flag">
        <Flag /> HIS
      </div>
      {props.mission.verifiedAnnualValueCents != null ? (
        <strong>
          {money(props.mission.verifiedAnnualValueCents)}/YEAR SECURED
        </strong>
      ) : (
        <strong>ACCOUNT WON · VALUE NOT VERIFIED</strong>
      )}
      <p>
        <Check /> REWARD LANDED · BACKEND VERIFIED
      </p>
      <div className="victory-territory">
        <Sparkles /> WORLD NODE OWNED
      </div>
      <button onClick={props.onLanded}>
        LET THE REWARD LAND <ChevronRight />
      </button>
    </section>
  );
}
