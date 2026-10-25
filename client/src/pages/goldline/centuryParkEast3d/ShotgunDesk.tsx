import { useEffect, useMemo, useRef, useState } from "react";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import { FUSE_SECONDS, HYPOTHESES, SHELLS, WEEKDAYS, aimToDate, assemble, defaultAim, fuseLeft, hourLabel, openings, textIsClean, type Aim, type Hypothesis, type Loadout, type Opening, type Shell } from "./shotgunMachine";
import styles from "./century-park-east-3d.module.css";

/**
 * The chipping shotgun. The zombie is a dormant resident, stunned for thirty seconds. In that window the operator
 * programs the chip: four decisions (what you remember about them, why they went quiet, what you'll offer, when it
 * lands), then FIRE schedules the text through the same rails Silver Lake uses. The real name and number appear only
 * here, never on the zombie. The text is Adam's voice from the record; the game never enters it.
 */
const STEPS = [
  { id: "clean", label: "1 · Clean the barrel", sub: "what you remember" },
  { id: "load", label: "2 · Load the chip", sub: "why they went quiet" },
  { id: "chamber", label: "3 · Chamber the shell", sub: "the offer" },
  { id: "aim", label: "4 · Aim", sub: "when it lands" },
] as const;
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

export function ShotgunDesk({
  target,
  brand,
  tazedAt,
  shellsLeft,
  isSending,
  onFire,
  onNotNow,
  onFuseOut,
}: {
  target: CozyProjectedTarget;
  brand: string;
  /** performance-independent wall clock (Date.now()) when the zombie went down */
  tazedAt: number;
  shellsLeft: number;
  isSending: boolean;
  onFire: (text: string, when: Date, loadout: Loadout) => Promise<boolean>;
  onNotNow: () => void;
  onFuseOut: () => void;
}) {
  const record = useMemo(
    () => ({ customerId: target.customerId, displayName: target.displayName, daysSinceLastOrder: target.daysSinceLastOrder, paidOrders: target.paidOrders, lifetimeCents: target.lifetimeCents, lastOrderDate: target.lastOrderDate, lastOrderSummary: target.lastOrderSummary }),
    [target]
  );
  const opens = useMemo(() => openings(record), [record]);
  const lastAim = useMemo(() => defaultAim(record), [record]);
  const [step, setStep] = useState(0);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [hypothesis, setHypothesis] = useState<Hypothesis | null>(null);
  const [shell, setShell] = useState<Shell | null>(null);
  const [aim, setAim] = useState<Aim>(lastAim);
  const [aimed, setAimed] = useState(false);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [left, setLeft] = useState(() => fuseLeft(tazedAt, Date.now()));
  const firedOut = useRef(false);

  // the fuse burns on the wall clock, not the game clock (the game is paused while the gun is open)
  useEffect(() => {
    const t = setInterval(() => {
      const l = fuseLeft(tazedAt, Date.now());
      setLeft(l);
      if (l <= 0 && !firedOut.current) {
        firedOut.current = true;
        onFuseOut();
      }
    }, 100);
    return () => clearInterval(t);
  }, [tazedAt, onFuseOut]);

  const loadout: Loadout | null = opening && hypothesis && shell ? { opening, hypothesis, shell, aim } : null;
  useEffect(() => {
    if (loadout && !touched) setText(assemble(loadout, brand));
  }, [loadout?.opening.id, loadout?.hypothesis, loadout?.shell, aim.weekday, aim.hour, brand, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const when = useMemo(() => aimToDate(aim), [aim]);
  const clean = textIsClean(text);
  const ready = !!loadout && aimed && text.trim().length > 0 && clean && !isSending;
  const pct = Math.max(0, Math.min(100, (left / FUSE_SECONDS) * 100));
  const first = target.displayName.split(" ")[0] || target.displayName;

  const pick = {
    opening(o: Opening) {
      setOpening(o);
      setStep(1);
    },
    hypothesis(h: Hypothesis) {
      setHypothesis(h);
      setStep(2);
    },
    shell(sh: Shell) {
      setShell(sh);
      setStep(3);
    },
    aim(a: Aim) {
      setAim(a);
      setAimed(true);
    },
  };

  return (
    <div className={styles.shotgun} role="dialog" aria-label="Program the shotgun" data-testid="century-park-east-shotgun" data-step={STEPS[step].id}>
      <div className={styles.gun}>
        <div className={`${styles.fuse} ${left < 8 ? styles.hot : ""}`} aria-label="Fuse">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.gunHead}>
          <div className={styles.gunTitle}>Chipping shotgun · {target.displayName}</div>
          <div className={styles.gunSeconds} data-testid="century-park-east-fuse">{Math.ceil(left)}s</div>
        </div>
        <div className={styles.readout}>
          <span><b>{target.daysSinceLastOrder}</b> days quiet</span>
          <span><b>{target.paidOrders}</b> paid order{target.paidOrders === 1 ? "" : "s"}</span>
          <span><b>${Math.round(target.lifetimeCents / 100)}</b> lifetime</span>
          {target.lastOrderSummary ? <span>last: <b>{target.lastOrderSummary}</b></span> : null}
          <span>shells tonight: <b>{shellsLeft}</b></span>
        </div>

        <div className={styles.steps}>
          <div className={styles.rail}>
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" aria-current={i === step ? "step" : undefined} className={i < step || (i === 3 && aimed) ? styles.done : ""} onClick={() => setStep(i)}>
                {s.label}
                <small>{i === 0 && opening ? opening.label : i === 1 && hypothesis ? HYPOTHESES.find(h => h.id === hypothesis)?.label : i === 2 && shell ? SHELLS.find(x => x.id === shell)?.label : i === 3 && aimed ? `${WEEKDAYS[aim.weekday]} ${hourLabel(aim.hour)}` : s.sub}</small>
              </button>
            ))}
          </div>

          <div className={styles.pane}>
            {step === 0 ? (
              <>
                <div className={styles.paneTitle}>What do you remember about {first}?</div>
                <div className={styles.choices}>
                  {opens.map(o => (
                    <button key={o.id} type="button" className={styles.choice} aria-pressed={opening?.id === o.id} onClick={() => pick.opening(o)} data-testid="century-park-east-opening">
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <div className={styles.paneTitle}>Why did {first} go quiet? This is your prediction; the game scores it.</div>
                <div className={styles.choices}>
                  {HYPOTHESES.map(h => (
                    <button key={h.id} type="button" className={styles.choice} aria-pressed={hypothesis === h.id} onClick={() => pick.hypothesis(h.id)} data-testid="century-park-east-hypothesis">
                      {h.label}
                      <small>{h.tell}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {step === 2 ? (
              <>
                <div className={styles.paneTitle}>What goes in the shell? {shellsLeft === 0 ? "You're out of shells tonight: no offer." : `${shellsLeft} shell${shellsLeft === 1 ? "" : "s"} left tonight.`}</div>
                <div className={styles.choices}>
                  {SHELLS.map(sh => (
                    <button key={sh.id} type="button" className={styles.choice} aria-pressed={shell === sh.id} disabled={sh.id !== "none" && shellsLeft === 0} onClick={() => pick.shell(sh.id)} data-testid="century-park-east-shell">
                      {sh.label}
                      <small>{sh.costCents ? `costs about $${Math.round(sh.costCents / 100)}` : "costs nothing"}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {step === 3 ? (
              <>
                <div className={styles.paneTitle}>Aim: when does it land? {record.lastOrderDate ? `${first} last ordered ${WEEKDAYS[lastAim.weekday]} around ${hourLabel(lastAim.hour)}.` : "No order time on record; a weekday morning."}</div>
                <div className={styles.sight} role="grid" aria-label="When to send">
                  <span />
                  {HOURS.map(h => (
                    <span key={h} className={styles.h}>{hourLabel(h)}</span>
                  ))}
                  {[1, 2, 3, 4, 5, 6, 0].map(d => (
                    <div key={d} style={{ display: "contents" }}>
                      <span className={styles.d}>{WEEKDAYS[d]}</span>
                      {HOURS.map(h => (
                        <button key={h} type="button" aria-label={`${WEEKDAYS[d]} ${hourLabel(h)}`} aria-pressed={aimed && aim.weekday === d && aim.hour === h} data-last={lastAim.weekday === d && lastAim.hour === h ? "yes" : "no"} onClick={() => pick.aim({ weekday: d, hour: h })} data-testid="century-park-east-aim" />
                      ))}
                    </div>
                  ))}
                </div>
                <div className={styles.aimNote}>
                  {aimed ? `Lands ${when.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric" })}.` : "The amber cell is when they last ordered. Pick a cell."}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {loadout ? (
          <div className={styles.textWrap}>
            <div className={styles.paneTitle}>The text, in your voice. Edit it if you like.</div>
            <textarea id="cpe-shotgun-text" value={text} onChange={e => { setText(e.target.value); setTouched(true); }} data-testid="century-park-east-shotgun-text" />
            {!clean ? <div className={styles.warn}>That word belongs to the game, not to {first}. Take it out before you fire.</div> : null}
          </div>
        ) : null}

        <div className={styles.gunFoot}>
          <button type="button" className={styles.notNow} onClick={onNotNow} data-testid="century-park-east-not-now">Not now (the zombie wakes up)</button>
          <span>{ready ? `Scheduled for ${WEEKDAYS[when.getDay()]} ${hourLabel(when.getHours())}. Not sent until then.` : "Four choices, then fire."}</span>
          <button type="button" className={styles.fire} disabled={!ready} onClick={() => loadout && onFire(text.trim(), when, loadout)} data-testid="century-park-east-fire">
            {isSending ? "Firing…" : "Fire"}
          </button>
        </div>
      </div>
    </div>
  );
}
