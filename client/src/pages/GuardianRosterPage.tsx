import { allGuardians } from "@shared/goldlineGuardians";
import { GuardianActor } from "@/components/goldline/GuardianActor";
import "@/components/goldline/goldline-territories.css";

export default function GuardianRosterPage() {
  return (
    <main className="gl-guardian-roster" data-testid="goldline-guardian-roster">
      {allGuardians().map(guardian => (
        <article
          key={guardian.id}
          data-testid={`goldline-guardian-card-${guardian.id}`}
          data-silhouette={guardian.silhouette.profile}
        >
          <GuardianActor guardianId={guardian.id} phase="idle" />
          <h3>
            {guardian.name}
            <small style={{ display: "block", fontWeight: 600, opacity: 0.75 }}>
              {guardian.epithet}
            </small>
          </h3>
          <p>{guardian.signatureGimmick}</p>
          <p>{guardian.personality}</p>
        </article>
      ))}
    </main>
  );
}
