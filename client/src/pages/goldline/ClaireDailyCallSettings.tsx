import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CLAIRE_DAILY_CALL_DEFAULTS, type ClaireDailyCallPurpose } from "../../../../shared/claireDailyCallDefaults";

type Purpose = ClaireDailyCallPurpose;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COPY = {
  morning_readiness: {
    ...CLAIRE_DAILY_CALL_DEFAULTS.morning_readiness,
    title: "Morning readiness calls",
    blurb: "Claire calls to get you ready for the day: today's objective, what she has prepared, anything missing, and your first move. This happens even if nothing needs approval.",
  },
  evening_debrief: {
    ...CLAIRE_DAILY_CALL_DEFAULTS.evening_debrief,
    title: "Evening debrief calls",
    blurb: "Claire calls to hear how the day went, captures new developments, and revises tomorrow and the rest of the week for your approval.",
  },
};

type Status = {
  enabled: boolean;
  grant: null | { weekdays: number[]; localStart: string; localEnd: string; version: number };
  nextScheduled: string | Date | null;
  nextWindow?: string | Date | null;
  recent: Array<{ scheduledFor: string | Date; status: string; placed: boolean }>;
};

function PurposeCard({ purpose, status, timeZone, onChange }: { purpose: Purpose; status: Status | undefined; timeZone: string | null; onChange: () => Promise<unknown> }) {
  const grant = trpc.system.weeklyMission.grantDailyCalls.useMutation();
  const revoke = trpc.system.weeklyMission.revokeDailyCalls.useMutation();
  const copy = COPY[purpose];
  // Recommended schedule preselected; nothing is allowed until the operator presses Allow.
  const [days, setDays] = useState<number[]>([...copy.weekdays]);
  const [start, setStart] = useState(copy.start);
  const [end, setEnd] = useState(copy.end);
  const [message, setMessage] = useState("");
  const busy = grant.isPending || revoke.isPending;
  const run = (fn: () => Promise<unknown>, ok: string | ((result: unknown) => string)) =>
    void (async () => {
      try {
        const result = await fn();
        setMessage(typeof ok === "string" ? ok : ok(result));
        await onChange();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Nothing was changed.");
      }
    })();
  return (
    <fieldset data-testid={`daily-call-${purpose}`} style={{ marginTop: 12 }}>
      <legend>{copy.title}</legend>
      <p>{copy.blurb}</p>
      <p data-testid={`daily-call-${purpose}-state`}>
        {status?.enabled && status.grant
          ? `On: ${status.grant.weekdays.map(d => DAYS[d - 1]).join(", ")}, ${status.grant.localStart}–${status.grant.localEnd} (${timeZone}).`
          : "Off. Claire will not place these calls."}
        {status?.nextScheduled
          ? ` Next call scheduled: ${new Date(status.nextScheduled).toLocaleString()}.`
          : status?.enabled && status.nextWindow
            ? ` First eligible window opens ${new Date(status.nextWindow).toLocaleString()}; the call is scheduled that day.`
            : ""}
      </p>
      {status?.recent?.length ? (
        <p>Recent: {status.recent.slice(0, 3).map(r => `${new Date(r.scheduledFor).toLocaleDateString()} ${r.status}${r.placed ? "" : " (not placed)"}`).join("; ")}</p>
      ) : null}
      <div>
        {DAYS.map((day, i) => (
          <label key={day} style={{ marginRight: 10 }}>
            <input
              type="checkbox"
              checked={days.includes(i + 1)}
              onChange={e => setDays(v => (e.target.checked ? [...v, i + 1] : v.filter(d => d !== i + 1)))}
            />{" "}
            {day.slice(0, 3)}
          </label>
        ))}
      </div>
      <label>
        From <input type="time" value={start} onChange={e => setStart(e.target.value)} />
      </label>{" "}
      <label>
        to <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
      </label>{" "}
      <button
        disabled={busy || !days.length || !timeZone || start >= end}
        onClick={() =>
          run(
            () => grant.mutateAsync({ purpose, weekdays: days, localStart: start, localEnd: end, timeZone: timeZone!, consent: true }),
            result => {
              const r = result as { status?: { nextScheduled: string | Date | null; nextWindow: string | Date | null } };
              return r.status?.nextScheduled
                ? `Verified: ${copy.title.toLowerCase()} allowed. Next call scheduled ${new Date(r.status.nextScheduled).toLocaleString()}.`
                : r.status?.nextWindow
                  ? `Verified: ${copy.title.toLowerCase()} allowed. First window opens ${new Date(r.status.nextWindow).toLocaleString()}.`
                  : `${copy.title} allowed; no upcoming window found for the selected days.`;
            }
          )
        }
      >
        Allow {copy.title.toLowerCase()}
      </button>{" "}
      <button disabled={busy || !status?.enabled} onClick={() => run(() => revoke.mutateAsync({ purpose }), `${copy.title} turned off.`)}>
        Turn off
      </button>
      {message ? <p role="status">{message}</p> : null}
    </fieldset>
  );
}

/** Two independent permissions; neither is implied by the other or by strategy-call consent. */
export function ClaireDailyCallSettings() {
  const status = trpc.system.weeklyMission.dailyCallStatus.useQuery(undefined, { retry: false });
  const data = status.data as (Record<Purpose, Status> & { timeZone: string | null }) | undefined;
  return (
    <details style={{ marginTop: 18 }} data-testid="claire-daily-call-settings">
      <summary>Daily calls with Claire</summary>
      <p>Each call type needs its own permission. Turning one on never turns on the other.</p>
      {(["morning_readiness", "evening_debrief"] as const).map(p => (
        <PurposeCard key={p} purpose={p} status={data?.[p]} timeZone={data?.timeZone ?? null} onChange={() => status.refetch()} />
      ))}
    </details>
  );
}
