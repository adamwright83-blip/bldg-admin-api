import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { validateIntakePlan } from "@shared/cleancloudIntake";
export function CleancloudIntakePanel() {
  const feed = trpc.system.gumball.intake.list.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const prepare = trpc.system.gumball.intake.prepare.useMutation();
  const approve = trpc.system.gumball.intake.approve.useMutation();
  const focus = trpc.system.gumball.intake.focus.useMutation();
  const verify = trpc.system.gumball.intake.verify.useMutation();
  const directStatus = trpc.system.gumball.directStatus.useQuery(undefined, {
    retry: false,
  });
  const gmailConnect = trpc.system.gumball.gmailConnectUrl.useMutation();
  const [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [reviewed, setReviewed] = useState<string | null>(null),
    [error, setError] = useState("");
  const row = feed.data?.orders.find(x => x.id === selected);
  const busy =
    prepare.isPending ||
    approve.isPending ||
    focus.isPending ||
    verify.isPending;
  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      setReviewed(null);
      await feed.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intake needs attention.");
    }
  }
  const button =
    "min-h-11 rounded-lg border px-4 py-2 text-base disabled:opacity-50";
  return (
    <section
      className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4"
      aria-label="CleanCloud intake pilot"
    >
      <h3 className="text-lg font-semibold">CleanCloud intake</h3>
      {directStatus.data?.gmail.configured ? (
        <div className="my-2 flex items-center gap-3 text-sm">
          <span>
            Sync verification email:{" "}
            {directStatus.data.gmail.connected
              ? `connected${directStatus.data.gmail.connectedEmail ? ` (${directStatus.data.gmail.connectedEmail})` : ""}`
              : "not connected"}
          </span>
          <button
            type="button"
            className={button}
            disabled={gmailConnect.isPending}
            onClick={async () => {
              setError("");
              try {
                const { url } = await gmailConnect.mutateAsync();
                window.location.assign(url);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Gmail connection failed.");
              }
            }}
          >
            {directStatus.data.gmail.connected ? "Reconnect Gmail" : "Connect Gmail"}
          </button>
        </div>
      ) : null}
      <p className="my-2 text-sm">
        Enter the complete actual pounds or item quantities. These replace
        pickup estimates. CleanCloud supplies the prices. Inspect the prepared
        draft before approving submission.
      </p>
      {feed.error && <p role="alert">{feed.error.message}</p>}
      {!feed.data?.enabled && (
        <p>
          Open Gumball and connect the intake pilot on your Chrome computer.{" "}
          <a className="underline" href="/gumballpals">
            Connection setup
          </a>
        </p>
      )}
      {feed.data?.enabled && !row && (
        <div className="grid gap-2">
          {feed.data.orders.map(order => (
            <button
              key={order.id}
              className={button + " text-left"}
              onClick={() => {
                setSelected(order.id);
                setQuantities(
                  Object.fromEntries(
                    (order.planJson?.lines ?? []).map(x => [
                      x.productId,
                      String(x.quantity),
                    ])
                  )
                );
                setReviewed(null);
                setSearch("");
                setError("");
              }}
            >
              #{order.externalOrderId} · {order.sourceJson.customerName}
              <span className="block text-sm">
                {order.state === "detail"
                  ? "Awaiting intake"
                  : order.state.replaceAll("_", " ")}
              </span>
            </button>
          ))}
          {!feed.data.orders.length && (
            <p>
              No CleanCloud Detail orders available. Gumball refreshes while
              Chrome is running.
            </p>
          )}
        </div>
      )}
      {row && (
        <div className="grid gap-3">
          <button
            className={button + " justify-self-start"}
            onClick={() => {
              setSelected(null);
              setReviewed(null);
            }}
          >
            Back to orders
          </button>
          <h4 className="font-semibold">
            #{row.externalOrderId} · {row.sourceJson.customerName}
          </h4>
          <p className="text-sm">Ready by: {row.sourceJson.readyBy}</p>
          {["detail", "review", "attention"].includes(row.state) &&
            !row.submittedAt && (
              <>
                <label>
                  Find CleanCloud item
                  <input
                    className="mt-1 w-full rounded border p-3 text-base"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Dress shirt, pants, laundry…"
                  />
                </label>
                <div className="grid max-h-80 gap-2 overflow-y-auto">
                  {feed
                    .data!.catalog.filter(
                      x =>
                        x.label.toLowerCase().includes(search.toLowerCase()) ||
                        Number(quantities[x.id]) > 0
                    )
                    .map(product => (
                      <label
                        key={product.id}
                        className="flex items-center justify-between gap-3 rounded border bg-white p-2"
                      >
                        <span>
                          {product.label}
                          <small className="block">
                            {product.section} ·{" "}
                            {product.unit === "lb" ? "pounds" : "garments"}
                          </small>
                        </span>
                        <input
                          aria-label={product.label + " quantity"}
                          type="number"
                          min="0"
                          step={product.unit === "lb" ? "0.01" : "1"}
                          className="w-24 rounded border p-3 text-base"
                          value={quantities[product.id] ?? ""}
                          onChange={e =>
                            setQuantities({
                              ...quantities,
                              [product.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                    ))}
                </div>
                <button
                  className={button + " bg-amber-300"}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      if (
                        Object.values(quantities).some(
                          q =>
                            q !== "" &&
                            (!Number.isFinite(Number(q)) || Number(q) < 0)
                        )
                      )
                        throw new Error("Enter nonnegative actual quantities.");
                      const plan = {
                        lines: Object.entries(quantities)
                          .filter(([, q]) => Number(q) > 0)
                          .map(([productId, q]) => ({
                            productId,
                            quantity: Number(q),
                          })),
                      };
                      validateIntakePlan(plan, feed.data!.catalog);
                      await prepare.mutateAsync({ id: row.id, plan });
                    })
                  }
                >
                  Prepare in CleanCloud
                </button>
              </>
            )}
          {row.state === "review" && row.preparedJson && (
            <div
              key={row.revision}
              className="grid gap-3 rounded border bg-white p-3"
            >
              <p>
                Prepared in CleanCloud —{" "}
                {(row.preparedJson.totalCents / 100).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}
              </p>
              <p className="whitespace-pre-line text-sm">
                {row.preparedJson.tableText}
              </p>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void act(() => focus.mutateAsync({ id: row.id }))
                }
              >
                Show prepared CleanCloud order on computer
              </button>
              <label className="flex gap-3">
                <input
                  type="checkbox"
                  checked={reviewed === row.preparedJson.fingerprint}
                  onChange={e =>
                    setReviewed(
                      e.target.checked ? row.preparedJson!.fingerprint : null
                    )
                  }
                />
                I inspected this exact order, its items, quantities, and total
                in CleanCloud.
              </label>
              <button
                className={button + " bg-amber-300"}
                disabled={reviewed !== row.preparedJson.fingerprint || busy}
                onClick={() =>
                  void act(() =>
                    approve.mutateAsync({
                      id: row.id,
                      revision: row.revision!,
                      fingerprint: row.preparedJson!.fingerprint,
                      reviewed: true,
                    })
                  )
                }
              >
                Approve and submit — $
                {(row.preparedJson.totalCents / 100).toFixed(2)}
              </button>
              <p className="text-sm">
                This submits the order in CleanCloud and may charge the
                customer's saved card under your CleanCloud settings.
              </p>
            </div>
          )}
          {["prepare_pending", "preparing"].includes(row.state) && (
            <p role="status">
              Preparing your draft. Keep Chrome running and signed in.
            </p>
          )}
          {[
            "submit_pending",
            "submitting",
            "verify_pending",
            "verifying",
          ].includes(row.state) && (
            <p role="status">
              Waiting for CleanCloud confirmation. Do not submit this order
              elsewhere.
            </p>
          )}
          {row.state === "saved" && (
            <p role="status">
              Order verified in CleanCloud Cleaning. Payment status has not been
              verified.
            </p>
          )}
          {row.state === "attention" && (
            <>
              <p role="alert">{row.lastError}</p>
              {row.submittedAt && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void act(() => verify.mutateAsync({ id: row.id }))
                  }
                >
                  Check saved result — no resubmission
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 text-red-800" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
