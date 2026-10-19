import type { LanternReportWindowDays, LanternTerritoryReport } from "@shared/lanternTerritoryReport";
import styles from "./lantern-city-islands.module.css";

const money = (cents: number | null) => {
  if (cents == null) return "Not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
};

const count = (value: number | null, noun: string) =>
  value == null ? "Not available" : `${value} ${noun}${value === 1 ? "" : "s"}`;

export default function LanternReportPanel({
  report,
  isLoading,
  isError,
  windowDays,
  onWindowDays,
  selectedId,
  onSelect,
  onOpenCustomer,
  onRetry,
}: {
  report: LanternTerritoryReport | undefined;
  isLoading: boolean;
  isError: boolean;
  windowDays: LanternReportWindowDays;
  onWindowDays: (days: LanternReportWindowDays) => void;
  selectedId: string | null;
  onSelect: (territoryId: string) => void;
  onOpenCustomer: (phone: string) => void;
  onRetry: () => void;
}) {
  const selected = report?.territories.find(territory => territory.id === selectedId) ?? report?.territories[0] ?? null;
  return (
    <section
      className={styles.report}
      data-lantern-report="open"
      data-lantern-report-fixture={report ? String(report.figuresAreLive === false) : "false"}
      aria-label="Lantern City report"
    >
      <div className={styles.reportHead}>
        <div>
          <p className={styles.reportKicker}>Report mode</p>
          <h2>How the neighborhoods did</h2>
        </div>
        <div className={styles.windowSwitch} role="group" aria-label="Revenue window">
          {([30, 90] as const).map(days => (
            <button key={days} type="button" aria-pressed={windowDays === days} onClick={() => onWindowDays(days)}>
              {days} days
            </button>
          ))}
        </div>
      </div>
      {report && report.figuresAreLive === false ? (
        <p className={styles.fixture} role="note">Fixture figures — not live sales.</p>
      ) : null}
      <p className={styles.reportReadOnly}>Read only. Nothing here sends a message, starts a mission, or changes a plan.</p>
      {isLoading ? <p className={styles.reportStatus}>Reading the paid-order book…</p> : null}
      {isError ? (
        <p className={styles.reportStatus} role="alert">
          The territory report could not be read.
          <button type="button" onClick={onRetry}>Try again</button>
        </p>
      ) : null}
      {report && report.status !== "ready" ? (
        <p className={styles.reportStatus} role="status">{report.reason}</p>
      ) : null}
      {report && report.status === "ready" ? (
        <>
          <div className={styles.answers}>
            <article data-report-most>
              <h3>Most recorded revenue</h3>
              {report.comparison.mostRecordedRevenue ? (
                <p>
                  <b>{report.comparison.mostRecordedRevenue.name}</b>
                  {" · "}
                  {money(report.comparison.mostRecordedRevenue.revenueCents)}
                  {report.comparison.mostRecordedRevenue.evidenceClass === "fresh"
                    ? ""
                    : ` · ${report.comparison.mostRecordedRevenue.evidenceClass} book`}
                </p>
              ) : (
                <p>Not ranked. The windows or the evidence do not match.</p>
              )}
            </article>
            <article data-report-decline>
              <h3>Largest decline</h3>
              {report.comparison.steepestDecline ? (
                <p>
                  <b>{report.comparison.steepestDecline.name}</b>
                  {" · "}
                  {money(report.comparison.steepestDecline.revenueChangeCents)} versus {report.comparisonLabel}
                </p>
              ) : (
                <p>No comparable decline. A quiet territory is not a failure.</p>
              )}
            </article>
            <article data-report-dormant>
              <h3>Dormant recovery</h3>
              {report.comparison.dormantOpportunities.length ? (
                <ul>
                  {report.comparison.dormantOpportunities.map(item => (
                    <li key={item.territoryId}>
                      {item.name}: {item.dormantCustomers} dormant customer{item.dormantCustomers === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No reliable dormant-customer opportunity in this window.</p>
              )}
            </article>
            <article data-report-insufficient>
              <h3>Evidence shortfalls</h3>
              {report.comparison.insufficient.length ? (
                <ul>
                  {report.comparison.insufficient.slice(0, 4).map(item => (
                    <li key={item.territoryId}>{item.reason}</li>
                  ))}
                </ul>
              ) : (
                <p>The compared territories share one fresh book.</p>
              )}
            </article>
          </div>
          <div className={styles.chips} role="tablist" aria-label="Territories">
            {report.territories.map(territory => (
              <button
                key={territory.id}
                type="button"
                role="tab"
                aria-selected={selected?.id === territory.id}
                data-report-territory={territory.id}
                onClick={() => onSelect(territory.id)}
              >
                {territory.name}
              </button>
            ))}
          </div>
          {selected ? (
            <div className={styles.territoryDetail} data-report-revenue>
              <h3>{selected.name}</h3>
              <p className={styles.revenue}>{money(selected.revenueCents)}</p>
              <p>
                {report.periodLabel}
                {selected.previousRevenueCents != null ? ` · previous ${money(selected.previousRevenueCents)}` : ""}
                {selected.directionReliable
                  ? ` · ${selected.direction === "up" ? "up" : selected.direction === "down" ? "down" : "flat"} ${money(selected.revenueChangeCents)}`
                  : " · change not highlighted"}
              </p>
              <p>{count(selected.paidOrderCount, "paid order")} · {count(selected.activeCustomers, "active customer")} · {count(selected.dormantCustomers, "dormant customer")}</p>
              <p>{selected.locatedCustomers} located customer{selected.locatedCustomers === 1 ? "" : "s"} · {selected.evidenceNote}</p>
              {selected.customers.length ? (
                <div className={styles.customerList}>
                  {selected.customers.map(customer => (
                    <button
                      key={customer.identityKey}
                      type="button"
                      disabled={!customer.phone}
                      onClick={() => customer.phone && onOpenCustomer(customer.phone)}
                    >
                      {customer.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <footer className={styles.sourceQuality}>
            <b>Source quality</b>
            <span>{report.source.bookStatus} · {report.source.completeness ?? "coverage unread"}</span>
            <span>
              {report.source.loadedSources.length ? report.source.loadedSources.join(", ") : "no source loaded"}
              {report.source.failedSources.length ? ` · failed: ${report.source.failedSources.join(", ")}` : ""}
            </span>
            {report.source.checkedAt ? <span>Checked {report.source.checkedAt}</span> : null}
            {report.unattributed.orderCount ? <span>{report.unattributed.orderCount} unattributed paid orders, not spread.</span> : null}
            {report.ambiguous.orderCount ? <span>{report.ambiguous.orderCount} ambiguous orders withheld.</span> : null}
            {report.missingPaymentEvidence.orderCount ? <span>{report.missingPaymentEvidence.orderCount} orders missing payment evidence.</span> : null}
          </footer>
        </>
      ) : null}
    </section>
  );
}
