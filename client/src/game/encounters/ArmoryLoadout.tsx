import { useState } from "react";
import { BookOpen, Info, Loader2, ShieldQuestion } from "lucide-react";
import type { ArmoryWeapon } from "../../../../server/armory/armoryTypes";

/**
 * Compact encounter loadout: at most three choices, each showing where the
 * move came from. Trainer teaching and the player's own evidence are shown as
 * two separate statements — never blended into a single confidence claim.
 *
 * Detailed provenance expands on tap and can always be collapsed, so it can
 * never trap the player inside the encounter.
 */
export function ArmoryLoadout(props: {
  weapons: ArmoryWeapon[];
  isLoading: boolean;
  trainerIntelligenceAvailable: boolean;
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (weapon: ArmoryWeapon) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (props.isLoading) {
    return (
      <div className="armory-loadout is-loading">
        <Loader2 /> LOADING ARMORY…
      </div>
    );
  }

  if (!props.weapons.length) {
    return (
      <div className="armory-loadout is-empty">
        <ShieldQuestion />
        <b>NO WEAPONS FOR THIS CONTEXT</b>
        <small>
          No sourced framework or baseline move matches this objection on this
          channel yet.
        </small>
      </div>
    );
  }

  return (
    <div className="armory-loadout" aria-label="Armory weapons">
      {!props.trainerIntelligenceAvailable ? (
        <p className="armory-zero-state">
          No trainer intelligence sourced yet — these are baseline moves.
        </p>
      ) : null}
      {props.weapons.map(weapon => {
        const expanded = expandedId === weapon.id;
        const line =
          weapon.spokenLine ?? weapon.discoveryQuestion ?? weapon.principle ?? "";
        return (
          <article
            key={weapon.id}
            className={`armory-weapon is-${weapon.fit}${
              props.selectedId === weapon.id ? " is-selected" : ""
            }`}
          >
            <button
              className="armory-weapon-main"
              disabled={props.disabled}
              onClick={() => props.onSelect(weapon)}
            >
              <small>
                {weapon.fit} fit ·{" "}
                {weapon.provenance.type === "trainer_source"
                  ? "sales intel"
                  : weapon.provenance.type === "foundation"
                    ? "foundation"
                    : "your evidence"}
              </small>
              <b>{weapon.title}</b>
              <span>{line}</span>
              {weapon.fitReason ? (
                <i className="armory-weapon-why">{weapon.fitReason}</i>
              ) : null}
              {weapon.personalEvidence ? (
                <em className={`evidence-${weapon.personalEvidence.confidence}`}>
                  YOUR EVIDENCE · {weapon.personalEvidence.uses} use
                  {weapon.personalEvidence.uses === 1 ? "" : "s"} ·{" "}
                  {weapon.personalEvidence.confidence.toUpperCase()}
                </em>
              ) : null}
            </button>

            <button
              className="armory-weapon-provenance-toggle"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} source for ${weapon.title}`}
              onClick={() => setExpandedId(expanded ? null : weapon.id)}
            >
              <Info />
            </button>

            {expanded ? (
              <div className="armory-weapon-provenance">
                {weapon.provenance.type === "trainer_source" ? (
                  <>
                    <small>FROM SALES INTEL</small>
                    <dl>
                      <dt>Trainer</dt>
                      <dd>
                        {weapon.provenance.creator}
                        {weapon.provenance.creatorHandle
                          ? ` (${weapon.provenance.creatorHandle})`
                          : ""}
                      </dd>
                      <dt>Framework</dt>
                      <dd>{weapon.provenance.frameworkName}</dd>
                      <dt>Source</dt>
                      <dd>
                        {weapon.provenance.sourceUrl ? (
                          <a
                            href={weapon.provenance.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {weapon.provenance.sourceType}
                          </a>
                        ) : (
                          weapon.provenance.sourceType
                        )}
                      </dd>
                      {weapon.provenance.transcriptStartMs !== null ? (
                        <>
                          <dt>Transcript</dt>
                          <dd>
                            {Math.round(
                              weapon.provenance.transcriptStartMs / 1000
                            )}
                            s
                          </dd>
                        </>
                      ) : null}
                    </dl>
                    {weapon.exampleLanguage.length ? (
                      <ul className="armory-phrases">
                        {weapon.exampleLanguage.map((phrase, index) => (
                          <li key={index} className={`is-${phrase.kind}`}>
                            <BookOpen />
                            <span>
                              <small>
                                {phrase.kind === "exact_source_phrase"
                                  ? "EXACT SOURCE PHRASE"
                                  : "PARAPHRASED PRINCIPLE"}
                              </small>
                              {phrase.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}

                {weapon.provenance.type === "foundation" ? (
                  <>
                    <small>FOUNDATION MOVE</small>
                    <p>
                      A baseline move, not trainer doctrine. {weapon.principle}
                    </p>
                  </>
                ) : null}

                {weapon.personalEvidence ? (
                  <div className="armory-personal-evidence">
                    <small>YOUR EVIDENCE</small>
                    <p>{weapon.personalEvidence.summary}</p>
                    <ul>
                      <li>Used: {weapon.personalEvidence.uses}</li>
                      <li>
                        Follow-ups observed after use:{" "}
                        {weapon.personalEvidence.followUpsObserved}
                      </li>
                      <li>
                        Wins observed after use:{" "}
                        {weapon.personalEvidence.winsObserved}
                      </li>
                    </ul>
                    <em>
                      Observed alongside your use — not a measure of what caused
                      the result.
                    </em>
                  </div>
                ) : (
                  <div className="armory-personal-evidence is-empty">
                    <small>YOUR EVIDENCE</small>
                    <p>You have not used this yet.</p>
                  </div>
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
