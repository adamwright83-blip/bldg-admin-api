import {
  HOSTS,
  MAX_BYTES,
  GOLDLINE,
  CLEANCLOUD,
  initialRange,
  pacificToday,
  validateRange,
  validateExportUrl,
  parseCsv,
  assertPairing,
  recoveryState,
} from "./core.js";
import {
  runInTab,
  openSite,
  prepareSource,
  clickExport,
  fetchReport,
  goldlineRequest,
} from "./browser.js";
const $ = id => document.getElementById(id);
let cancelled = false,
  staged = null,
  goldlineTab = null,
  sourceTab = null;
const initial = initialRange();
$("from").value = initial.from;
$("to").value = initial.to;
$("to").max = pacificToday();
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
};
const checkCancelled = () => {
  if (cancelled)
    throw new Error("Cancelled before import. No import was submitted.");
};
const save = async (phase, extra = {}) => {
  const { run = {} } = await chrome.storage.local.get("run");
  await chrome.storage.local.set({ run: { ...run, ...extra, phase } });
};
const request = (operation, input) =>
  runInTab(goldlineTab, goldlineRequest, [operation, input]);
const uuid = () => crypto.randomUUID();

if (!globalThis.chrome?.runtime?.id) {
  status(
    "Preview only. Install this directory as a Chrome extension to connect your accounts."
  );
  for (const button of document.querySelectorAll("button"))
    button.disabled = true;
} else {
  function showReceipt(receipt) {
    $("receipt").hidden = false;
    $("receipt-summary").textContent =
      `${receipt.inserted} new · ${receipt.updated} updated · ${receipt.unchanged} unchanged · ${receipt.unresolved} unresolved building associations. Totals below describe this report, not additional revenue from this sync.`;
    $("totals").replaceChildren();
    for (const aggregate of receipt.byBuildingAndPaymentDate || []) {
      const row = document.createElement("tr");
      const building =
        {
          opus_la: "OPUS LA",
          century_park_east: "Century Park East",
          unknown: "Unresolved",
        }[aggregate.building] || aggregate.building;
      for (const value of [
        building,
        aggregate.paymentDate,
        aggregate.orders,
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(aggregate.cents / 100),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      $("totals").append(row);
    }
    $("receipt-scope").textContent = receipt.scope;
    $("receipt-time").textContent =
      `Confirmed ${receipt.completedAt} · Receipt ${receipt.requestId}`;
  }

  async function withLock(work) {
    return navigator.locks.request(
      "goldline-cleancloud-sync",
      { ifAvailable: true },
      async lock => {
        if (!lock)
          throw new Error(
            "Another Goldline sync tab is running. Finish or close that tab first."
          );
        return work();
      }
    );
  }
  function busy(value) {
    $("start").disabled = value;
    $("from").disabled = value;
    $("to").disabled = value;
    $("disconnect").disabled = value;
  }

  $("start").addEventListener("click", async () => {
    // Permission request stays directly in the user's gesture.
    if (!(await chrome.permissions.request({ origins: HOSTS }))) {
      status("Site access was not granted. Nothing imported.", true);
      return;
    }
    busy(true);
    cancelled = false;
    staged = null;
    $("approval").hidden = true;
    $("cancel").hidden = false;
    try {
      await withLock(async () => {
        const { run: oldRun } = await chrome.storage.local.get("run");
        if (oldRun && ["importing", "outcome_unknown"].includes(oldRun.phase))
          throw new Error(
            "Check the interrupted import receipt before starting another run."
          );
        const range = validateRange($("from").value, $("to").value);
        status("Checking your signed-in Goldline account…");
        goldlineTab = await openSite(GOLDLINE);
        const context = await request("context");
        if (
          context.protocolVersion !== 1 ||
          !context.tenantId ||
          !context.actorId
        )
          throw new Error("Goldline browser-sync backend is incompatible.");
        checkCancelled();
        const requestId = uuid();
        await save("preparing", {
          requestId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          range,
        });
        status("Opening gumball reporting and setting the exact dates…");
        sourceTab = await openSite(`${CLEANCLOUD}/store`);
        const source = await runInTab(sourceTab, prepareSource, [range]);
        checkCancelled();
        if (context.binding && context.binding.storeLabel !== source.storeLabel)
          throw new Error(
            "gumball store differs from the paired store. Nothing imported."
          );
        await chrome.storage.session.set({
          pendingExport: {
            requestId,
            range,
            startedAt: Date.now(),
            expiresAt: Date.now() + 60000,
          },
        });
        await save("downloading");
        status("Retrieving the normal gumball report…");
        // A download may interrupt the response channel; don't click again. The
        // independently registered worker observes the actual download instead.
        await runInTab(sourceTab, clickExport, [source.storeLabel]).catch(
          () => {}
        );
        let captured;
        for (let i = 0; i < 300; i++) {
          checkCancelled();
          const { pendingExport } =
            await chrome.storage.session.get("pendingExport");
          if (pendingExport?.requestId === requestId && pendingExport.capture) {
            captured = pendingExport.capture;
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }
        await chrome.storage.session.remove("pendingExport");
        if (!captured)
          throw new Error(
            "Chrome did not provide the expected report download. Check the gumball tab; no import was submitted."
          );
        const capture = validateExportUrl(captured.url, range);
        if (context.binding && context.binding.storeId !== capture.storeId)
          throw new Error("Export belongs to a different gumball store.");
        // Fetch the same normal export in a fresh signed-in source tab. Chrome's
        // downloads API does not expose bytes and no filesystem permission is used.
        const readTab = await openSite(`${CLEANCLOUD}/store`);
        const report = await runInTab(readTab, fetchReport, [
          capture.url,
          source.storeLabel,
          MAX_BYTES,
        ]);
        await chrome.tabs.remove(readTab);
        checkCancelled();
        await save("validating");
        const rows = parseCsv(report.csv);
        staged = {
          ...range,
          requestId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          storeId: capture.storeId,
          storeLabel: source.storeLabel,
          exportUrl: capture.url,
          csv: report.csv,
          bindingId: context.binding?.id,
        };
        $("connection").textContent =
          `${source.storeLabel} → ${context.accountLabel} · Goldline tenant ${context.tenantId}`;
        $("pair-details").textContent =
          `${rows.length} order records from ${source.storeLabel} (store ${capture.storeId}), ${range.from} through ${range.to}, will go to Goldline tenant ${context.tenantId}.`;
        $("approval").hidden = false;
        status("Report retrieved. Confirm the destination before importing.");
        await save("awaiting_confirmation");
      });
    } catch (error) {
      status(error.message, true);
      const { run } = await chrome.storage.local.get("run");
      if (!["importing", "outcome_unknown"].includes(run?.phase))
        await save("failed");
      $("check").hidden = !["importing", "outcome_unknown"].includes(
        run?.phase
      );
    } finally {
      busy(false);
      $("cancel").hidden = true;
      await chrome.storage.session.remove("pendingExport");
    }
  });

  $("confirm").addEventListener("click", async () => {
    if (!staged) return;
    busy(true);
    $("confirm").disabled = true;
    try {
      await withLock(async () => {
        const { run: pending } = await chrome.storage.local.get("run");
        if (
          pending?.requestId !== staged.requestId ||
          pending.phase !== "awaiting_confirmation"
        )
          throw new Error(
            "This preview was superseded by another sync. Prepare it again."
          );
        const context = await request("context");
        assertPairing(
          { ...staged },
          {
            tenantId: context.tenantId,
            actorId: context.actorId,
            storeId: staged.storeId,
            storeLabel: staged.storeLabel,
          }
        );
        const binding =
          context.binding ||
          (await request("pair", {
            tenantId: staged.tenantId,
            actorId: staged.actorId,
            storeId: staged.storeId,
            storeLabel: staged.storeLabel,
          }));
        if (
          binding.storeId !== staged.storeId ||
          binding.storeLabel !== staged.storeLabel
        )
          throw new Error("Store pairing changed.");
        await save("importing");
        status(
          "Importing atomically. Keep this tab open; cancellation is no longer available."
        );
        const receipt = await request("import", {
          ...staged,
          bindingId: binding.id,
        });
        staged = null;
        await save("completed", { receipt });
        showReceipt(receipt);
        $("approval").hidden = true;
        status("Import confirmed. Your source records are saved in Goldline.");
      });
    } catch (error) {
      const { run } = await chrome.storage.local.get("run");
      if (run?.phase === "importing") {
        await save("outcome_unknown");
        $("check").hidden = false;
        status(
          "Connection interrupted. The import may have committed. Check its receipt before retrying.",
          true
        );
      } else status(error.message, true);
    } finally {
      busy(false);
      $("confirm").disabled = false;
    }
  });
  $("cancel").addEventListener("click", () => {
    cancelled = true;
    staged = null;
    $("approval").hidden = true;
    status("Stopping before import…");
  });
  $("check").addEventListener("click", async () => {
    try {
      await withLock(async () => {
        const { run } = await chrome.storage.local.get("run");
        goldlineTab = await openSite(GOLDLINE);
        const { receipt } = await request("resolve", {
          tenantId: run.tenantId,
          actorId: run.actorId,
          requestId: run.requestId,
        });
        if (receipt?.status === "cancelled") {
          staged = null;
          await save("cancelled");
          $("check").hidden = true;
          $("approval").hidden = true;
          status(
            "No import committed. The old request is now blocked server-side; you can safely start again."
          );
        } else if (receipt) {
          showReceipt(receipt);
          await save("completed", { receipt });
          $("check").hidden = true;
          status("The server confirmed this import.");
        }
      });
    } catch (error) {
      status(error.message, true);
    }
  });
  $("disconnect").addEventListener("click", async () => {
    const { run } = await chrome.storage.local.get("run");
    if (["importing", "outcome_unknown"].includes(run?.phase)) {
      status("Resolve the interrupted import before disconnecting.", true);
      return;
    }
    staged = null;
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.permissions.remove({ origins: HOSTS });
    location.reload();
  });
  const { run: saved } = await chrome.storage.local.get("run");
  const recovered = recoveryState(saved);
  if (recovered) {
    await chrome.storage.local.set({ run: recovered });
    if (recovered.receipt) showReceipt(recovered.receipt);
    if (recovered.message) status(recovered.message, true);
    $("check").hidden = recovered.phase !== "outcome_unknown";
  }
}
