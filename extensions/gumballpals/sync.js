import {
  HOSTS,
  GOLDLINE,
  CLEANCLOUD,
  initialRange,
  pacificToday,
  validateRange,
  assertPairing,
} from "./core.js";
import {
  runInTab,
  openSite,
  prepareSource,
  clickExport,
  goldlineRequest,
} from "./browser.js";
import { nextDailyRun } from "./schedule.js";

let scheduled = false;
const $ = id => document.getElementById(id);
let cancelled = false;
let goldlineTab = null;
let sourceTab = null;

const initial = initialRange();
$("from").value = initial.from;
$("to").value = initial.to;
$("to").max = pacificToday();

const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
};

const save = async (phase, extra = {}) => {
  const { run = {} } = await chrome.storage.local.get("run");
  await chrome.storage.local.set({ run: { ...run, ...extra, phase } });
};

const request = (operation, input) =>
  runInTab(
    goldlineTab,
    goldlineRequest,
    input === undefined ? [operation] : [operation, input]
  );

const checkCancelled = () => {
  if (cancelled) throw new Error("Export cancelled before completion.");
};

async function reportRun(stage, message) {
  try {
    const { run } = await chrome.storage.local.get("run");
    if (!goldlineTab || !run?.tenantId || !run?.actorId) return;
    await request("reportFailure", {
      tenantId: run.tenantId,
      actorId: run.actorId,
      ...(run.requestId ? { requestId: run.requestId } : {}),
      stage,
      message: String(message || stage).slice(0, 500),
      ...(run.range?.from ? { from: run.range.from, to: run.range.to } : {}),
    });
  } catch {
    // Telemetry must never change whether a real export is considered complete.
  }
}

