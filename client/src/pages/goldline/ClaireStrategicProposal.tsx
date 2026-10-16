import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

/** Authenticated in-app delivery; absence of call consent never hides prepared work. */
export function ClaireStrategicProposal() {
  const query = trpc.system.weeklyMission.preparedProposal.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const respond =
    trpc.system.weeklyMission.respondToPreparedProposal.useMutation();
  const revise = trpc.system.weeklyMission.revisePreparedProposal.useMutation();
  const refresh =
    trpc.system.weeklyMission.refreshPreparedProposal.useMutation();
  const industry =
    trpc.system.weeklyMission.configureStrategicIndustry.useMutation();
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const proposal = query.data?.proposal;
  useEffect(() => {
    setSelected([]);
    setEdits({});
  }, [proposal?.id]);
  const busy =
    respond.isPending ||
    revise.isPending ||
    refresh.isPending ||
    industry.isPending;
  const closed = query.data?.responses.some(
    r => r.action === "reject" || r.action === "revise" || r.action === "defer"
  );
  const approvedIds = query.data?.approvedItemIds ?? [];
  const allApproved = Boolean(
    proposal?.items.length && approvedIds.length === proposal.items.length
  );
  async function decide(action: "approve" | "reject" | "defer", all = false) {
    if (!proposal) return;
    try {
      const result = await respond.mutateAsync({
        proposalId: proposal.id,
        revision: proposal.revision,
        action,
        itemIds:
          action === "approve"
            ? all
              ? proposal.items.map(i => i.id)
              : selected
            : [],
      });
      setMessage(result.speech);
      setSelected([]);
      await query.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The decision could not be saved."
      );
    }
  }
  return (
    <section
      aria-label="Claire's prepared strategy"
      data-testid="claire-strategic-proposal"
      style={{
        border: "1px solid #e0bd63",
        borderRadius: 14,
        padding: 18,
        marginTop: 24,
      }}
    >
      <h2>Claire’s prepared recommendation</h2>
      <label>
        Business industry{" "}
        <select
          value={query.data?.verticalKey ?? "generic"}
          disabled={busy || query.isLoading}
          onChange={e =>
            void (async () => {
              try {
                await industry.mutateAsync({ verticalKey: e.target.value });
                await refresh.mutateAsync();
                setSelected([]);
                setEdits({});
                await query.refetch();
                setMessage(
                  "Industry saved; recommendation refreshed with the available business evidence."
                );
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Industry configuration failed."
                );
              }
            })()
          }
        >
          <option value="generic">Other / universal investigation</option>
          <option value="laundry_fluff_fold">Wash and fold laundry</option>
          <option value="software">Software</option>
        </select>
      </label>
      {query.error && <p role="alert">{query.error.message}</p>}
      {!proposal && (
        <p>
          {query.isLoading
            ? "Loading prepared work…"
            : "No prepared recommendation is available yet."}
        </p>
      )}
      {proposal && (
        <>
          <p>
            {allApproved
              ? "Accepted and verified in the Day Line"
              : closed
                ? "Recommendation closed by operator decision"
                : query.data?.stale
                  ? "Evidence needs refreshing before approval."
                  : "Pending items require operator approval"}{" "}
            · Prepared {new Date(proposal.preparedAt).toLocaleString()}
          </p>
          {proposal.diagnosis.evidence
            .filter(item => item.source === "analyzeBusinessData")
            .map(item => (
              <p
                key={item.id}
                data-testid="claire-source-backed-receipt"
                data-evidence-source="analyzeBusinessData"
              >
                analyzeBusinessData: {String(item.value ?? "")} Receipt {item.id}.
              </p>
            ))}
          {proposal.diagnosis.evidence.some(
            item => item.source === "analyzeBusinessData"
          ) &&
          /\$0\.00/.test(proposal.diagnosis.currentCondition) ? null : (
            <p>{proposal.diagnosis.currentCondition}</p>
          )}
          <p>{proposal.diagnosis.diagnosis}</p>
          <p>
            Strategic hypothesis · Quality review:{" "}
            {proposal.diagnosis.quality.judgment}.{" "}
            {proposal.diagnosis.quality.reasons.join(" ")} Financial impact is
            unproven.
          </p>
          <p>
            <strong>Recommended focus:</strong>{" "}
            {proposal.diagnosis.selectedApproach}
          </p>
          <p>
            <strong>Alternative considered:</strong>{" "}
            {proposal.diagnosis.options[1]?.approach}
          </p>
          <ol>
            {proposal.items.map(item => (
              <li key={item.id} style={{ marginBlock: 12 }}>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy || closed || approvedIds.includes(item.id)}
                    checked={selected.includes(item.id)}
                    onChange={e =>
                      setSelected(ids =>
                        e.target.checked
                          ? [...ids, item.id]
                          : ids.filter(id => id !== item.id)
                      )
                    }
                  />{" "}
                  {item.businessDate}: {item.title}
                  {approvedIds.includes(item.id)
                    ? " · verified in Day Line"
                    : ""}
                </label>
                <p>{item.objective}</p>
                <label>
                  Revise this item{" "}
                  <input
                    value={edits[item.id] ?? item.title}
                    onChange={e =>
                      setEdits(values => ({
                        ...values,
                        [item.id]: e.target.value,
                      }))
                    }
                  />
                </label>{" "}
                <button
                  disabled={
                    busy ||
                    closed ||
                    approvedIds.length > 0 ||
                    !edits[item.id]?.trim()
                  }
                  onClick={() =>
                    void (async () => {
                      try {
                        const changed = await revise.mutateAsync({
                          proposalId: proposal.id,
                          revision: proposal.revision,
                          itemId: item.id,
                          title: edits[item.id]!,
                        });
                        setMessage(changed.opening);
                        setSelected([]);
                        await query.refetch();
                      } catch (error) {
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : "Revision failed."
                        );
                      }
                    })()
                  }
                >
                  Save revision
                </button>
              </li>
            ))}
          </ol>
          <details>
            <summary>Why, evidence, and uncertainty</summary>
            {proposal.diagnosis.options.map(o => (
              <p key={o.id}>
                <strong>{o.approach}:</strong> {o.reason} {o.economics} {o.cost}{" "}
                {o.effort} {o.timeToResults} {o.capacity} {o.risk}{" "}
                {o.reversibility}
              </p>
            ))}
            <p>
              {proposal.diagnosis.localFit} {proposal.diagnosis.industryFit}
            </p>
            <p>{proposal.diagnosis.successMeasures.join(" ")}</p>
            <p>{proposal.diagnosis.revisionTrigger}</p>
            <ul>
              {proposal.uncertainty.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
            <ul>
              {proposal.diagnosis.evidence.map(e => (
                <li key={e.id}>
                  {e.description}: {String(e.value ?? "unknown")} (
                  {e.classification}, {e.quality}, {e.capturedAt}) — {e.source}
                </li>
              ))}
            </ul>
            <p>{proposal.constraints.join("; ")}</p>
          </details>
          {query.data?.responses.length ? (
            <p>
              Recorded decisions:{" "}
              {query.data.responses.map(r => r.action).join(", ")}. Commitments
              are confirmed only by a successful save and readback.
            </p>
          ) : null}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 12,
            }}
          >
            <button
              disabled={
                busy ||
                closed ||
                allApproved ||
                query.data?.stale ||
                !proposal.items.length
              }
              onClick={() => void decide("approve", true)}
            >
              Approve plan
            </button>
            <button
              disabled={busy || closed || query.data?.stale || !selected.length}
              onClick={() => void decide("approve")}
            >
              Approve selected
            </button>
            <button
              disabled={busy || closed || approvedIds.length > 0}
              onClick={() => void decide("reject")}
            >
              Reject
            </button>
            <button
              disabled={busy || closed || approvedIds.length > 0}
              onClick={() => void decide("defer")}
            >
              Defer
            </button>
          </div>
        </>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void (async () => {
            try {
              await refresh.mutateAsync();
              await query.refetch();
              setSelected([]);
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Preparation failed."
              );
            }
          })()
        }
        style={{ marginTop: 12 }}
      >
        {refresh.isPending
          ? "Preparing…"
          : "Refresh evidence and recommendation"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
