import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Goldline in-app inbox. Must portal to document.body: Driver Daily Line
 * lives inside `.gdp-shell { overflow: clip }`, which swallows in-flow
 * banners and even `position:fixed` descendants.
 */
export function ClaireAnalysisInbox() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => new Set()
  );
  const utils = trpc.useUtils();
  const inbox = trpc.system.claire.analysisInbox.useQuery(undefined, {
    staleTime: 8_000,
    refetchInterval: 12_000,
    retry: false,
  });
  const markRead =
    trpc.system.claire.markAnalysisNotificationRead.useMutation();
  const items = (inbox.data ?? []).filter(item => !dismissedIds.has(item.id));
  if (!items.length || typeof document === "undefined") return null;

  const dismiss = async (id: string) => {
    setDismissedIds(current => new Set(current).add(id));
    try {
      await markRead.mutateAsync({ id });
      await utils.system.claire.analysisInbox.invalidate();
    } catch {
      setDismissedIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  return createPortal(
    <aside
      data-testid="claire-analysis-inbox"
      role="region"
      aria-label="Goldline notifications"
      style={{
        position: "fixed",
        top: "max(12px, env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        width: "min(440px, calc(100vw - 24px))",
        display: "grid",
        gap: 10,
        padding: 14,
        border: "2px solid #e0bd63",
        borderRadius: 16,
        background: "#fff8dc",
        color: "#17385e",
        boxShadow: "0 18px 40px #04120ccc",
        pointerEvents: "auto",
      }}
    >
      {items.map(item => (
        <div
          key={item.id}
          style={{
            position: "relative",
            display: "grid",
            gap: 8,
            paddingRight: 42,
          }}
        >
          <button
            type="button"
            aria-label={`Dismiss ${item.title}`}
            onClick={() => void dismiss(item.id)}
            style={{
              position: "absolute",
              top: -8,
              right: -8,
              width: 44,
              height: 44,
              display: "grid",
              placeItems: "center",
              border: 0,
              borderRadius: 12,
              background: "transparent",
              color: "#17385e",
              cursor: "pointer",
            }}
          >
            <X size={22} aria-hidden="true" />
          </button>
          <strong style={{ letterSpacing: "0.08em", fontSize: 12 }}>
            {item.title}
          </strong>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
            {item.body}
          </p>
          <Link
            href={item.href}
            onClick={() => {
              void dismiss(item.id);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "0 16px",
              width: "fit-content",
              borderRadius: 12,
              background: "#17385e",
              color: "#fff8dc",
              fontWeight: 800,
              textDecoration: "none",
              letterSpacing: "0.04em",
            }}
          >
            {item.ctaLabel || "VIEW ANALYSIS"}
          </Link>
        </div>
      ))}
    </aside>,
    document.body
  );
}
