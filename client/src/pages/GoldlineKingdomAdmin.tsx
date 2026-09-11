import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";

/**
 * Slice 2 — Kingdom sequence overview, plus the Kingdom 3 review surface
 * (§2.4): Adam selects one real campaign from the library. Nothing
 * auto-selects, and no companion is invented here.
 */
export default function GoldlineKingdomAdmin() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const kingdomsQuery = trpc.system.goldlineKingdoms.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const campaignsQuery = trpc.system.campaignLibrary.list.useQuery(
    { includeDisabled: false },
    { enabled: isAuthenticated }
  );
  const seedDefaults = trpc.system.goldlineKingdoms.seedDefaults.useMutation({
    onSuccess: () => utils.system.goldlineKingdoms.list.invalidate(),
  });
  const selectCampaign = trpc.system.goldlineKingdoms.selectCampaign.useMutation({
    onSuccess: () => utils.system.goldlineKingdoms.list.invalidate(),
  });
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [capabilityRequirement, setCapabilityRequirement] = useState("");

  if (authLoading) return null;
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;

  const kingdoms = kingdomsQuery.data ?? [];
  const campaigns = campaignsQuery.data ?? [];
  const kingdom3 = kingdoms.find(k => k.kingdomId === "kingdom-3");

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <Link href="/admin" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back to Admin
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Kingdom Sequence
      </h1>
      <p style={{ color: "#666", marginBottom: 16, maxWidth: 640 }}>
        Each Kingdom connects a real campaign to its fictional field mission,
        Lantern City status, and the companion it earns.
      </p>

      {kingdoms.length === 0 && !kingdomsQuery.isLoading && (
        <button type="button" onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
          {seedDefaults.isPending ? <Loader2 className="animate-spin" size={14} /> : "Seed default Kingdoms"}
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {kingdoms.map(kingdom => (
          <div key={kingdom.kingdomId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>
              {kingdom.sequence}. {kingdom.title}
            </div>
            <div style={{ fontSize: 12, color: "#888" }}>
              {kingdom.kingdomId} · status: {kingdom.lanternCityStatus} · fiction: {kingdom.fictionalFieldMission}
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              <div>
                <strong>Real campaign:</strong>{" "}
                {kingdom.realCampaignId ?? "not yet assigned"}
              </div>
              <div>
                <strong>Companion earned:</strong>{" "}
                {kingdom.companionEarnedId ?? "not yet assigned"}
              </div>
              <div>
                <strong>Driver relevance:</strong> {kingdom.driverDayRelevance}
              </div>
              {kingdom.capabilityRequirement && (
                <div>
                  <strong>Capability requirement:</strong> {kingdom.capabilityRequirement}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {kingdom3 && (
        <div style={{ border: "2px solid #333", borderRadius: 8, padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            Kingdom 3 review — select the real campaign
          </h2>
          {kingdom3.realCampaignId ? (
            <p>
              Selected: <strong>{kingdom3.realCampaignId}</strong>. Capability
              requirement: {kingdom3.capabilityRequirement}
            </p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                Choose one campaign from the enabled library below. This
                records the selection and a capability requirement — it does
                not invent or assign a companion.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {campaigns.map(campaign => (
                  <label key={campaign.campaignId} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                    <input
                      type="radio"
                      name="k3-campaign"
                      value={campaign.campaignId}
                      checked={selectedCampaignId === campaign.campaignId}
                      onChange={() => setSelectedCampaignId(campaign.campaignId)}
                    />
                    <span>
                      <strong>{campaign.title}</strong> — {campaign.objective}
                      <br />
                      <em>Goldline verifies:</em> {campaign.autoVerifiable.join("; ") || "nothing automatically"}
                      {" · "}
                      <em>Adam confirms:</em> {campaign.selfReported.join("; ")}
                    </span>
                  </label>
                ))}
              </div>
              <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 8 }}>
                Capability requirement (which companion ability would make this
                materially easier or viable)
                <textarea
                  value={capabilityRequirement}
                  onChange={e => setCapabilityRequirement(e.target.value)}
                  rows={2}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
              <button
                type="button"
                disabled={!selectedCampaignId || !capabilityRequirement.trim() || selectCampaign.isPending}
                onClick={() =>
                  selectCampaign.mutate({
                    kingdomId: "kingdom-3",
                    realCampaignId: selectedCampaignId,
                    capabilityRequirement: capabilityRequirement.trim(),
                  })
                }
              >
                Record selection
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
