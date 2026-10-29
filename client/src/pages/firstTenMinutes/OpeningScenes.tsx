import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import {
  CONNECTION_INCLUDES,
  type ConnectionProvider,
  type ConnectionView,
  type GoogleProduct,
} from "@shared/firstTenMinutes";
import styles from "./firstTen.module.css";

/** A sheet settling onto the desk. With reduced motion it is simply there. */
export function Settle({ children, tilt = -0.8, delay = 0 }: { children: ReactNode; tilt?: number; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      style={{ width: "100%", display: "grid", placeItems: "center" }}
      initial={reduce ? false : { opacity: 0, y: 22, rotate: tilt - 1.4 }}
      animate={{ opacity: 1, y: 0, rotate: tilt }}
      transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/** 0:00 — the approved opening, on one folded card. */
export function Invitation({ onBegin }: { onBegin: () => void }) {
  return (
    <Settle>
      <article className={styles.card} data-testid="first-ten-invitation">
        <h1 className={styles.line}>Could your business be a game?</h1>
        <p className={styles.sub}>Let your crew get acquainted with the business you've already built.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.inkLink} onClick={onBegin}>
            Let's find out
          </button>
        </div>
      </article>
    </Settle>
  );
}

/** The next sheet: bring your world. No questionnaire before JOYSTICK has tried to understand anyone. */
export function BringYourWorld(props: {
  busy: boolean;
  googleReady: boolean;
  slackReady: boolean;
  notice: string | null;
  onConnect: (provider: ConnectionProvider) => void;
  onExample: () => void;
  onIncludes: (what: ConnectionProvider | "example") => void;
}) {
  return (
    <Settle tilt={0.6}>
      <article className={styles.sheet} style={{ textAlign: "center" }} data-testid="first-ten-connect">
        <h1 className={styles.line}>Bring your world with you.</h1>
        <p className={styles.sub}>Your conversations, projects, and plans give your crew somewhere to begin.</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.seal}
            disabled={props.busy || !props.googleReady}
            onClick={() => props.onConnect("google")}
            data-testid="first-ten-connect-google"
          >
            Connect Google
          </button>
          <p className={styles.quiet}>
            <button
              type="button"
              disabled={props.busy || !props.slackReady}
              onClick={() => props.onConnect("slack")}
              data-testid="first-ten-add-slack"
            >
              Add Slack
            </button>
            <span className={styles.dot} aria-hidden="true">·</span>
            <button type="button" disabled={props.busy} onClick={props.onExample} data-testid="first-ten-example">
              Explore an example
            </button>
          </p>
        </div>
        {!props.googleReady ? (
          <p className={styles.notice}>Google isn't connected to JOYSTICK yet. You can explore the example meanwhile.</p>
        ) : null}
        {props.notice ? (
          <p className={styles.notice} role="alert">
            {props.notice}
          </p>
        ) : null}
        <button type="button" className={styles.fold} onClick={() => props.onIncludes("google")} data-testid="first-ten-includes">
          What connecting includes
        </button>
      </article>
    </Settle>
  );
}

/** "What this connection includes", in plain language. */
export function ConnectionIncludesSheet({
  what,
  onClose,
}: {
  what: ConnectionProvider | "example";
  onClose: () => void;
}) {
  const sections = what === "example" ? [CONNECTION_INCLUDES.example] : [CONNECTION_INCLUDES.google, CONNECTION_INCLUDES.slack];
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="What connecting includes" onClick={onClose}>
      <Settle tilt={-0.4}>
        <article className={styles.includes} onClick={event => event.stopPropagation()} data-testid="first-ten-includes-sheet">
          {sections.map(section => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <h3>Your crew reads</h3>
              <ul>{section.reads.map(line => <li key={line}>{line}</li>)}</ul>
              <h3>Never</h3>
              <ul>{section.never.map(line => <li key={line}>{line}</li>)}</ul>
              <h3>What JOYSTICK keeps</h3>
              <ul>{section.kept.map(line => <li key={line}>{line}</li>)}</ul>
              {section.stop.length ? (
                <>
                  <h3>Stopping</h3>
                  <ul>{section.stop.map(line => <li key={line}>{line}</li>)}</ul>
                </>
              ) : null}
            </section>
          ))}
          <div className={styles.actions}>
            <button type="button" className={styles.inkLink} onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </article>
      </Settle>
    </div>
  );
}

const PRODUCT_NAMES: Record<GoogleProduct, string> = { gmail: "Gmail", calendar: "Calendar", drive: "Drive" };

export function productList(products: readonly GoogleProduct[]): string {
  const names = products.map(product => PRODUCT_NAMES[product]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What is connected, quietly in a corner: connect what isn't, or disconnect, at any point. */
export function ConnectionsStrip(props: {
  connections: ConnectionView[];
  busy: boolean;
  googleReady: boolean;
  slackReady: boolean;
  onConnect: (provider: ConnectionProvider) => void;
  onDisconnect: (provider: ConnectionProvider) => void;
}) {
  const google = props.connections.find(connection => connection.provider === "google");
  const slack = props.connections.find(connection => connection.provider === "slack");
  return (
    <div className={styles.connectionsStrip} data-testid="first-ten-connections">
      {google ? (
        <span data-testid="first-ten-google-account">
          {google.account} · {productList(google.products)}
        </span>
      ) : null}
      {slack ? <span>Slack · {slack.account ?? "workspace"}</span> : null}
      <span className={styles.stripActions}>
        {!google ? (
          <button type="button" disabled={props.busy || !props.googleReady} onClick={() => props.onConnect("google")} data-testid="first-ten-connect-google">
            Connect Google
          </button>
        ) : null}
        {!slack ? (
          <button type="button" disabled={props.busy || !props.slackReady} onClick={() => props.onConnect("slack")} data-testid="first-ten-add-slack">
            Add Slack
          </button>
        ) : null}
        {google ? (
          <button type="button" disabled={props.busy} onClick={() => props.onDisconnect("google")} data-testid="first-ten-disconnect-google">
            Disconnect Google
          </button>
        ) : null}
        {slack ? (
          <button type="button" disabled={props.busy} onClick={() => props.onDisconnect("slack")}>
            Disconnect Slack
          </button>
        ) : null}
      </span>
    </div>
  );
}
