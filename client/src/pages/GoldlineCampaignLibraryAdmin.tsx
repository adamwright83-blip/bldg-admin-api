import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";

/**
 * Slice 1 — the Admin review surface for the growth campaign library.
 * Adam can view, edit, enable, and disable every campaign here without a
 * deploy. See docs/goldline/BUILD_BRIEF_SLICES_1_5.md Slice 1.
 */
export default function GoldlineCampaignLibraryAdmin() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const listQuery = trpc.system.campaignLibrary.list.useQuery(
    { includeDisabled: true },
    { enabled: isAuthenticated }
  );
  const setEnabled = trpc.system.campaignLibrary.setEnabled.useMutation({
    onSuccess: () => utils.system.campaignLibrary.list.invalidate(),
  });
  const patch = trpc.system.campaignLibrary.patch.useMutation({
    onSuccess: () => utils.system.campaignLibrary.list.invalidate(),
  });
  const seedDefaults = trpc.system.campaignLibrary.seedDefaults.useMutation({
    onSuccess: () => utils.system.campaignLibrary.list.invalidate(),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    objective: string;
    completionCondition: string;
    prepLeadDays: string;
  } | null>(null);

  if (authLoading) return null;
  if (!isAuthenticated) return <LoginForm />;

  const campaigns = listQuery.data ?? [];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <Link href="/admin" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back to Admin
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Growth Campaign Library
      </h1>
      <p style={{ color: "#666", marginBottom: 16, maxWidth: 640 }}>
        These are the real growth campaigns Goldline's Mission Director can
        recommend. Enable or disable any of them, or edit the objective,
        completion condition, and prep lead time. Nothing here requires a
        deploy.
      </p>

      {campaigns.length === 0 && !listQuery.isLoading && (
        <button
          type="button"
          onClick={() => seedDefaults.mutate({})}
          disabled={seedDefaults.isPending}
          style={{ padding: "8px 16px", marginBottom: 16 }}
        >
          {seedDefaults.isPending ? <Loader2 className="animate-spin" size={14} /> : "Seed default campaigns"}
        </button>
      )}

      {listQuery.isLoading && <p>Loading…</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {campaigns.map(campaign => {
          const isEditing = editingId === campaign.campaignId;
          return (
            <div
              key={campaign.campaignId}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                opacity: campaign.enabled ? 1 : 0.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{campaign.title}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {campaign.campaignId} · {campaign.missionCategory} · ops task type: {campaign.opsTaskType}
                    {campaign.legacyContract ? ` · legacy: ${campaign.legacyContract}` : ""}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={campaign.enabled}
                    onChange={e =>
                      setEnabled.mutate({
                        campaignId: campaign.campaignId,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  Enabled
                </label>
              </div>

              {isEditing && draft ? (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ fontSize: 12, color: "#666" }}>
                    Objective
                    <textarea
                      value={draft.objective}
                      onChange={e => setDraft({ ...draft, objective: e.target.value })}
                      rows={2}
                      style={{ width: "100%", marginTop: 4 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, color: "#666" }}>
                    Completion condition
                    <textarea
                      value={draft.completionCondition}
                      onChange={e => setDraft({ ...draft, completionCondition: e.target.value })}
                      rows={2}
                      style={{ width: "100%", marginTop: 4 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, color: "#666" }}>
                    Prep lead days
                    <input
                      type="number"
                      min={0}
                      value={draft.prepLeadDays}
                      onChange={e => setDraft({ ...draft, prepLeadDays: e.target.value })}
                      style={{ width: 80, marginLeft: 8 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      disabled={patch.isPending}
                      onClick={() => {
                        patch.mutate({
                          campaignId: campaign.campaignId,
                          patch: {
                            objective: draft.objective,
                            completionCondition: draft.completionCondition,
                            prepLeadDays: Number(draft.prepLeadDays) || 0,
                          },
                        });
                        setEditingId(null);
                      }}
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <div>
                    <strong>Objective:</strong> {campaign.objective}
                  </div>
                  <div>
                    <strong>Completion:</strong> {campaign.completionCondition}
                  </div>
                  <div>
                    <strong>Prep:</strong>{" "}
                    {campaign.prepLeadDays > 0
                      ? `${campaign.prepLeadDays} day(s) ahead — ${campaign.prepCondition ?? ""}`
                      : "none"}
                  </div>
                  <div>
                    <strong>Pocket:</strong> {campaign.pocketKind}, min{" "}
                    {campaign.pocketMinutesMin} minutes
                    {campaign.fallbackVariant
                      ? ` · fallback: ${campaign.fallbackVariant.title} (${campaign.fallbackVariant.pocketMinutesMin}m)`
                      : " · no fallback"}
                  </div>
                  <div>
                    <strong>Goldline verifies:</strong>{" "}
                    {campaign.autoVerifiable.length
                      ? campaign.autoVerifiable.join("; ")
                      : "nothing automatically"}
                  </div>
                  <div>
                    <strong>Adam confirms:</strong> {campaign.selfReported.join("; ")}
                  </div>
                  <button
                    type="button"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setEditingId(campaign.campaignId);
                      setDraft({
                        objective: campaign.objective,
                        completionCondition: campaign.completionCondition,
                        prepLeadDays: String(campaign.prepLeadDays),
                      });
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
