import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Claire Intelligence Repair Part 2, Slice A: the routing audit, live.
 *
 * Admin-only and read-only. It answers one question from production data
 * rather than from reading code: which answer path produced each turn, and
 * what share never reached the repaired conversational path. The page is
 * deliberately plain — it is a measurement instrument, not a dashboard.
 */

const PATH_NOTES: Record<string, string> = {
  business_reader: "Deterministic renderer prose (businessSpeech).",
  day_work: "Deterministic renderer prose (speakDayWork).",
  unpaid_orders: "Deterministic renderer prose (speakUnpaidOrders).",
  account_history: "Deterministic renderer prose (speakAccountHistory).",
  account_disambiguation: "Hand-written disambiguation sentence.",
  memory_quote: "Operator's own words, quoted back.",
  encyclopedia: "Tool concatenation, or a capped rewrite of it.",
  commitment: "Day Director single-item loop.",
  briefing: "Briefing parse / propose / commit.",
  account_follow_up: "Account follow-up proposal or commit.",
  doctrine: "Proactive board doctrine answer.",
  proactive_board: "Proactive morning board brief.",
  follow_up_model: "The repaired conversational path (PR 1).",
  guard_recovery: "A guard discarded model text; canon rendered instead.",
  fallback: "Conservative fallback or a no-record sentence.",
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** The shape Slice A/C+D write into `answerPathDetailJson`. Loose on purpose — this is a display concern only. */
type ClaireTurnDetail = {
  blend?: { factClause?: boolean; judgmentClause?: boolean } | null;
  synthesisRequired?: boolean;
  evidenceSources?: string[];
};

function asClaireTurnDetail(value: unknown): ClaireTurnDetail {
  return value && typeof value === "object" ? (value as ClaireTurnDetail) : {};
}

export default function ClaireRoutingAudit() {
  const [days, setDays] = useState(30);
  const audit = trpc.system.claire.routingAudit.useQuery(
    { days, limit: 50 },
    { staleTime: 30_000 }
  );

  const byPath = useMemo(() => {
    const rows = audit.data?.distribution ?? [];
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = row.answerPath ?? "unattributed";
      totals.set(key, (totals.get(key) ?? 0) + row.turns);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [audit.data]);

  const total = audit.data?.totalTurns ?? 0;

  const recentDetail = useMemo(
    () => (audit.data?.recent ?? []).map(row => ({ row, detail: asClaireTurnDetail(row.detail) })),
    [audit.data]
  );
  const blendedRecent = recentDetail.filter(({ detail }) => detail.blend?.factClause && detail.blend?.judgmentClause);
  const synthesisRecent = recentDetail.filter(({ detail }) => detail.synthesisRequired);

  return (
    <div style={{ padding: "24px", maxWidth: 1100 }}>
      <h1 style={{ marginBottom: 4 }}>Claire routing audit</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Slice A, measurement only. Which code path produced the sentence the
        operator heard.
      </p>

      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        Window
        <select value={days} onChange={event => setDays(Number(event.target.value))}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>

      {audit.isLoading ? <p>Loading…</p> : null}
      {audit.error ? <p>Could not load the audit: {audit.error.message}</p> : null}

      {audit.data ? (
        <>
          {!audit.data.telemetryEnabled ? (
            <p style={{ padding: 12, border: "1px solid currentColor", borderRadius: 6 }}>
              Answer-path telemetry is <strong>off</strong> for this tenant, so
              this page will stay empty. Turn it on by adding this tenant to{" "}
              <code>{audit.data.flag}</code>.
            </p>
          ) : null}

          <section style={{ marginBottom: 24 }}>
            <h2>Model</h2>
            <p style={{ margin: 0 }}>
              Effective model: <strong>{audit.data.model.effectiveModel}</strong>
            </p>
            <p style={{ margin: 0, opacity: 0.75 }}>
              ANTHROPIC_MODEL_CLAIRE {audit.data.model.anthropicModelClaireSet ? "set" : "not set"} ·
              ANTHROPIC_MODEL {audit.data.model.anthropicModelSet ? "set" : "not set"}
              {!audit.data.model.anthropicModelClaireSet && !audit.data.model.anthropicModelSet
                ? " — production is running the built-in default."
                : ""}
            </p>
            <p style={{ margin: 0, opacity: 0.75 }}>
              Sampling: {audit.data.model.acceptsSampling
                ? "this model accepts temperature, and Claire sends hers."
                : "this model rejects temperature, so Claire sends none."}
            </p>
            <p style={{ margin: 0, opacity: 0.75 }}>
              Thinking: {audit.data.model.thinkingDisabledToMatchBaseline
                ? "this model defaults to thinking on — Claire explicitly disables it to hold today's baseline."
                : "this model already matches today's no-thinking baseline."}
            </p>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Slice G arbiter</h2>
            {audit.data.sliceG.status === "insufficient_data" ? (
              <p style={{ padding: 12, border: "1px solid currentColor", borderRadius: 6 }}>
                Not ready to compare. {audit.data.sliceG.reason} Slice A said this
                gate needs a week of production rows with the routing-telemetry
                flag on. The page will not invent a verdict.
              </p>
            ) : (
              <ul>
                {audit.data.sliceG.observations.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Headline ({total} turns)</h2>
            <ul>
              <li>
                Reached the repaired conversational path:{" "}
                <strong>{percent(audit.data.reachedFollowUpModel.share)}</strong> (
                {audit.data.reachedFollowUpModel.turns})
              </li>
              <li>
                Never reached it:{" "}
                <strong>{percent(audit.data.neverReachedFollowUpModel.share)}</strong> (
                {audit.data.neverReachedFollowUpModel.turns})
              </li>
              <li>
                Spoke deterministic renderer prose verbatim:{" "}
                <strong>{percent(audit.data.rendererProse.share)}</strong> (
                {audit.data.rendererProse.turns})
              </li>
              <li>
                Fell back: <strong>{percent(audit.data.fallbacks.share)}</strong> (
                {audit.data.fallbacks.turns})
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>By answer path</h2>
            <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>Path</th>
                  <th>Turns</th>
                  <th>Share</th>
                  <th>What it is</th>
                </tr>
              </thead>
              <tbody>
                {byPath.map(([path, turns]) => (
                  <tr key={path} style={{ borderTop: "1px solid rgba(128,128,128,0.35)" }}>
                    <td>{path}</td>
                    <td>{turns}</td>
                    <td>{total ? percent(turns / total) : "—"}</td>
                    <td style={{ opacity: 0.75 }}>{PATH_NOTES[path] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>By surface and turn kind</h2>
            <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>Path</th>
                  <th>Reader</th>
                  <th>Surface</th>
                  <th>Turn kind</th>
                  <th>Turns</th>
                </tr>
              </thead>
              <tbody>
                {(audit.data.distribution ?? []).map((row, index) => (
                  <tr key={index} style={{ borderTop: "1px solid rgba(128,128,128,0.35)" }}>
                    <td>{row.answerPath ?? "—"}</td>
                    <td>{row.businessReader ?? "—"}</td>
                    <td>{row.surface ?? "—"}</td>
                    <td>{row.turnKind ?? "—"}</td>
                    <td>{row.turns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Judgment &amp; blended turns (Slice C+D)</h2>
            <p style={{ marginTop: 0, opacity: 0.75 }}>
              From the {recentDetail.length} most recent turns fetched above —
              a sample, not the full window. Answers whether retrieval is
              still stealing a reasoning-required turn: a blended question
              with an empty evidence list, or with{" "}
              <code>synthesisRequired: false</code>, is the architecture
              regressing.
            </p>
            <ul>
              <li>
                Classified as fact + judgment (blended):{" "}
                <strong>{blendedRecent.length}</strong> / {recentDetail.length}
              </li>
              <li>
                Required Claire's own synthesis:{" "}
                <strong>{synthesisRecent.length}</strong> / {recentDetail.length}
              </li>
            </ul>
            {blendedRecent.length ? (
              <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th>When</th>
                    <th>Path</th>
                    <th>Synthesis ran</th>
                    <th>Evidence sources</th>
                  </tr>
                </thead>
                <tbody>
                  {blendedRecent.map(({ row, detail }) => (
                    <tr key={row.id} style={{ borderTop: "1px solid rgba(128,128,128,0.35)" }}>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>{row.answerPath}</td>
                      <td>{detail.synthesisRequired ? "yes" : "NO — check this"}</td>
                      <td>{detail.evidenceSources?.length ? detail.evidenceSources.join(", ") : "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ opacity: 0.75 }}>No blended turns in the recent sample.</p>
            )}
          </section>

          <section>
            <h2>Recent turns</h2>
            <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th>When</th>
                  <th>Path</th>
                  <th>Surface</th>
                  <th>Prompt chars</th>
                  <th>Model requested / served</th>
                  <th>Spoken</th>
                </tr>
              </thead>
              <tbody>
                {(audit.data.recent ?? []).map(row => (
                  <tr key={row.id} style={{ borderTop: "1px solid rgba(128,128,128,0.35)" }}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>
                      {row.answerPath}
                      {row.businessReader ? ` · ${row.businessReader}` : ""}
                      {row.rendererProse ? " · renderer prose" : ""}
                      {asClaireTurnDetail(row.detail).synthesisRequired ? " · synthesized" : ""}
                    </td>
                    <td>{row.surface ?? "—"}</td>
                    <td>{row.promptChars ?? "—"}</td>
                    <td>
                      {row.modelRequested ?? "—"}
                      {row.modelServed && row.modelServed !== row.modelRequested
                        ? ` → ${row.modelServed}`
                        : ""}
                    </td>
                    <td style={{ opacity: 0.75 }}>{row.generatedText?.slice(0, 140) ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
