import { trpc } from "@/lib/trpc";
import { useState, type FormEvent } from "react";

export default function StrategyPlaygroundSettingsPage() {
  const utils = trpc.useUtils();
  const playground = trpc.strategy.playground.get.useQuery();
  const setRules = trpc.strategy.playground.set.useMutation({
    onSuccess: () => {
      utils.strategy.playground.get.invalidate();
      utils.strategy.spend.monthToDate.invalidate();
    },
  });

  const [ceilingDollars, setCeilingDollars] = useState<string>("");
  const [categories, setCategories] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync initial values once loaded
  if (playground.data && !initialized) {
    setCeilingDollars((playground.data.rules.monthlySpendCeilingCents / 100).toString());
    setCategories(playground.data.rules.approvalCategories);
    setInitialized(true);
  }

  const allPossibleCategories = [
    { id: "paid_ads", label: "Paid Ads (digital campaigns)" },
    { id: "print_order", label: "Print Orders (door tags, flyers)" },
    { id: "vendor_order", label: "Vendor Orders (supplies, partners)" },
    { id: "customer_discount", label: "Customer Discounts" },
    { id: "customer_refund", label: "Customer Refunds" },
    { id: "other", label: "Other External Spending" },
  ];

  function toggleCategory(catId: string) {
    setCategories(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    );
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveSuccess(false);
    const cents = Math.max(0, Math.round(parseFloat(ceilingDollars || "0") * 100));
    await setRules.mutateAsync({
      monthlySpendCeilingCents: cents,
      approvalCategories: categories,
    });
    setSaveSuccess(true);
  }

  if (playground.isLoading) {
    return (
      <div style={{ padding: 24, maxWidth: 640, margin: "0 auto", fontFamily: "sans-serif" }}>
        <p>Loading playground rules...</p>
      </div>
    );
  }

  const rules = playground.data?.rules;
  const goal = playground.data?.macroGoal;
  const spend = playground.data?.spend;

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: "0 auto", fontFamily: "sans-serif", color: "#111" }}>
      <header style={{ marginBottom: 24, borderBottom: "1px solid #eee", paddingBottom: 12 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Playground Rules</h1>
        <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
          Limits and permissions for autonomous strategy and growth operations.
        </p>
      </header>

      {/* Goal Summary */}
      <section style={{ background: "#f8f9fa", border: "1px solid #e9ecef", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Current Growth Goal</h2>
        {goal ? (
          <div>
            <p style={{ margin: "4px 0" }}>
              <strong>Objective:</strong> {goal.objective}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Target:</strong> {goal.targetValue} {goal.metricKey.replace(/_/g, " ")} by {goal.targetDate || "no deadline set"}
            </p>
          </div>
        ) : (
          <p style={{ margin: 0, color: "#888", fontStyle: "italic" }}>No confirmed goal set yet.</p>
        )}
      </section>

      {/* Month-to-Date Spend Summary */}
      <section style={{ background: "#f8f9fa", border: "1px solid #e9ecef", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Month-to-Date Spend ({spend?.businessMonth})</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>Ceiling</div>
            <div style={{ fontSize: 18, fontWeight: "bold" }}>${((spend?.ceilingCents ?? 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>Planned + Committed</div>
            <div style={{ fontSize: 18, fontWeight: "bold" }}>${(((spend?.plannedCents ?? 0) + (spend?.committedCents ?? 0)) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>Remaining</div>
            <div style={{ fontSize: 18, fontWeight: "bold", color: (spend?.remainingCents ?? 0) > 0 ? "#2b8a3e" : "#c92a2a" }}>
              ${((spend?.remainingCents ?? 0) / 100).toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      {/* Settings Form */}
      <form onSubmit={handleSave} style={{ background: "#fff", border: "1px solid #e9ecef", borderRadius: 8, padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="spend-ceiling-input" style={{ display: "block", fontWeight: "bold", marginBottom: 6, fontSize: 14 }}>
            Monthly limit for spending I can do without asking ($ USD)
          </label>
          <input
            id="spend-ceiling-input"
            type="number"
            min="0"
            step="1"
            value={ceilingDollars}
            onChange={e => setCeilingDollars(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 15 }}
          />
          <span style={{ fontSize: 12, color: "#777", display: "block", marginTop: 4 }}>
            If set to 0, no autonomous spending will ever occur without explicit permission.
          </span>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontWeight: "bold", marginBottom: 6, fontSize: 14 }}>
            Categories that always require an explicit yes (even under the limit)
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allPossibleCategories.map(cat => (
              <label key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={categories.includes(cat.id)}
                  onChange={() => toggleCategory(cat.id)}
                />
                {cat.label}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={setRules.isPending}
          style={{
            background: "#1971c2",
            color: "#fff",
            border: "none",
            padding: "10px 18px",
            borderRadius: 6,
            fontWeight: "bold",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          {setRules.isPending ? "Saving..." : "Save Playground Rules"}
        </button>

        {saveSuccess && (
          <span style={{ marginLeft: 12, color: "#2b8a3e", fontSize: 14, fontWeight: "bold" }}>
            Rules saved successfully.
          </span>
        )}
      </form>
    </div>
  );
}
