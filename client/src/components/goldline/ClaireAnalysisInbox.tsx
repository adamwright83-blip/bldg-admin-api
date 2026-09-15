import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

export function ClaireAnalysisInbox({ compact = false }: { compact?: boolean }) {
  const inbox = trpc.system.claire.analysisInbox.useQuery(undefined, {
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const markRead = trpc.system.claire.markAnalysisNotificationRead.useMutation();
  const items = inbox.data ?? [];
  if (!items.length) return null;

  return (
    <aside
      data-testid="claire-analysis-inbox"
      style={{
        display: "grid",
        gap: 10,
        margin: compact ? "0 0 12px" : "0 0 24px",
        padding: compact ? 12 : 16,
        border: "2px solid #e0bd63",
        borderRadius: 16,
        background: "#fff8dc",
        color: "#17385e",
      }}
    >
      {items.map(item => (
        <div key={item.id} style={{ display: "grid", gap: 8 }}>
          <strong style={{ letterSpacing: "0.08em", fontSize: 12 }}>
            {item.title}
          </strong>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
            {item.body}
          </p>
          <Link
            href={item.href}
            onClick={() => {
              void markRead.mutateAsync({ id: item.id });
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 40,
              padding: "0 14px",
              width: "fit-content",
              borderRadius: 12,
              background: "#17385e",
              color: "#fff8dc",
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            {item.ctaLabel || "VIEW ANALYSIS"}
          </Link>
        </div>
      ))}
    </aside>
  );
}
