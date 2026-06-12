import { useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * RESIDENT MESSAGE ALARM — mounted on BOTH admin.bldg.chat and driver.bldg.chat.
 *
 * A resident post-order message (cancel / timing change) is a drop-everything
 * event: this banner polls every 10s and, when anything is waiting, takes over
 * the top of the screen with a flashing red bar that cannot be missed. Click →
 * a deliberately bare-bones reply panel: read the ask, type a reply, optionally
 * Approve with a new time (which revises the REAL order), send. Done.
 *
 * Intentionally zero design-system ceremony — speed over polish, per spec.
 */

const FOLLOWUP_LABEL: Record<string, string> = {
  cancel_request: "CANCEL REQUEST",
  return_by_time: "DELIVERY TIME CHANGE",
  pickup_time_change: "PICKUP TIME CHANGE",
  timing_constraint: "TIMING REQUEST",
};

export function ResidentFollowupAlert() {
  const followups = trpc.admin.listResidentFollowups.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const reply = trpc.admin.replyToResidentFollowup.useMutation();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, { message: string; newTime: string }>>({});
  const [lastResult, setLastResult] = useState<string | null>(null);

  const items = followups.data ?? [];
  if (items.length === 0) return null;

  const draftFor = (taskId: number) => drafts[taskId] ?? { message: "", newTime: "" };
  const setDraft = (taskId: number, patch: Partial<{ message: string; newTime: string }>) =>
    setDrafts((prev) => ({ ...prev, [taskId]: { ...draftFor(taskId), ...patch } }));

  const send = async (
    taskId: number,
    decision: "approved" | "declined" | undefined,
    fallbackWindow: string | null,
  ) => {
    const draft = draftFor(taskId);
    const message =
      draft.message.trim() ||
      (decision === "approved"
        ? `Yes — we can do ${draft.newTime.trim() || fallbackWindow || "that"}.`
        : decision === "declined"
          ? "Sorry — we can't make that change for this order."
          : "");
    if (!message) return;
    const newTime = decision === "approved" ? draft.newTime.trim() || fallbackWindow || undefined : undefined;
    const res = await reply.mutateAsync({ taskId, message, decision, newTime: newTime ?? undefined });
    setLastResult(
      `Sent. ${res.orderRevised ? "Order updated. " : ""}${res.residentNotified ? "Resident app notified. " : "App write-back FAILED. "}${res.smsSent ? "SMS sent." : "SMS not sent."}`,
    );
    setDrafts((prev) => ({ ...prev, [taskId]: { message: "", newTime: "" } }));
    await followups.refetch();
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 99999 }}>
      <style>{`
        @keyframes hf-flash {
          0%, 49% { background: #dc2626; }
          50%, 100% { background: #7f1d1d; }
        }
        .hf-banner { animation: hf-flash 0.9s steps(1) infinite; }
      `}</style>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hf-banner"
        style={{
          display: "block",
          width: "100%",
          color: "#fff",
          fontWeight: 900,
          fontSize: 18,
          letterSpacing: 1,
          textAlign: "center",
          padding: "14px 12px",
          border: "none",
          borderBottom: "4px solid #fff",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        🔴 {items.length} resident message{items.length > 1 ? "s" : ""} waiting — tap to reply
      </button>

      {open && (
        <div
          style={{
            background: "#fff",
            borderBottom: "4px solid #dc2626",
            maxHeight: "70vh",
            overflowY: "auto",
            padding: 12,
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
          }}
        >
          {lastResult && (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 8 }}>{lastResult}</div>
          )}
          {items.map((item) => {
            const draft = draftFor(item.taskId);
            return (
              <div
                key={item.taskId}
                style={{ border: "2px solid #dc2626", borderRadius: 8, padding: 12, marginBottom: 10 }}
              >
                <div style={{ fontWeight: 900, color: "#b91c1c", fontSize: 13 }}>
                  {FOLLOWUP_LABEL[item.followupType] ?? "RESIDENT MESSAGE"} — Order #{item.orderId ?? "?"}
                  {item.requestedWindow ? ` — wants ${item.requestedWindow}` : ""}
                </div>
                <div style={{ fontSize: 15, margin: "6px 0", color: "#111" }}>
                  “{item.requestText}”
                </div>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
                  {item.residentName ?? "Resident"} · {item.phone ?? "no phone"} ·{" "}
                  {new Date(item.createdAt).toLocaleTimeString()}
                  {item.deadline ? ` · deadline: ${item.deadline}` : ""}
                </div>
                <textarea
                  value={draft.message}
                  onChange={(e) => setDraft(item.taskId, { message: e.target.value })}
                  placeholder="Type your reply to the resident…"
                  rows={2}
                  style={{
                    width: "100%",
                    border: "1px solid #999",
                    borderRadius: 6,
                    padding: 8,
                    fontSize: 14,
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <input
                    value={draft.newTime}
                    onChange={(e) => setDraft(item.taskId, { newTime: e.target.value })}
                    placeholder={item.requestedWindow ? `time (default ${item.requestedWindow})` : "new time, e.g. 5pm"}
                    style={{ border: "1px solid #999", borderRadius: 6, padding: "8px 10px", fontSize: 14, width: 170 }}
                  />
                  <button
                    type="button"
                    disabled={reply.isPending}
                    onClick={() => void send(item.taskId, "approved", item.requestedWindow)}
                    style={{ background: "#16a34a", color: "#fff", fontWeight: 800, border: "none", borderRadius: 6, padding: "10px 14px", cursor: "pointer" }}
                  >
                    ✓ Approve time (updates order)
                  </button>
                  <button
                    type="button"
                    disabled={reply.isPending}
                    onClick={() => void send(item.taskId, "declined", item.requestedWindow)}
                    style={{ background: "#dc2626", color: "#fff", fontWeight: 800, border: "none", borderRadius: 6, padding: "10px 14px", cursor: "pointer" }}
                  >
                    ✕ Decline
                  </button>
                  <button
                    type="button"
                    disabled={reply.isPending || !draft.message.trim()}
                    onClick={() => void send(item.taskId, undefined, item.requestedWindow)}
                    style={{ background: "#111", color: "#fff", fontWeight: 800, border: "none", borderRadius: 6, padding: "10px 14px", cursor: "pointer" }}
                  >
                    Reply only
                  </button>
                  {reply.isPending && <span style={{ fontSize: 13, fontWeight: 700 }}>Sending…</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
