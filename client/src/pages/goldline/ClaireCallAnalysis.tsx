import { FormEvent, useMemo, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { ClaireAnalysisInbox } from "@/components/goldline/ClaireAnalysisInbox";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default function ClaireCallAnalysis({ sessionId }: { sessionId: string }) {
  const detail = trpc.system.claire.callAnalysis.useQuery(
    { sessionId },
    { staleTime: 10_000 }
  );
  const audio = trpc.system.claire.callAudio.useQuery(
    { sessionId },
    { enabled: Boolean(detail.data?.audioAvailable), staleTime: 60_000 }
  );
  const markReviewed = trpc.system.claire.markCallReviewed.useMutation();
  const markWrong = trpc.system.claire.markCallAnalysisWrong.useMutation();
  const [copied, setCopied] = useState<"analysis" | "transcript" | null>(null);
  const [wrongNote, setWrongNote] = useState("");

  const evaluation = asRecord(detail.data?.analysis?.result);
  const moments = Array.isArray(evaluation.notableMoments)
    ? (evaluation.notableMoments as Array<Record<string, unknown>>)
    : [];
  const friction = Array.isArray(evaluation.productFriction)
    ? (evaluation.productFriction as Array<Record<string, unknown>>)
    : [];
  const missing = Array.isArray(evaluation.missingCapabilities)
    ? evaluation.missingCapabilities.map(String)
    : [];

  const understood = useMemo(() => {
    const corrections = Number(evaluation.operatorCorrections ?? 0);
    const objective = String(evaluation.objectiveUnderstood ?? "UNCLEAR");
    if (corrections > 0 && (objective === "YES" || objective === "PARTIAL")) {
      return `AFTER ${corrections} CORRECTION${corrections === 1 ? "" : "S"}`;
    }
    return objective;
  }, [evaluation]);

  async function copy(kind: "analysis" | "transcript") {
    const text =
      kind === "analysis"
        ? detail.data?.copyBundleText ?? ""
        : detail.data?.fullTranscriptText ?? "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
  }

  async function onMarkWrong(event: FormEvent) {
    event.preventDefault();
    const note = wrongNote.trim();
    if (!note) return;
    await markWrong.mutateAsync({ sessionId, note });
    setWrongNote("");
  }

  const session = detail.data?.session;
  const analysis = detail.data?.analysis;

  return (
    <div
      data-testid="claire-call-analysis"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "28px 20px 64px",
        color: "#17385e",
        background: "#fffdf6",
        minHeight: "100%",
      }}
    >
      <ClaireAnalysisInbox compact />
      <p style={{ letterSpacing: "0.18em", fontWeight: 800, fontSize: 12, color: "#9b6410" }}>
        CLAIRE CALL ANALYSIS
      </p>
      <h1 style={{ fontSize: 32, margin: "8px 0 12px" }}>
        {session
          ? new Date(session.startedAt).toLocaleString("en-US", {
              weekday: "long",
              hour: "numeric",
              minute: "2-digit",
            })
          : "Loading analysis"}
      </h1>
      <p>
        <Link href="/claire" style={{ color: "#17385e" }}>
          Back to Claire
        </Link>
      </p>
      {detail.isLoading ? <p>Loading this call…</p> : null}
      {detail.error ? <p>{detail.error.message}</p> : null}
      {session ? (
        <>
          <p data-testid="claire-call-meta" style={{ color: "#4a6a86" }}>
            Duration{" "}
            {session.endedAt
              ? `${Math.max(
                  0,
                  Math.round(
                    (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000
                  )
                )}s`
              : "in progress"}{" "}
            · {session.conversationKind.replaceAll("_", " ")} · Claire{" "}
            {session.claireCharacterVersion ?? "unknown"} · {session.gitSha ?? "unknown"}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "16px 0 28px" }}>
            <button
              type="button"
              onClick={() => void copy("analysis")}
              style={primaryButton}
            >
              {copied === "analysis" ? "Copied" : "COPY ANALYSIS"}
            </button>
            <button
              type="button"
              onClick={() => void copy("transcript")}
              style={secondaryButton}
            >
              {copied === "transcript" ? "Copied" : "COPY FULL TRANSCRIPT"}
            </button>
          </div>

          <section style={sectionStyle}>
            <h2 style={headingStyle}>WHAT HAPPENED</h2>
            <p>{String(evaluation.summary ?? analysis?.summaryText ?? "Analysis is still running.")}</p>
          </section>

          <section style={sectionStyle}>
            <h2 style={headingStyle}>CLAIRE PERFORMANCE</h2>
            <p>Objective understood: {understood}</p>
            <p>
              Useful next step:{" "}
              {evaluation.usefulNextStepReached == null
                ? "UNKNOWN"
                : evaluation.usefulNextStepReached
                  ? "YES"
                  : "NO"}
            </p>
            <p>Operator corrections: {String(evaluation.operatorCorrections ?? 0)}</p>
            <p>Re-explanations: {String(evaluation.operatorReexplanations ?? 0)}</p>
            <p>
              Possible unsupported claims:{" "}
              {String(evaluation.possibleUnsupportedClaims ?? 0)}
            </p>
            <p>Accepted actions: {analysis?.acceptedActionCount ?? 0}</p>
          </section>

          <section style={sectionStyle}>
            <h2 style={headingStyle}>WHAT WE SHOULD LEARN</h2>
            <p>
              {friction[0]
                ? String(friction[0].summary)
                : missing[0]
                  ? `Missing capability: ${missing[0]}`
                  : "No meaningful product lesson was found."}
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={headingStyle}>ACTION OUTCOME</h2>
            <p>
              Accepted {analysis?.acceptedActionCount ?? 0} · completed{" "}
              {analysis?.completedActionCount ?? 0} · outcomes {analysis?.outcomeCount ?? 0}
            </p>
            <p>
              This overlay is Day Director truth. It is not guessed from the transcript.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={headingStyle}>KEY MOMENTS</h2>
            {moments.length ? (
              moments.map((moment, index) => {
                const ordinal =
                  typeof moment.turnOrdinal === "number" ? moment.turnOrdinal : null;
                return (
                  <button
                    key={`${moment.kind}-${index}`}
                    type="button"
                    onClick={() => {
                      if (ordinal == null) return;
                      document
                        .getElementById(`claire-turn-${ordinal}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                    style={{
                      ...secondaryButton,
                      width: "100%",
                      textAlign: "left",
                      marginBottom: 8,
                    }}
                  >
                    {String(moment.kind ?? "moment")}: {String(moment.summary ?? "")}
                  </button>
                );
              })
            ) : (
              <p>None recorded.</p>
            )}
          </section>

          <section style={sectionStyle}>
            <h2 style={headingStyle}>FULL CONVERSATION</h2>
            <p style={{ fontSize: 13, color: "#4a6a86" }}>
              Live Goldline turns are primary. Post-call audio transcript is secondary.
            </p>
            {(detail.data?.turns ?? []).map(turn => (
              <p
                key={turn.id}
                id={`claire-turn-${turn.ordinal}`}
                data-speaker={turn.speaker}
                data-source={turn.source}
              >
                <strong>{turn.speaker === "OPERATOR" ? "ADAM" : "CLAIRE"}:</strong>{" "}
                {turn.text}
              </p>
            ))}
            {detail.data?.postCallTranscript ? (
              <details style={{ marginTop: 16 }}>
                <summary>Post-call audio transcript</summary>
                <p style={{ whiteSpace: "pre-wrap" }}>{detail.data.postCallTranscript}</p>
              </details>
            ) : null}
          </section>

          {audio.data?.url ? (
            <section style={sectionStyle}>
              <h2 style={headingStyle}>AUDIO</h2>
              <audio controls src={audio.data.url} style={{ width: "100%" }} />
            </section>
          ) : null}

          <section style={sectionStyle}>
            <h2 style={headingStyle}>REVIEW</h2>
            <button
              type="button"
              disabled={markReviewed.isPending || !analysis}
              onClick={() => void markReviewed.mutateAsync({ sessionId })}
              style={secondaryButton}
            >
              MARK REVIEWED
            </button>
            <form onSubmit={event => void onMarkWrong(event)} style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <textarea
                value={wrongNote}
                onChange={event => setWrongNote(event.target.value)}
                rows={3}
                placeholder="What is wrong with this analysis?"
                style={{
                  border: "2px solid #e0bd63",
                  borderRadius: 16,
                  padding: 12,
                  background: "#fffdf2",
                }}
              />
              <button
                type="submit"
                disabled={!wrongNote.trim() || markWrong.isPending || !analysis}
                style={secondaryButton}
              >
                ANALYSIS IS WRONG
              </button>
            </form>
            {markWrong.data?.transcriptUnchanged === true ? (
              <p>Feedback saved. The transcript was not rewritten.</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

const headingStyle: CSSProperties = {
  letterSpacing: "0.14em",
  fontSize: 13,
  margin: "0 0 8px",
};

const sectionStyle: CSSProperties = {
  marginBottom: 28,
};

const primaryButton: CSSProperties = {
  minHeight: 48,
  padding: "0 18px",
  border: 0,
  borderRadius: 14,
  background: "#edaa26",
  color: "#17385e",
  fontWeight: 800,
};

const secondaryButton: CSSProperties = {
  minHeight: 48,
  padding: "0 18px",
  border: "2px solid #17385e",
  borderRadius: 14,
  background: "#fffdf6",
  color: "#17385e",
  fontWeight: 800,
};
