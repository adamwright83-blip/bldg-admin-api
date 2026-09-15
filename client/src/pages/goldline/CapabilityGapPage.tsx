import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

export default function CapabilityGapPage({ gapId }: { gapId: string }) {
  const detail = trpc.system.claire.capabilityGap.useQuery(
    { id: gapId },
    { staleTime: 5_000 }
  );
  const continueEngineering = trpc.system.claire.continueCapabilityEngineering.useMutation();
  const gap = detail.data;
  const terminal = gap?.terminalResultJson ?? {};

  return (
    <div
      data-testid="capability-engineering-request"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "28px 20px 64px",
        color: "#17385e",
        background: "#fffdf6",
        minHeight: "100%",
      }}
    >
      <p style={{ letterSpacing: "0.18em", fontWeight: 800, fontSize: 12, color: "#9b6410" }}>
        ENGINEERING REQUEST
      </p>
      <h1 style={{ fontSize: 32, margin: "8px 0 12px" }}>
        {gap?.capabilityKey ?? "Capability gap"}
      </h1>
      <p>
        <Link href="/claire" style={{ color: "#17385e" }}>
          Back to Claire
        </Link>
      </p>
      {detail.isLoading ? <p>Loading engineering request…</p> : null}
      {detail.error ? <p>{detail.error.message}</p> : null}
      {gap ? (
        <div style={{ display: "grid", gap: 14, fontSize: 16, lineHeight: 1.45 }}>
          <p>
            <strong>Status:</strong> {gap.status}
          </p>
          <p>
            <strong>Original request:</strong> {gap.operatorRequest}
          </p>
          <p>
            <strong>Summary:</strong> {String(terminal.summary ?? gap.blocker ?? "No terminal summary yet.")}
          </p>
          {gap.blocker ? (
            <p>
              <strong>Blocker:</strong> {gap.blocker}
            </p>
          ) : null}
          {terminal.tests ? (
            <p>
              <strong>Tests:</strong> {String(terminal.tests)}
            </p>
          ) : null}
          {gap.branch ? (
            <p>
              <strong>Branch:</strong> {gap.branch}
            </p>
          ) : null}
          {gap.prUrl ? (
            <p>
              <strong>PR:</strong>{" "}
              <a href={gap.prUrl} target="_blank" rel="noreferrer">
                {gap.prUrl}
              </a>
            </p>
          ) : null}
          <p>
            <strong>Session:</strong> {gap.engineeringSessionId ?? "not started"}
          </p>
          {gap.status === "NEEDS_HUMAN" ? (
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                disabled={continueEngineering.isPending}
                onClick={() =>
                  void continueEngineering.mutateAsync({ id: gap.id, approve: true })
                }
                style={{
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 12,
                  border: 0,
                  background: "#17385e",
                  color: "#fff8dc",
                  fontWeight: 800,
                }}
              >
                APPROVE CONTINUATION
              </button>
              <button
                type="button"
                disabled={continueEngineering.isPending}
                onClick={() =>
                  void continueEngineering.mutateAsync({ id: gap.id, approve: false })
                }
                style={{
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 12,
                  border: "2px solid #17385e",
                  background: "transparent",
                  color: "#17385e",
                  fontWeight: 800,
                }}
              >
                DECLINE
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
