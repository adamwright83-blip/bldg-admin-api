import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { GOAL_MAX_CENTS, type DeskConfig, type TowerDesk as Desk } from "@shared/towerDesk";
import type { BuildingSpec } from "./towerStack";
import { money } from "./deskMoney";
import styles from "./tower-desk.module.css";

/**
 * Everything about a building that only its operator knows, as fields: floors and doors per floor, whether unit
 * numbers start with the floor, how long before a resident counts as quiet, and the building contract with the
 * payments received on it. Nothing here needs code; both rooms (the security desk and the clubhouse) show it.
 */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const toCents = (text: string) => {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const toInt = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : NaN);

/** open the settings panel from anywhere in the room (an elevator button, a plaque) */
export function openDeskSettings() {
  const el = document.getElementById("desk-settings") as HTMLDetailsElement | null;
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function DeskSettings({ desk, spec }: { desk: Desk; spec: BuildingSpec }) {
  const utils = trpc.useUtils();
  const refresh = () => utils.system.towerDesk.read.invalidate({ buildingId: desk.buildingId });
  const saveConfig = trpc.system.towerDesk.saveConfig.useMutation({ onSuccess: () => void refresh() });
  const addPayment = trpc.system.towerDesk.addContractPayment.useMutation({ onSuccess: () => void refresh() });
  const removePayment = trpc.system.towerDesk.removeContractPayment.useMutation({ onSuccess: () => void refresh() });

  const sig = JSON.stringify([desk.config, spec.towers.map(t => [t.id, t.floors, t.unitsPerFloor])]);
  const initial = useMemo(() => ({
    towers: Object.fromEntries(spec.towers.map(t => [t.id, { floors: String(t.floors), units: String(t.unitsPerFloor) }])) as Record<string, { floors: string; units: string }>,
    numbering: spec.numberingConfirmed,
    quiet: String(desk.config.quietDays),
    cName: desk.config.contract?.name ?? "Building contract",
    cMonthly: desk.config.contract ? String(Math.round(desk.config.contract.monthlyCents / 100)) : "",
  }), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const [pay, setPay] = useState({ amount: "", paidOn: todayLocal(), note: "" });

  const towers = spec.towers.map(t => {
    const d = draft.towers[t.id] ?? { floors: String(t.floors), units: String(t.unitsPerFloor) };
    const floors = toInt(d.floors), units = toInt(d.units);
    return { t, d, floors, units, ok: floors >= 1 && floors <= 120 && units >= 1 && units <= 60 };
  });
  const quietDays = toInt(draft.quiet);
  const factsOk = towers.every(x => x.ok) && quietDays >= 7 && quietDays <= 365;
  const baseConfig = (): DeskConfig => desk.config;

  const saveFacts = () => {
    if (!factsOk) return;
    saveConfig.mutate({
      buildingId: desk.buildingId,
      config: {
        ...baseConfig(),
        towers: Object.fromEntries(towers.map(x => [x.t.id, { floors: x.floors, unitsPerFloor: x.units }])),
        numberingConfirmed: draft.numbering,
        quietDays,
      },
    });
  };

  const monthlyCents = toCents(draft.cMonthly);
  const contractOk = draft.cName.trim().length > 0 && monthlyCents >= 0 && monthlyCents <= GOAL_MAX_CENTS;
  const saveContract = () => {
    if (!contractOk) return;
    saveConfig.mutate({ buildingId: desk.buildingId, config: { ...baseConfig(), contract: { name: draft.cName.trim(), monthlyCents } } });
  };
  const removeContract = () => saveConfig.mutate({ buildingId: desk.buildingId, config: { ...baseConfig(), contract: null } });

  const payCents = toCents(pay.amount);
  const payOk = payCents >= 1 && payCents <= GOAL_MAX_CENTS && /^\d{4}-\d{2}-\d{2}$/.test(pay.paidOn);
  const logPayment = () => {
    if (!payOk) return;
    addPayment.mutate(
      { buildingId: desk.buildingId, amountCents: payCents, paidOn: pay.paidOn, note: pay.note.trim() },
      { onSuccess: () => setPay({ amount: "", paidOn: todayLocal(), note: "" }) },
    );
  };

  const contract = desk.contract;
  const err = saveConfig.error ?? addPayment.error ?? removePayment.error;

  return (
    <details id="desk-settings" className={styles.settings} data-testid="desk-settings">
      <summary>Building settings · towers, quiet days, contract</summary>
      <div className={styles.settingsBody}>
        <section className={styles.settingsCol} aria-label="Your towers">
          <h5>Your towers</h5>
          {towers.map(x => (
            <fieldset key={x.t.id} className={styles.towerFields}>
              <legend>{x.t.label}</legend>
              <label>Floors
                <input inputMode="numeric" value={x.d.floors} onChange={e => setDraft({ ...draft, towers: { ...draft.towers, [x.t.id]: { ...x.d, floors: e.target.value } } })} data-testid={`settings-floors-${x.t.id}`} />
              </label>
              <label>Doors per floor
                <input inputMode="numeric" value={x.d.units} onChange={e => setDraft({ ...draft, towers: { ...draft.towers, [x.t.id]: { ...x.d, units: e.target.value } } })} data-testid={`settings-units-${x.t.id}`} />
              </label>
              {x.t.unitsAssumed ? <em>Starting guess. Save to confirm it.</em> : null}
              {!x.ok ? <em>Floors 1–120, doors 1–60.</em> : null}
            </fieldset>
          ))}
          <label className={styles.checkRow}>
            <input type="checkbox" checked={draft.numbering} onChange={e => setDraft({ ...draft, numbering: e.target.checked })} />
            Unit numbers start with the floor (unit 1507 is on floor 15)
          </label>
          <label className={styles.inlineField}>
            Call a resident quiet after
            <input inputMode="numeric" value={draft.quiet} onChange={e => setDraft({ ...draft, quiet: e.target.value })} data-testid="settings-quiet-days" />
            days
          </label>
          {quietDays < 7 || quietDays > 365 || Number.isNaN(quietDays) ? <em>Between 7 and 365 days.</em> : null}
          <button type="button" className={styles.goalSave} disabled={!factsOk || saveConfig.isPending} onClick={saveFacts} data-testid="settings-save-facts">
            {saveConfig.isPending ? "Saving…" : "Save building facts"}
          </button>
        </section>

        <section className={styles.settingsCol} aria-label="Building contract">
          <h5>Building contract</h5>
          <p className={styles.settingsNote}>
            A contract paid apart from residents (a gym's towels, a hotel's linens). Nothing records it automatically, so you enter what it's worth and log each payment you receive. It counts toward the elevator.
          </p>
          <label>Contract name
            <input value={draft.cName} onChange={e => setDraft({ ...draft, cName: e.target.value })} maxLength={60} data-testid="settings-contract-name" />
          </label>
          <label>Worth, dollars a month
            <input inputMode="decimal" value={draft.cMonthly} onChange={e => setDraft({ ...draft, cMonthly: e.target.value })} placeholder="500" data-testid="settings-contract-monthly" />
          </label>
          <div className={styles.goalActions}>
            <button type="button" className={styles.goalSave} disabled={!contractOk || saveConfig.isPending} onClick={saveContract} data-testid="settings-save-contract">
              {contract ? "Update contract" : "Add contract"}
            </button>
            {contract ? <button type="button" className={styles.deskButton} onClick={removeContract}>Remove contract</button> : null}
          </div>

          {contract ? (
            <>
              <h5>Payments received</h5>
              <div className={styles.payForm}>
                <label>Amount ($)
                  <input inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} placeholder={contract.monthlyCents ? String(Math.round(contract.monthlyCents / 100)) : "500"} data-testid="settings-pay-amount" />
                </label>
                <label>Paid on
                  <input type="date" value={pay.paidOn} max={todayLocal()} onChange={e => setPay({ ...pay, paidOn: e.target.value })} data-testid="settings-pay-date" />
                </label>
                <label>Note (optional)
                  <input value={pay.note} maxLength={200} onChange={e => setPay({ ...pay, note: e.target.value })} />
                </label>
                <button type="button" className={styles.goalSave} disabled={!payOk || addPayment.isPending} onClick={logPayment} data-testid="settings-log-payment">
                  {addPayment.isPending ? "Saving…" : "Log payment"}
                </button>
              </div>
              {contract.payments.length ? (
                <ul className={styles.payList}>
                  {contract.payments.slice(0, 12).map(p => (
                    <li key={p.id}>
                      <time>{p.paidOn}</time>
                      <b>{money(p.amountCents)}</b>
                      <span>{p.note}</span>
                      <button type="button" aria-label={`Remove the ${money(p.amountCents)} payment from ${p.paidOn}`} onClick={() => removePayment.mutate({ buildingId: desk.buildingId, id: p.id })}>✕</button>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.settingsNote}>No payments logged yet.</p>}
            </>
          ) : null}
        </section>
      </div>
      {err ? <p className={styles.settingsErr} role="alert">Couldn't save: {err.message}</p> : null}
    </details>
  );
}
