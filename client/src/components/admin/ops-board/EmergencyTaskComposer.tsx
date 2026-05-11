import { useMemo, useState } from "react";
import { Check, Loader2, Siren, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

const levelMeta = {
  level_1: { label: "Level 1", short: "L1", tone: "cash" },
  level_2: { label: "Level 2", short: "L2", tone: "followup" },
  level_3: { label: "Level 3", short: "L3", tone: "system" },
  level_4: { label: "Level 4", short: "L4", tone: "boss" },
} as const;

type OperatorTask = {
  id: number;
  level: keyof typeof levelMeta;
  title: string;
  status: "open" | "in_progress" | "done" | "blocked";
  priority: "emergency" | "high" | "normal" | "low";
  target: string | null;
};

export function EmergencyTaskComposer() {
  const [note, setNote] = useState("");
  const utils = trpc.useUtils();
  const tasks = trpc.admin.agent.listOperatorTasks.useQuery({ status: "active", limit: 24 });
  const runIntake = trpc.admin.agent.runEmergencyTaskIntake.useMutation({
    onSuccess: async (result) => {
      setNote("");
      await utils.admin.agent.listOperatorTasks.invalidate();
      toast.success(result.summary || "Emergency tasks captured.");
    },
    onError: (error) => toast.error(error.message || "Could not capture tasks."),
  });
  const updateStatus = trpc.admin.agent.updateOperatorTaskStatus.useMutation({
    onSuccess: async () => {
      await utils.admin.agent.listOperatorTasks.invalidate();
    },
    onError: (error) => toast.error(error.message || "Could not update task."),
  });

  const grouped = useMemo(() => {
    const empty: Record<keyof typeof levelMeta, OperatorTask[]> = {
      level_1: [],
      level_2: [],
      level_3: [],
      level_4: [],
    };
    for (const task of ((tasks.data ?? []) as OperatorTask[])) {
      empty[task.level]?.push(task);
    }
    return empty;
  }, [tasks.data]);

  function submit() {
    const clean = note.trim();
    if (!clean) return;
    runIntake.mutate({ note: clean });
  }

  return (
    <section className="ops-card ops-emergency-composer" aria-label="Emergency task intake">
      <div className="ops-emergency-head">
        <div>
          <p className="ops-section-kicker">
            <Siren className="h-3.5 w-3.5" />
            EMERGENCY TASK INTAKE
          </p>
          <h2>Dump the whole stack.</h2>
        </div>
        <span>{(tasks.data ?? []).length} active</span>
      </div>

      <div className="ops-emergency-input">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Charge Daniel, call Karin, fix vendor signup, test laundry order flow..."
          rows={3}
        />
        <Button type="button" className="ops-button ops-button-green" onClick={submit} disabled={!note.trim() || runIntake.isPending}>
          {runIntake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Capture
        </Button>
      </div>

      <div className="ops-emergency-levels">
        {(Object.keys(levelMeta) as Array<keyof typeof levelMeta>).map((level) => {
          const meta = levelMeta[level];
          return (
            <article className={`ops-emergency-level ${meta.tone}`} key={level}>
              <div className="ops-emergency-level-head">
                <span>{meta.short}</span>
                <strong>{meta.label}</strong>
              </div>
              {grouped[level].length ? (
                <ul>
                  {grouped[level].slice(0, 4).map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        aria-label={`Mark ${task.title} done`}
                        onClick={() => updateStatus.mutate({ id: task.id, status: "done" })}
                        disabled={updateStatus.isPending}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <span>{task.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Clear</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
