import { trpc } from "@/lib/trpc";

export default function Gumballpals() {
  const status = trpc.system.gumball.context.useQuery(undefined, {
    retry: false,
    refetchInterval: 60000,
  });
  const last = status.data?.binding?.lastSuccessAt;
  const stale = !last || Date.now() - new Date(last).getTime() > 26 * 3600000;
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fff9e9",
        color: "#243a38",
        padding: "clamp(20px, 5vw, 64px)",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p>GOLDLINE · YOUR DAILY PULSE</p>
        <h1 style={{ fontSize: "clamp(36px, 8vw, 64px)", margin: "20px 0" }}>
          Gumballpals
        </h1>
        <p>Your real work, carried into your living city.</p>
        <section
          style={{
            background: "#e8f5ff",
            borderRadius: 24,
            padding: 24,
            margin: "24px 0",
          }}
        >
          <h2>Connection status</h2>
          {status.isLoading ? (
            <p>Checking your Goldline account…</p>
          ) : status.error ? (
            <p role="alert">
              Cannot verify your connection. The backend may be unavailable or
              your session may have expired. <a href="/">Check Goldline sign-in</a>, then retry.
            </p>
          ) : (
            <>
              <p>
                Account: {status.data?.accountLabel} · Tenant:{" "}
                {status.data?.tenantId}
              </p>
              <p>
                Store: {status.data?.binding?.storeLabel || "Not paired yet"}
              </p>
              <p>
                {last
                  ? `Last successful import: ${new Date(last).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} Pacific`
                  : "No successful import recorded."}
              </p>
              <p>
                {stale
                  ? "Needs attention — no fresh import within 26 hours."
                  : "A recent import is confirmed. This does not guarantee every historical payment was included."}
              </p>
            </>
          )}
          <button onClick={() => void status.refetch()} style={{ padding: 12 }}>
            Refresh status
          </button>
        </section>
        <h2>Install once. Then let it run.</h2>
        <p>
          <a
            href="/gumballpals.zip"
            download
            style={{
              display: "inline-block",
              background: "#ffda68",
              padding: "14px 20px",
              borderRadius: 12,
              color: "#243a38",
            }}
          >
            Download Gumballpals for Chrome
          </a>
        </p>
        <ol style={{ lineHeight: 1.9, paddingLeft: 24 }}>
          <li>
            Unzip the download. Open <code>chrome://extensions</code> in Chrome.
          </li>
          <li>
            Enable Developer mode, choose <strong>Load unpacked</strong>, and
            select the extracted folder containing <code>manifest.json</code>.
          </li>
          <li>
            Open Gumballpals from Chrome’s extensions menu. Stay signed into
            gumball and Goldline.
          </li>
          <li>
            Complete one manual sync and confirm the destination account and
            store.
          </li>
          <li>
            Choose <strong>Enable daily sync</strong> in the extension. It
            targets <strong>6:00 PM Pacific</strong>, including daylight saving
            time.
          </li>
        </ol>
        <p>
          Chrome must be running and the computer awake for an on-time run. A
          missed run catches up when Chrome reopens. Expired sign-ins or changed
          accounts need your attention; they are never reported as a successful
          import.
        </p>
        <p>
          Daily sync currently rechecks the most recent 30 days of order
          creation. Older orders paid later require another historical sync. A
          sync receipt is not proof of complete historical coverage.
        </p>
        <p>
          The extension reads reports and imports them into Goldline. It does
          not charge customers, edit source orders, or send messages. Browser
          permissions: storage, scripting, download events and alarms, with
          access limited to the two connected sites.
        </p>
        <p>
          <a href="/growth/tower-wars">Tower Wars</a> ·{" "}
          <a href="/growth/lantern-city">Lantern City</a>
        </p>
      </div>
    </main>
  );
}
