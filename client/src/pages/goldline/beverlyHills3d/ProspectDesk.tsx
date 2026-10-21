import { useEffect, useMemo, useState } from "react";
import { prospectDraft, type BeverlyHillsProspect } from "@shared/beverlyHillsProspects";
import styles from "./beverly-hills-3d.module.css";

/**
 * The cold-outreach desk behind the velvet rope. One real prospect at a time, with the facts on file and a draft that
 * states only those facts. Every action hands off to the operator's own email, phone or maps; nothing here sends, and
 * nothing is recorded as sent.
 */
export function ProspectDesk(props: {
  prospects: BeverlyHillsProspect[];
  brandName: string;
  readable: boolean;
  onClose: () => void;
}) {
  const { prospects, brandName, readable, onClose } = props;
  const [index, setIndex] = useState(0);
  const p = prospects[index] ?? null;
  const draft = useMemo(() => (p ? prospectDraft(p, brandName) : null), [p, brandName]);
  const [body, setBody] = useState(draft?.body ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [handedOff, setHandedOff] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setBody(draft?.body ?? "");
    setSubject(draft?.subject ?? "");
    setHandedOff(null);
    setCopied(false);
  }, [draft]);

  const mailto = p?.contact?.email ? `mailto:${encodeURIComponent(p.contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
  const tel = p?.contact?.phone ? `tel:${p.contact.phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <aside className={styles.desk} aria-label="Cold outreach desk" data-testid="beverly-hills-desk">
      <header className={styles.deskHeader}>
        <div>
          <div className={styles.deskKicker}>Commercial Row · {brandName}</div>
          <h2 className={styles.deskTitle}>{p ? p.name : "Behind the rope"}</h2>
        </div>
        <button type="button" className={styles.deskClose} onClick={onClose} aria-label="Close the outreach desk">
          ✕
        </button>
      </header>

      {!p ? (
        <div className={styles.deskEmpty} data-testid="beverly-hills-no-prospects">
          {readable
            ? `${brandName} has no Beverly Hills prospects on file yet. Log one (a visit, a call) and it will be waiting here.`
            : "Your prospect records could not be read right now. That is not the same as having none."}
        </div>
      ) : (
        <>
          {prospects.length > 1 ? (
            <nav className={styles.deskTabs} aria-label="Beverly Hills prospects">
              {prospects.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  className={`${styles.deskTab} ${i === index ? styles.deskTabOn : ""}`}
                  onClick={() => setIndex(i)}
                  data-testid="beverly-hills-prospect-tab"
                >
                  {x.name}
                </button>
              ))}
            </nav>
          ) : null}
          <dl className={styles.deskFacts} data-testid="beverly-hills-prospect-facts" data-prospect-id={p.id}>
            {p.kind ? (<><dt>Type</dt><dd>{p.kind.replace(/_/g, " ")}</dd></>) : null}
            {p.address ? (<><dt>Address</dt><dd>{p.address}</dd></>) : null}
            <dt>Contact</dt>
            <dd>{p.contact?.name || p.contact?.title ? [p.contact?.name, p.contact?.title].filter(Boolean).join(", ") : "No contact on file"}</dd>
            {p.signal ? (<><dt>Last signal</dt><dd>{p.signal}</dd></>) : null}
            {p.stage ? (<><dt>Stage</dt><dd>{p.stage.replace(/_/g, " ")}</dd></>) : null}
            <dt>Source</dt>
            <dd>{p.evidence}</dd>
          </dl>
          <label className={styles.deskLabel}>
            Subject
            <input className={styles.deskInput} value={subject} onChange={e => setSubject(e.target.value)} data-testid="beverly-hills-draft-subject" />
          </label>
          <label className={styles.deskLabel}>
            Draft
            <textarea className={styles.deskText} value={body} onChange={e => setBody(e.target.value)} rows={9} data-testid="beverly-hills-draft-body" />
          </label>
          <div className={styles.deskActions}>
            {mailto ? (
              <a className={styles.deskPrimary} href={mailto} onClick={() => setHandedOff("email")} data-testid="beverly-hills-open-email">
                Open in my email
              </a>
            ) : null}
            {tel ? (
              <a className={mailto ? styles.deskSecondary : styles.deskPrimary} href={tel} onClick={() => setHandedOff("phone")} data-testid="beverly-hills-call">
                Call {p.contact?.title ?? "them"}
              </a>
            ) : null}
            {p.navigationUrl ? (
              <a className={mailto || tel ? styles.deskSecondary : styles.deskPrimary} href={p.navigationUrl} target="_blank" rel="noreferrer" onClick={() => setHandedOff("visit")} data-testid="beverly-hills-directions">
                Plan a walk-in
              </a>
            ) : null}
            <button
              type="button"
              className={styles.deskSecondary}
              onClick={() => {
                void navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => setCopied(true), () => setCopied(false));
              }}
              data-testid="beverly-hills-copy"
            >
              {copied ? "Copied" : "Copy draft"}
            </button>
          </div>
          <p className={styles.deskTruth} role="status" data-testid="beverly-hills-desk-status">
            {handedOff === "email"
              ? "Opened in your email app. Not sent until you press send there."
              : handedOff === "phone"
                ? "Opened your phone. Nothing is recorded as a call."
                : handedOff === "visit"
                  ? "Directions opened. Walk in with the draft as your pitch."
                  : "Prepared, not sent. You send it yourself."}
          </p>
        </>
      )}
    </aside>
  );
}
