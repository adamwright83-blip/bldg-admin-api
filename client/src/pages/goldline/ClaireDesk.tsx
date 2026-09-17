import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Desktop Claire — same operator, same brain, richer form factor.
 * This is not Sage and not a second identity.
 */
export default function ClaireDesk() {
  const [utterance, setUtterance] = useState("");
  const [log, setLog] = useState<Array<{ role: "you" | "claire"; text: string }>>([]);
  const [conversationId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `desk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const preview = trpc.system.claire.previewPreDrive.useQuery(
    { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { staleTime: 15_000 }
  );
  const relationshipClosing =
    trpc.system.claireRelationshipOffboarding.preview.useQuery(undefined, {
      enabled: false,
      retry: false,
    });
  const talk = trpc.system.claire.talk.useMutation();
  const confirmTomorrow = trpc.system.claire.confirmTomorrow.useMutation();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = utterance.trim();
    if (!text || talk.isPending) return;
    setUtterance("");
    setLog(current => [...current, { role: "you", text }]);
    try {
      const result = await talk.mutateAsync({
        utterance: text,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        conversationId,
      });
      setLog(current => [...current, { role: "claire", text: result.reply }]);
    } catch (error) {
      setLog(current => [
        ...current,
        {
          role: "claire",
          text: error instanceof Error ? error.message : "Claire could not answer.",
        },
      ]);
    }
  }

  const workday = preview.data?.workday;

  return (
    <div
      data-testid="claire-desk"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "28px 20px 64px",
        color: "#17385e",
        background: "#fffdf6",
        minHeight: "100%",
      }}
    >
      <p style={{ letterSpacing: "0.18em", fontWeight: 800, fontSize: 12, color: "#9b6410" }}>
        CLAIRE
      </p>
      <h1 style={{ fontSize: 36, margin: "8px 0 12px" }}>Same Claire. Deeper desk.</h1>
      <p style={{ maxWidth: 560, lineHeight: 1.5, color: "#3a5f7e" }}>
        This is not a second brain. Desktop just has room for more of the same
        operator, goals, field outcomes, and campaign truth.
      </p>
      {preview.data?.brief ? (
        <p data-testid="claire-desk-brief" style={{ marginTop: 20, fontSize: 18, lineHeight: 1.45 }}>
          {preview.data.brief}
        </p>
      ) : (
        <p>Loading Claire’s current picture…</p>
      )}
      {workday ? (
        <p data-testid="claire-desk-workday" style={{ color: "#4a6a86" }}>
          {workday.session.replaceAll("_", " ")} · tomorrow items {workday.tomorrowCount} ·
          overnight deltas {workday.deltaCount}
        </p>
      ) : null}
      <button
        type="button"
        disabled={confirmTomorrow.isPending}
        onClick={() =>
          void confirmTomorrow.mutateAsync({
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })
        }
        style={{
          marginTop: 16,
          minHeight: 48,
          padding: "0 18px",
          border: 0,
          borderRadius: 14,
          background: "#17385e",
          color: "#fff8dc",
          fontWeight: 800,
        }}
      >
        {confirmTomorrow.isPending ? "Confirming…" : "Confirm tomorrow"}
      </button>
      <div style={{ marginTop: 28, display: "grid", gap: 12 }}>
        {log.map((entry, index) => (
          <p key={`${entry.role}-${index}`}>
            <strong>{entry.role === "you" ? "You" : "Claire"}:</strong> {entry.text}
          </p>
        ))}
      </div>
      <form onSubmit={event => void onSubmit(event)} style={{ marginTop: 24, display: "grid", gap: 12 }}>
        <textarea
          value={utterance}
          onChange={event => setUtterance(event.target.value)}
          rows={4}
          placeholder="Ask Claire about the field, tomorrow, or the goal."
          style={{
            border: "2px solid #e0bd63",
            borderRadius: 16,
            padding: 16,
            fontSize: 16,
            background: "#fffdf2",
            color: "#17385e",
          }}
        />
        <button
          type="submit"
          disabled={talk.isPending || utterance.trim().length === 0}
          style={{
            minHeight: 52,
            border: 0,
            borderRadius: 14,
            background: "#edaa26",
            color: "#17385e",
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          {talk.isPending ? "Claire is thinking…" : "Talk to Claire"}
        </button>
      </form>

      <details
        data-testid="claire-relationship-closing"
        style={{
          marginTop: 48,
          borderTop: "1px solid #e4d7b0",
          paddingTop: 20,
          color: "#3a5f7e",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontWeight: 800,
            color: "#17385e",
          }}
        >
          Relationship closing
        </summary>
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Preview the safe closing record Claire can produce from verified shared
            history and things you explicitly told her. It never deletes or changes
            orders, customers, revenue, routes, or other business records.
          </p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
            This is a preview only. Generating it does not disable future relationship
            context or delete stored history.
          </p>
          <button
            type="button"
            disabled={relationshipClosing.isFetching}
            onClick={() => void relationshipClosing.refetch()}
            style={{
              justifySelf: "start",
              minHeight: 44,
              padding: "0 16px",
              border: "1px solid #c8a34a",
              borderRadius: 12,
              background: "#fff9e6",
              color: "#17385e",
              fontWeight: 800,
            }}
          >
            {relationshipClosing.isFetching
              ? "Building closing record…"
              : "Preview relationship closing"}
          </button>
          {relationshipClosing.error ? (
            <p role="alert" style={{ margin: 0, color: "#8b2f24" }}>
              {relationshipClosing.error.message}
            </p>
          ) : null}
          {relationshipClosing.data ? (
            <div
              data-testid="claire-relationship-closing-preview"
              style={{
                border: "1px solid #e0bd63",
                borderRadius: 14,
                background: "#fffdf2",
                padding: 16,
              }}
            >
              <p style={{ margin: 0, lineHeight: 1.55 }}>
                {relationshipClosing.data.closingMessage}
              </p>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6a7890" }}>
                Business records: preserved · eligible history items: {relationshipClosing.data.eligibleHistoryIds.length}
              </p>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}