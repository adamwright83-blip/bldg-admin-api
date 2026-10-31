import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MAX_ROUTINE_INSTRUCTION, parseRoutineInstruction, type RoutineRunView, type RoutineView } from "@shared/claireRoutines";

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const when = (iso: string, timeZone: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return new Date(iso).toLocaleString();
  }
};

export function routineStanding(routine: Pick<RoutineView, "status" | "nextRunAt" | "timeZone">): string {
  if (routine.status === "stopped") return "Stopped. Kept for its history; it won't run again.";
  if (routine.status === "paused") return "Paused. It won't run until you resume it.";
  return routine.nextRunAt ? `Next: ${when(routine.nextRunAt, routine.timeZone)}` : "Waiting for its next time.";
}

export function runLine(run: RoutineRunView): string {
  if (run.status === "running") return "Running now…";
  if (run.status === "failed") return run.note ?? "It didn't finish.";
  return run.summary ?? "Done.";
}

const STATUS_WORDS: Record<RoutineView["status"], string> = { active: "On", paused: "Paused", stopped: "Stopped" };

function RunHistory({ routine }: { routine: RoutineView }) {
  if (!routine.runs.length) return null;
  return (
    <details data-testid="claire-desk-routine-history">
      <summary>History ({routine.runs.length})</summary>
      <ul className="cd-ready cd-routine-runs">
        {routine.runs.map(run => (
          <li key={run.id} data-testid="claire-desk-routine-run" data-status={run.status} data-trigger={run.trigger}>
            <small>
              {when(run.finishedAt ?? run.startedAt, routine.timeZone)} · {run.trigger === "manual" ? "you ran it" : "on schedule"} ·{" "}
              {run.status === "done" ? "done" : run.status === "failed" ? "didn't finish" : "running"}
            </small>
            <br />
            {runLine(run)}
            {run.findings?.items.length ? (
              <ul className="cd-ready">
                {run.findings.items.map(item => (
                  <li key={item.messageId} data-testid="claire-desk-routine-finding">
                    <strong>{item.person.name ?? item.person.address}</strong>
                    {item.waitingDays !== null ? ` · ${item.waitingDays} ${item.waitingDays === 1 ? "day" : "days"}` : ""}
                    <br />
                    <small>
                      “{item.subject}”{" "}
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer noopener">
                          open
                        </a>
                      ) : null}
                    </small>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RoutineItem({ routine, onChanged }: { routine: RoutineView; onChanged: () => void }) {
  const pause = trpc.system.claireRoutines.pause.useMutation({ onSuccess: onChanged });
  const resume = trpc.system.claireRoutines.resume.useMutation({ onSuccess: onChanged });
  const stop = trpc.system.claireRoutines.stop.useMutation({ onSuccess: onChanged });
  const runNow = trpc.system.claireRoutines.runNow.useMutation({ onSuccess: onChanged });
  const [confirmStop, setConfirmStop] = useState(false);
  const busy = pause.isPending || resume.isPending || stop.isPending || runNow.isPending;
  const error = pause.error ?? resume.error ?? stop.error ?? runNow.error;
  const last = routine.runs[0];
  return (
    <li className="cd-routine" data-testid="claire-desk-routine" data-status={routine.status}>
      <strong>{routine.describe}</strong> · <small data-testid="claire-desk-routine-status">{STATUS_WORDS[routine.status]}</small>
      <br />
      <small>Your words: “{routine.instruction}”</small>
      <br />
      <small data-testid="claire-desk-routine-next">{routineStanding(routine)}</small>
      <p className="cd-fine" data-testid="claire-desk-routine-last">
        {last ? `Last run ${when(last.finishedAt ?? last.startedAt, routine.timeZone)}: ${runLine(last)}` : "It hasn't run yet."}
      </p>
      {routine.status !== "stopped" ? (
        <div className="cd-chips">
          {routine.status === "active" ? (
            <button type="button" className="cd-chip" disabled={busy} onClick={() => pause.mutate({ id: routine.id })} data-testid="claire-desk-routine-pause">
              Pause
            </button>
          ) : (
            <button type="button" className="cd-chip" disabled={busy} onClick={() => resume.mutate({ id: routine.id })} data-testid="claire-desk-routine-resume">
              Resume
            </button>
          )}
          <button type="button" className="cd-chip" disabled={busy} onClick={() => runNow.mutate({ id: routine.id })} data-testid="claire-desk-routine-run-now">
            {runNow.isPending ? "Running…" : "Run now"}
          </button>
          {confirmStop ? (
            <>
              <button type="button" className="cd-chip" disabled={busy} onClick={() => stop.mutate({ id: routine.id })} data-testid="claire-desk-routine-stop-confirm">
                Stop for good
              </button>
              <button type="button" className="cd-chip" disabled={busy} onClick={() => setConfirmStop(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="cd-chip" disabled={busy} onClick={() => setConfirmStop(true)} data-testid="claire-desk-routine-stop">
              Stop
            </button>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="cd-fine">
          {error.message}
        </p>
      ) : null}
      <RunHistory routine={routine} />
    </li>
  );
}

/**
 * Claire routines: recurring checks the operator asks for in their own words. Each one in words, when it runs next,
 * what it last found, and its history. Routines only read the operator's own Gmail and report here: nothing is sent,
 * labelled or changed. Following up is still the approved follow-up on the Waiting to hear back card.
 */
export function Routines() {
  const timeZone = zone();
  const utils = trpc.useUtils();
  const list = trpc.system.claireRoutines.list.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const create = trpc.system.claireRoutines.create.useMutation();
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const preview = useMemo(() => (text.trim() ? parseRoutineInstruction(text, timeZone) : null), [text, timeZone]);
  const refresh = () => void utils.system.claireRoutines.list.invalidate();
  if (list.isLoading || !list.data) return null;
  const routines = list.data;
  const live = routines.filter(routine => routine.status !== "stopped");
  const stopped = routines.filter(routine => routine.status === "stopped");

  const submit = async () => {
    if (!preview?.ok) return;
    setRefusal(null);
    const result = await create.mutateAsync({ instruction: text, timeZone }).catch(error => ({ ok: false as const, reason: error instanceof Error ? error.message : "It wasn't saved." }));
    if (result.ok) {
      setText("");
      refresh();
    } else setRefusal(result.reason);
  };

  return (
    <section className="cd-card" aria-label="Routines" data-testid="claire-desk-routines">
      <p className="cd-kicker">ROUTINES</p>
      <label className="cd-small" htmlFor="cd-routine-input">
        Tell Claire what to check, and when
      </label>
      <textarea
        id="cd-routine-input"
        className="cd-routine-input"
        rows={2}
        maxLength={MAX_ROUTINE_INSTRUCTION}
        value={text}
        placeholder="Every Monday morning, tell me who I'm waiting to hear back from"
        onChange={event => {
          setText(event.target.value);
          setRefusal(null);
        }}
        data-testid="claire-desk-routine-input"
      />
      {preview ? (
        preview.ok ? (
          <p className="cd-ok" role="status" data-testid="claire-desk-routine-preview">
            {preview.describe}
          </p>
        ) : (
          <div role="status" data-testid="claire-desk-routine-refusal">
            <p className="cd-small">{preview.reason}</p>
            <p className="cd-fine">What Claire can run today:</p>
            <ul className="cd-ready">
              {preview.canDo.map(line => (
                <li key={line}>
                  <small>{line}</small>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
      <div className="cd-chips cd-mt-s">
        <button type="button" className="cd-gold" disabled={!preview?.ok || create.isPending} onClick={() => void submit()} data-testid="claire-desk-routine-create">
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </div>
      {refusal ? (
        <p role="alert" className="cd-fine" data-testid="claire-desk-routine-create-refused">
          {refusal}
        </p>
      ) : null}
      {live.length ? (
        <ul className="cd-ready cd-mt" data-testid="claire-desk-routine-list">
          {live.map(routine => (
            <RoutineItem key={routine.id} routine={routine} onChanged={refresh} />
          ))}
        </ul>
      ) : (
        <p className="cd-muted cd-mt" data-testid="claire-desk-routines-none">
          No routines yet.
        </p>
      )}
      {stopped.length ? (
        <details className="cd-mt" data-testid="claire-desk-routines-stopped">
          <summary>Stopped ({stopped.length})</summary>
          <ul className="cd-ready">
            {stopped.map(routine => (
              <RoutineItem key={routine.id} routine={routine} onChanged={refresh} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="cd-fine cd-mt">Routines only read your Gmail and report here. They never send, label or change anything; following up is always yours to approve.</p>
    </section>
  );
}
