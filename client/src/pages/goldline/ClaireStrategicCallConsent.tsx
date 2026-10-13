import { useState } from "react";
import { trpc } from "@/lib/trpc";
export function ClaireStrategicCallConsent() {
  const status = trpc.system.weeklyMission.strategicCallConsent.useQuery(
    undefined,
    { retry: false }
  );
  const grant = trpc.system.weeklyMission.grantStrategicCalls.useMutation();
  const revoke = trpc.system.weeklyMission.revokeStrategicCalls.useMutation();
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [message, setMessage] = useState("");
  const saved = status.data?.authorization;
  const savedDays: number[] = saved
    ? ((typeof saved.allowedWeekdaysJson === "string"
        ? JSON.parse(saved.allowedWeekdaysJson)
        : saved.allowedWeekdaysJson) as number[])
    : [];
  const busy = grant.isPending || revoke.isPending;
  return (
    <details style={{ marginTop: 18 }}>
      <summary>Optional weekday strategy calls</summary>
      <p>
        Claire prepares recommendations in the app automatically. Allow calls to
        your verified operator phone only on the selected days and within this
        business time window. One call per day. You can revoke permission here.
      </p>
      <p>
        Business timezone: {status.data?.timeZone ?? "not configured"}.{" "}
        {status.data?.authorization
          ? "Weekday call permission is active."
          : "No weekday call permission is active."}
      </p>
      {saved && (
        <p data-testid="saved-strategic-consent">
          Saved permission:{" "}
          {savedDays
            .map(
              day =>
                ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][
                  day - 1
                ]
            )
            .join(", ")}
          , {saved.allowedLocalStart}–{saved.allowedLocalEnd} in{" "}
          {saved.timeZone}; maximum {saved.dailyLimit} call(s) per day.
        </p>
      )}
      <p>
        The fields below define a replacement window. Permission changes only
        when you save it.
      </p>
      <fieldset>
        <legend>Allowed weekdays</legend>
        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(
          (day, i) => (
            <label key={day} style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={days.includes(i + 1)}
                onChange={e =>
                  setDays(values =>
                    e.target.checked
                      ? [...values, i + 1]
                      : values.filter(d => d !== i + 1)
                  )
                }
              />{" "}
              {day}
            </label>
          )
        )}
      </fieldset>
      <label>
        Local start{" "}
        <input
          type="time"
          value={start}
          onChange={e => setStart(e.target.value)}
        />
      </label>{" "}
      <label>
        Local end{" "}
        <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
      </label>{" "}
      <button
        disabled={
          busy || !days.length || !status.data?.timeZone || start >= end
        }
        onClick={() =>
          void (async () => {
            try {
              await grant.mutateAsync({
                weekdays: days,
                localStart: start,
                localEnd: end,
                timeZone: status.data!.timeZone!,
                dailyLimit: 1,
                consent: true,
              });
              setMessage("Weekday call permission saved and verified.");
              await status.refetch();
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Permission was not saved."
              );
            }
          })()
        }
      >
        Allow calls in this window
      </button>{" "}
      <button
        disabled={busy || !status.data?.authorization}
        onClick={() =>
          void (async () => {
            try {
              await revoke.mutateAsync();
              setMessage("Weekday call permission revoked.");
              await status.refetch();
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Revocation failed."
              );
            }
          })()
        }
      >
        Revoke weekday calls
      </button>
      {status.error && <p role="alert">{status.error.message}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
