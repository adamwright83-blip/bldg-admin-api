import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";

/**
 * Slice 3 — the companion roster, read-only. The protected may/may-not
 * contract as data, sourced from docs/goldline/REALITY_BRIDGE.md.
 */
export default function GoldlineCompanionAdmin() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const rosterQuery = trpc.system.goldlineCompanions.roster.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const seedDefaults = trpc.system.goldlineCompanions.seedDefaults.useMutation({
    onSuccess: () => utils.system.goldlineCompanions.roster.invalidate(),
  });

  if (authLoading) return null;
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;

  const roster = rosterQuery.data ?? [];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <Link href="/admin" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back to Admin
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Companions
      </h1>
      <p style={{ color: "#666", marginBottom: 16, maxWidth: 640 }}>
        Each companion's real capability is earned through real field work —
        never a starting option. Their may/may-not rules here are protected
        and sourced from REALITY_BRIDGE.md.
      </p>

      {roster.length === 0 && !rosterQuery.isLoading && (
        <button type="button" onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
          {seedDefaults.isPending ? <Loader2 className="animate-spin" size={14} /> : "Seed default roster"}
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {roster.map(companion => (
          <div key={companion.companionId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>
              {companion.name}
              {companion.unifiedProductPersona && (
                <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>
                  (unified with shipped Dayforge coach persona)
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{companion.fictionTruth}</div>
            <div style={{ fontSize: 12, marginTop: 8 }}>
              <strong>Ability:</strong> {companion.abilityDescription}
            </div>
            <div style={{ display: "flex", gap: 24, marginTop: 8, fontSize: 12 }}>
              <div>
                <strong>May:</strong>
                <ul style={{ margin: "4px 0 0 16px" }}>
                  {companion.may.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>May not:</strong>
                <ul style={{ margin: "4px 0 0 16px" }}>
                  {companion.mayNot.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