async function withLock(work) {
  return navigator.locks.request(
    "goldline-gumball-export",
    { ifAvailable: true },
    async lock => {
      if (!lock) throw new Error("Another Gumball export is already running in this browser.");
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

async function waitForCompletedExport(requestId) {
  // CleanCloud can take more than a minute to construct/download larger reports.
  for (let i = 0; i < 600; i++) {
    checkCancelled();
    const { pendingExport } = await chrome.storage.session.get("pendingExport");
    if (pendingExport?.requestId !== requestId) {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    if (pendingExport.capture?.error) {
      throw new Error(`Chrome download failed: ${pendingExport.capture.error}`);
    }
    if (pendingExport.capture?.completedAt) return pendingExport.capture;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    "The CleanCloud export did not finish within five minutes. The file was not recorded as a successful Gumball export."
  );
}

if (!globalThis.chrome?.runtime?.id) {
  status("Preview only. Install this directory as a Chrome extension to export CleanCloud reports.");
  for (const button of document.querySelectorAll("button")) button.disabled = true;
} else {
  async function scheduleStatus(message) {
    const { schedule } = await chrome.storage.local.get("schedule");
    if (schedule) {
      await chrome.storage.local.set({
        schedule: { ...schedule, status: message },
      });
    }
    await renderSchedule();
  }

  async function renderSchedule() {
    const { schedule } = await chrome.storage.local.get("schedule");
    $("schedule-status").textContent = schedule?.enabled
      ? `Daily at 6:00 PM Pacific. Next: ${new Date(schedule.nextRunAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} Pacific. ${schedule.status || "Ready"}`
      : "Daily export is off.";
  }

  async function startExport() {
    if (
      !(await (scheduled
        ? chrome.permissions.contains({ origins: HOSTS })
        : chrome.permissions.request({ origins: HOSTS })))
    ) {
      status("Site access was not granted. Nothing was exported.", true);
      if (scheduled) await scheduleStatus("blocked: site permission missing");
      return;
    }

    busy(true);
    cancelled = false;
    $("cancel").hidden = false;
    let completedReceipt = null;
    try {
      await withLock(async () => {
        const range = validateRange($("from").value, $("to").value);
        status("Checking the paired Goldline account…");
        goldlineTab = await openSite(GOLDLINE);
        const context = await request("context");
        if (
          context.protocolVersion !== 1 ||
          !context.tenantId ||
          !context.actorId
        ) {
          throw new Error("Goldline's Gumball pairing endpoint is incompatible.");
        }

        if (scheduled) {
          const { schedule } = await chrome.storage.local.get("schedule");
          if (!schedule?.enabled || !context.binding) {
            throw new Error("Daily export is paused or the CleanCloud store is not paired.");
          }
          assertPairing(schedule.pairing, {
            tenantId: context.tenantId,
            actorId: context.actorId,
            storeId: context.binding.storeId,
            storeLabel: context.binding.storeLabel,
          });
        }

        checkCancelled();
        const requestId = crypto.randomUUID();
        await save("preparing", {
          requestId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          range,
        });

        status("Opening Gumball reporting and setting the exact dates…");
        sourceTab = await openSite(`${CLEANCLOUD}/store`);
        const source = await runInTab(sourceTab, prepareSource, [range]);
        checkCancelled();

        if (context.binding && context.binding.storeLabel !== source.storeLabel) {
          throw new Error("The signed-in Gumball store differs from Goldline's paired store.");
        }

        await chrome.storage.session.set({
          pendingExport: {
            requestId,
            range,
            startedAt: Date.now(),
            expiresAt: Date.now() + 5 * 60 * 1000,
          },
        });
        await save("downloading");
        status("Exporting Orders (Sales) to Downloads/Gumball Inbox…");

        try {
          const sourceTabInfo = await chrome.tabs.get(sourceTab);
          await chrome.tabs.update(sourceTab, { active: true });
          if (sourceTabInfo.windowId !== undefined) {
            await chrome.windows.update(sourceTabInfo.windowId, { focused: true });
          }
        } catch {
          // Focus is best effort. The download-completion event remains authoritative.
        }

        // Click once. A file download may interrupt the content-script response.
        await runInTab(sourceTab, clickExport, [source.storeLabel]).catch(() => {});
        const capture = await waitForCompletedExport(requestId);
        checkCancelled();

        if (context.binding && context.binding.storeId !== capture.storeId) {
          throw new Error("The completed export belongs to a different CleanCloud store.");
        }

        // Chrome has now durably completed the real source artifact. Persist that
        // truth before any optional pairing follow-up so pairing/network failure
        // cannot rewrite a successful export as a failed one.
        completedReceipt = {
          requestId,
          storeId: capture.storeId,
          storeLabel: source.storeLabel,
          from: range.from,
          to: range.to,
          completedAt: capture.completedAt,
          relativeFilename: capture.relativeFilename,
          fileSize: capture.fileSize ?? null,
        };
        await save("exported", { receipt: completedReceipt, pairingWarning: null });
        const relative = capture.relativeFilename || "Gumball Inbox";
        status(
          `Export complete: Downloads/${relative}. Gumball is finished; Jawbreaker imports the file independently.`
        );
        await reportRun(
          "exported",
          `Gumball export completed in Downloads/${relative}. Jawbreaker import is a separate stage.`
        );
        if (scheduled) await scheduleStatus("exported to Gumball Inbox");

        const binding =
          context.binding ||
          (await request("pair", {
            tenantId: context.tenantId,
            actorId: context.actorId,
            storeId: capture.storeId,
            storeLabel: source.storeLabel,
          }));

        if (
          binding.storeId !== capture.storeId ||
          binding.storeLabel !== source.storeLabel
        ) {
          throw new Error("Goldline's paired CleanCloud store changed after export.");
        }

        const verifiedPairing = {
          tenantId: context.tenantId,
          actorId: context.actorId,
          storeId: binding.storeId,
          storeLabel: binding.storeLabel,
        };
        await chrome.storage.local.set({ verifiedPairing });
        $("connection").textContent = `${binding.storeLabel} → ${context.accountLabel} · Goldline tenant ${context.tenantId}`;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (completedReceipt) {
        const relative = completedReceipt.relativeFilename || "Gumball Inbox";
        await save("exported", { receipt: completedReceipt, pairingWarning: message });
        status(
          `Export complete: Downloads/${relative}. Pairing follow-up needs attention: ${message}`,
          true
        );
        if (scheduled) await scheduleStatus(`exported; pairing warning: ${message}`);
        await reportRun("pairing", message);
      } else {
        status(message, true);
        if (scheduled) await scheduleStatus(`blocked: ${message}`);
        await reportRun("export", message);
        await save("failed", { message });
      }
    } finally {
      busy(false);
      $("cancel").hidden = true;
      await chrome.storage.session.remove("pendingExport");
    }
  }

  $("start").addEventListener("click", () => {
    scheduled = false;
    void startExport();
  });

  $("enable-schedule").addEventListener("click", async () => {
    const { verifiedPairing } = await chrome.storage.local.get("verifiedPairing");
    if (!verifiedPairing) {
      status("Complete one successful manual Gumball export first so the store pairing is verified.", true);
      return;
    }
    await chrome.storage.local.set({
      schedule: {
        enabled: true,
        pairing: verifiedPairing,
        nextRunAt: nextDailyRun(),
        status: "Ready",
      },
    });
    await renderSchedule();
  });

  $("disable-schedule").addEventListener("click", async () => {
    const { schedule } = await chrome.storage.local.get("schedule");
    await chrome.storage.local.set({
      schedule: { ...schedule, enabled: false },
    });
    await renderSchedule();
  });

  $("cancel").addEventListener("click", () => {
    cancelled = true;
    status("Stopping before Gumball marks the export complete…");
  });

  $("disconnect").addEventListener("click", async () => {
    cancelled = true;
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.permissions.remove({ origins: HOSTS });
    location.reload();
  });

  const { run: saved } = await chrome.storage.local.get("run");
  if (saved?.phase === "preparing" || saved?.phase === "downloading") {
    await save("interrupted", {
      message:
        "The previous Gumball export was interrupted before Chrome confirmed a completed inbox file. It is safe to export again.",
    });
    status(
      "The previous Gumball export was interrupted before Chrome confirmed a completed inbox file. It is safe to export again.",
      true
    );
  } else if (saved?.phase === "exported" && saved.receipt?.relativeFilename) {
    status(
      saved.pairingWarning
        ? `Last Gumball export: Downloads/${saved.receipt.relativeFilename}. Pairing warning: ${saved.pairingWarning}`
        : `Last Gumball export: Downloads/${saved.receipt.relativeFilename}. Jawbreaker import status is separate.`,
      Boolean(saved.pairingWarning)
    );
  } else if (saved?.message) {
    status(saved.message, saved.phase === "failed");
  }

  await renderSchedule();

  const launchToken = new URLSearchParams(location.search).get("scheduled");
  const { scheduledLaunch } = await chrome.storage.session.get("scheduledLaunch");
  if (
    launchToken &&
    scheduledLaunch?.token === launchToken &&
    scheduledLaunch.expiresAt > Date.now()
  ) {
    await chrome.storage.session.remove("scheduledLaunch");
    scheduled = true;
    await startExport();
  }
}
