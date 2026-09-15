import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Desktop Claire — same operator, same brain, richer form factor.
 * This is not Sage and not a second identity.
 */
export default function ClaireDesk() {
  const [utterance, setUtterance] = useState("");
  const [log, setLog] = useState<Array<{ role: "you" | "claire"; text: string }>>([]);
  const preview = trpc.system.claire.previewPreDrive.useQuery(
    { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { staleTime: 15_000 }
  );
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
    </div>
  );
}
