import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  BEVERLY_HANGER_ID,
  type OutreachSubmission,
} from "@shared/beverlyHillsOutreach";
import styles from "./other-rodeo.module.css";
import { useDialogFocus } from "./useDialogFocus";
export function OutreachJournal({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: (n: number) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(dialog, true);
  const query = trpc.system.goldlineWorld.beverlyHillsOutreach.useQuery(
    undefined,
    { retry: false, refetchOnWindowFocus: true }
  );
  const submit =
    trpc.system.goldlineWorld.submitBeverlyHillsOutreach.useMutation();
  const review =
    trpc.system.goldlineWorld.reviewBeverlyHillsOutreach.useMutation();
  const requestId = useRef(crypto.randomUUID());
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (query.data) onRestored(query.data.restoredPlots);
  }, [query.data?.restoredPlots, onRestored]);
  const data = query.data;
  const building =
    data?.buildings.find(p => p.id === selected) ?? data?.buildings[0];
  async function refresh() {
    const next = await query.refetch();
    if (next.data) onRestored(next.data.restoredPlots);
  }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!building) return;
    const form = new FormData(event.currentTarget);
    setMessage("");
    const input: OutreachSubmission = {
      requestId: requestId.current,
      prospectId: building.id,
      performedOn: String(form.get("date")),
      permission: String(form.get("permission")),
      count: Number(form.get("count")),
      evidenceUrl: String(form.get("evidence")),
      notes: String(form.get("notes")),
    };
    try {
      await submit.mutateAsync(input);
      requestId.current = crypto.randomUUID();
      setMessage(
        "Visit saved. The ranch grows when someone at that building orders."
      );
      await refresh();
    } catch {
      setMessage("The report was not saved. Check the details and try again.");
    }
  }
  return (
    <div className={styles.modalShade}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-title"
        className={styles.journal}
      >
        <button
          className={styles.close}
          onClick={onClose}
          aria-label="Close Claire’s journal"
        >
          ×
        </button>
        <div className={styles.eyebrow}>
          Claire’s field notes · Laundry Farm
        </div>
        <h2 id="journal-title">A place worth caring for.</h2>
        <p className={styles.lede}>
          Help a real building discover Laundry Farm. When a new order comes
          from a building you visited, another piece of the ranch comes back.
        </p>
        <div className={styles.missionRibbon}>
          <span>01</span>
          <div>
            <strong>One building. A thoughtful first visit.</strong>
            <p>
              Ask the property manager for permission to distribute door
              hangers. Use the same approved printed hanger at every building.
              Record where, when, and how many.
            </p>
          </div>
        </div>
        {query.isLoading ? (
          <p role="status">Opening the building records…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>
              The outreach ledger could not be reached. Your adventure is saved;
              real activity has not been recorded.
            </p>
            <button onClick={() => void query.refetch()}>Try again</button>
          </div>
        ) : (
          <>
            {data?.tenantId !== "laundry_farm" && (
              <p className={styles.notice}>
                Select Laundry Farm in JOYSTICK to record this mission. These
                records belong to {data?.brandName}.
              </p>
            )}
            {!data?.readable ? (
              <p role="alert">
                Building records are unavailable. No recommendations can be
                confirmed right now.
              </p>
            ) : !building ? (
              <p>
                No Beverly Hills apartment prospects are on file for{" "}
                {data?.brandName}. Add a real apartment building in your
                commercial accounts to prepare this mission. No sample addresses
                have been added.
              </p>
            ) : (
              <>
                <label>
                  Choose a building
                  <select
                    value={building.id}
                    onChange={e => setSelected(e.target.value)}
                  >
                    {data?.buildings.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.building}>
                  <strong>{building.name}</strong>
                  <p>{building.address}</p>
                  <small>
                    Suggested because it is an apartment prospect in your
                    business records. Permission and suitability still need
                    checking.
                  </small>
                  {building.navigationUrl && (
                    <a
                      href={building.navigationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Plan the walk ↗
                    </a>
                  )}
                </div>
                <details>
                  <summary>Record a completed, permitted visit</summary>
                  <form onSubmit={e => void send(e)}>
                    <div className={styles.formPair}>
                      <label>
                        Date
                        <input
                          name="date"
                          type="date"
                          required
                          max={new Date().toLocaleDateString("en-CA", {
                            timeZone: "America/Los_Angeles",
                          })}
                        />
                      </label>
                      <label>
                        Hangers placed
                        <input
                          name="count"
                          type="number"
                          min="1"
                          max="2000"
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Permission received from
                      <input
                        name="permission"
                        minLength={12}
                        maxLength={1000}
                        placeholder="Manager’s name, date, and permitted area"
                        required
                      />
                    </label>
                    <label>
                      Evidence link
                      <input
                        name="evidence"
                        type="url"
                        pattern="https://.*"
                        placeholder="https://… permission and visit record"
                        required
                      />
                    </label>
                    <label>
                      Visit notes
                      <textarea
                        name="notes"
                        minLength={12}
                        maxLength={2000}
                        placeholder="What you completed, where, and any follow-up"
                        required
                      />
                    </label>
                    <label className={styles.check}>
                      <input type="checkbox" required /> I used the same
                      approved Laundry Farm hanger, with no building-specific
                      codes.
                    </label>
                    <button
                      className={styles.primary}
                      disabled={
                        submit.isPending || data?.tenantId !== "laundry_farm"
                      }
                    >
                      {submit.isPending
                        ? "Saving…"
                        : "Record this visit"}
                    </button>
                  </form>
                </details>
                <div className={styles.orderNote}>
                  <strong>
                    {building.recordedOrders} recorded customer order
                    {building.recordedOrders === 1 ? "" : "s"} at this address
                  </strong>
                  <p>
                    Separate native order records, excluding cancellations.
                    Exact address matching only; imported orders may not be
                    included. This is not evidence that outreach caused an
                    order.
                  </p>
                </div>
              </>
            )}
            <div className={styles.eyebrow}>
              {data?.restoredPlots ?? 0} of 6 ranch plots restored · a new order
              at a building you visited
            </div>
            {data?.records.map(r => (
              <article className={styles.report} key={r.id}>
                <strong>{r.address}</strong>
                <p>
                  {r.performedOn} · {r.count} hangers ·{" "}
                  <b>
                    {r.status === "submitted" ? "Visit recorded" : r.status}
                  </b>
                </p>
                <a href={r.evidenceUrl} target="_blank" rel="noreferrer">
                  Review evidence ↗
                </a>
                <p>{r.permission}</p>
                <p>{r.notes}</p>
                {r.reviewNote && <small>{r.reviewNote}</small>}
                {data.canReview &&
                  r.status === "submitted" &&
                  r.operatorId !== data.operatorId && (
                    <div>
                      <label>
                        Review findings
                        <textarea
                          value={reviewNotes[r.id] ?? ""}
                          onChange={e =>
                            setReviewNotes({
                              ...reviewNotes,
                              [r.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                      {(["verified", "rejected"] as const).map(decision => (
                        <button
                          key={decision}
                          disabled={
                            review.isPending ||
                            (reviewNotes[r.id] ?? "").trim().length < 12
                          }
                          onClick={async () => {
                            try {
                              await review.mutateAsync({
                                id: r.id,
                                decision,
                                note: reviewNotes[r.id],
                              });
                              await refresh();
                            } catch {
                              setMessage(
                                "Review could not be saved. Refresh and try again."
                              );
                            }
                          }}
                        >
                          {decision === "verified"
                            ? "Verify activity"
                            : "Return for correction"}
                        </button>
                      ))}
                    </div>
                  )}
              </article>
            ))}
          </>
        )}
        {message && <p role="status">{message}</p>}
        {submit.error && <p role="alert">{submit.error.message}</p>}
        <footer>
          <small>Shared print creative · {BEVERLY_HANGER_ID}</small>
          <button onClick={onClose}>Back to the quiet</button>
        </footer>
      </section>
    </div>
  );
}
