import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const toCents = (value: string) => Math.round(Math.max(0, Number(value) || 0) * 100);

const REWARD_LABEL = { pending: "Waiting for a paid order", earned: "Credit owed", applied: "Applied" } as const;

/**
 * Growth → Referrals. CleanCloud businesses get a setup checklist and a copy of CleanCloud's Referral Code Usage
 * list; native POS businesses get JOYSTICK's own codes and referrals. Same activity table for both.
 */
export default function ReferralsPage() {
  const utils = trpc.useUtils();
  const activity = trpc.referrals.activity.useQuery(undefined, { retry: false });
  const save = trpc.referrals.saveProgram.useMutation({ onSuccess: () => utils.referrals.activity.invalidate() });
  const importUsage = trpc.referrals.importCleanCloudUsage.useMutation({ onSuccess: () => utils.referrals.activity.invalidate() });
  const markApplied = trpc.referrals.markCreditApplied.useMutation({ onSuccess: () => utils.referrals.activity.invalidate() });
  const ensureCode = trpc.referrals.ensureCode.useMutation();
  const record = trpc.referrals.recordReferral.useMutation({ onSuccess: () => utils.referrals.activity.invalidate() });

  const program = activity.data?.program;
  const [source, setSource] = useState<"cleancloud" | "joystick">("cleancloud");
  const [referrer, setReferrer] = useState("10.00");
  const [newcomer, setNewcomer] = useState("10.00");
  const [pasted, setPasted] = useState("");
  const [codeFor, setCodeFor] = useState({ name: "", phone: "" });
  const [referral, setReferral] = useState({ code: "", name: "", phone: "" });

  useEffect(() => {
    if (!program) return;
    setSource(program.source);
    setReferrer((program.referrerCreditCents / 100).toFixed(2));
    setNewcomer((program.newCustomerCreditCents / 100).toFixed(2));
  }, [program?.source, program?.referrerCreditCents, program?.newCustomerCreditCents]);

  if (activity.isLoading) return <main className="cr-section-page">Loading referrals…</main>;
  if (activity.error || !activity.data || !program) {
    return <main className="cr-section-page">Referrals couldn't load: {activity.error?.message ?? "no data"}</main>;
  }
  const data = activity.data;
  const on = program.mode === "one_time_credit";
  const saveWith = (patch: Partial<{ mode: "off" | "one_time_credit"; cleancloudSetupConfirmed: boolean }>) =>
    save.mutate({
      source,
      mode: patch.mode ?? program.mode,
      referrerCreditCents: toCents(referrer),
      newCustomerCreditCents: toCents(newcomer),
      cleancloudSetupConfirmed: patch.cleancloudSetupConfirmed,
    });

  return (
    <main className="cr-section-page" style={{ maxWidth: 920 }}>
      <header style={{ marginBottom: 20 }}>
        <p style={{ letterSpacing: ".12em", fontSize: 12, opacity: 0.7 }}>GROWTH · REFERRALS</p>
        <h1 style={{ fontSize: 28, margin: "4px 0" }}>Referrals</h1>
        <p style={{ opacity: 0.8 }}>
          A customer gives a neighbour their code. The neighbour gets {dollars(toCents(newcomer))} off; your customer gets{" "}
          {dollars(toCents(referrer))} once the neighbour's first paid order lands.
        </p>
      </header>

      <section className="cr-card" style={{ padding: 16, marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 12 }}>
          <strong>Where do your customers check out?</strong>
          <select value={source} onChange={e => setSource(e.target.value as "cleancloud" | "joystick")} style={{ display: "block", marginTop: 6 }}>
            <option value="cleancloud">CleanCloud (CleanCloud runs referrals; JOYSTICK reads them)</option>
            <option value="joystick">JOYSTICK POS (JOYSTICK runs referrals)</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label>
            Credit for the customer who refers ($)
            <input inputMode="decimal" value={referrer} onChange={e => setReferrer(e.target.value)} style={{ display: "block", width: 120 }} />
          </label>
          <label>
            Credit for the new customer ($)
            <input inputMode="decimal" value={newcomer} onChange={e => setNewcomer(e.target.value)} style={{ display: "block", width: 120 }} />
          </label>
        </div>

        {source === "cleancloud" ? (
          <div style={{ marginTop: 16 }}>
            <strong>Switch it on in CleanCloud</strong> (about a minute):
            <ol style={{ marginTop: 8, paddingLeft: 20, lineHeight: 1.6 }}>
              {(data.cleancloudSetupSteps.length ? data.cleancloudSetupSteps : []).map(step => (
                <li key={step}>{step.replace("10.00", `${(toCents(referrer) / 100).toFixed(2)}`)}</li>
              ))}
            </ol>
            <button type="button" onClick={() => saveWith({ mode: "one_time_credit", cleancloudSetupConfirmed: true })} disabled={save.isPending}>
              {program.cleancloudSetupConfirmedAt ? "Saved: referrals are on in CleanCloud" : "I've done this in CleanCloud"}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <button type="button" onClick={() => saveWith({ mode: on ? "off" : "one_time_credit" })} disabled={save.isPending}>
              {on ? "Referrals are on. Switch off" : "Switch referrals on"}
            </button>
          </div>
        )}
        {save.error && <p role="alert">{save.error.message}</p>}
      </section>

      {program.source === "joystick" && on && (
        <section className="cr-card" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <form
            onSubmit={e => {
              e.preventDefault();
              ensureCode.mutate({ customerName: codeFor.name, customerPhone: codeFor.phone || undefined });
            }}
          >
            <strong>A customer's code</strong>
            <input placeholder="Customer name" value={codeFor.name} onChange={e => setCodeFor({ ...codeFor, name: e.target.value })} style={{ display: "block", width: "100%", marginTop: 6 }} />
            <input placeholder="Phone" value={codeFor.phone} onChange={e => setCodeFor({ ...codeFor, phone: e.target.value })} style={{ display: "block", width: "100%", marginTop: 6 }} />
            <button type="submit" disabled={!codeFor.name || ensureCode.isPending} style={{ marginTop: 6 }}>Get code</button>
            {ensureCode.data && <p style={{ fontSize: 22, fontWeight: 700 }}>{ensureCode.data.code}</p>}
            {ensureCode.error && <p role="alert">{ensureCode.error.message}</p>}
          </form>
          <form
            onSubmit={e => {
              e.preventDefault();
              record.mutate({ code: referral.code, referredName: referral.name, referredPhone: referral.phone || undefined });
            }}
          >
            <strong>A new customer used a code</strong>
            <input placeholder="Code" value={referral.code} onChange={e => setReferral({ ...referral, code: e.target.value })} style={{ display: "block", width: "100%", marginTop: 6 }} />
            <input placeholder="New customer's name" value={referral.name} onChange={e => setReferral({ ...referral, name: e.target.value })} style={{ display: "block", width: "100%", marginTop: 6 }} />
            <input placeholder="New customer's phone" value={referral.phone} onChange={e => setReferral({ ...referral, phone: e.target.value })} style={{ display: "block", width: "100%", marginTop: 6 }} />
            <button type="submit" disabled={!referral.code || !referral.name || !referral.phone || record.isPending} style={{ marginTop: 6 }}>Record referral</button>
            {record.error && <p role="alert">{record.error.message}</p>}
          </form>
        </section>
      )}

      <section className="cr-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <strong>Referral activity</strong>
          <span style={{ opacity: 0.8 }}>
            {data.converted} became customers{data.earnedUnapplied ? ` · ${data.earnedUnapplied} credits owed` : ""}
          </span>
        </div>
        {data.freshness && (
          <p role={data.freshness.state === "fresh" ? undefined : "alert"} style={{ opacity: 0.85 }}>
            {data.freshness.state === "never"
              ? "Not read from CleanCloud yet. Until it is, an empty list doesn't mean nobody referred."
              : data.freshness.state === "stale"
                ? `Last read from CleanCloud ${data.freshness.hoursAgo} hours ago. Recent referrals may be missing.`
                : `Read from CleanCloud ${data.freshness.hoursAgo} hours ago.`}
          </p>
        )}
        {data.ledgerNote && <p role="alert">{data.ledgerNote}</p>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>From</th><th>To</th><th>Date used</th><th>Orders</th><th>Spending</th><th>Referrer's credit</th>
              </tr>
            </thead>
            <tbody>
              {data.activity.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "12px 0", opacity: 0.7 }}>No referrals yet.</td></tr>
              )}
              {data.activity.map(row => (
                <tr key={row.id} style={{ borderTop: "1px solid rgba(127,127,127,.25)" }}>
                  <td>{row.from}</td>
                  <td>{row.to}</td>
                  <td>{row.usedAt.slice(0, 10)}</td>
                  <td>{row.newCustomerOrders}</td>
                  <td>{dollars(row.newCustomerSpendingCents)}</td>
                  <td>
                    {row.referrerReward === "earned" && row.source === "joystick" ? (
                      <button type="button" onClick={() => markApplied.mutate({ referralId: row.id })} disabled={markApplied.isPending}>
                        {dollars(program.referrerCreditCents)} owed. Mark applied
                      </button>
                    ) : (
                      REWARD_LABEL[row.referrerReward]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {program.source === "cleancloud" && (
          <details style={{ marginTop: 12 }}>
            <summary>Update from CleanCloud by hand</summary>
            <p style={{ opacity: 0.8 }}>
              In CleanCloud, open Invite Codes / Referrals → View Referral Activity, select the whole table, copy it, and paste it here.
              (GumballPals will do this automatically in a later update.)
            </p>
            <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={5} style={{ width: "100%" }} />
            <button type="button" onClick={() => importUsage.mutate({ text: pasted }, { onSuccess: () => setPasted("") })} disabled={!pasted.trim() || importUsage.isPending}>
              Update activity
            </button>
            {importUsage.data && (
              <p>
                Updated {importUsage.data.upserted} referrals.
                {importUsage.data.rejected.length ? ` ${importUsage.data.rejected.length} rows couldn't be read.` : ""}
              </p>
            )}
            {importUsage.error && <p role="alert">{importUsage.error.message}</p>}
          </details>
        )}
      </section>
    </main>
  );
}
