import {
  GUMBALL_INBOX_DIR,
  inboxFilename,
  validateExportUrl,
} from "./core.js";
import { nextDailyRun, scheduleDue, SCHEDULE_NAME } from "./schedule.js";

let scheduling = false;
async function maintainSchedule() {
  if (scheduling) return;
  scheduling = true;
  try {
    const { schedule } = await chrome.storage.local.get("schedule");
    if (!schedule?.enabled) {
      await chrome.alarms.clear(SCHEDULE_NAME);
      return;
    }
    if (scheduleDue(schedule)) {
      const token = crypto.randomUUID();
      // Persist before opening a tab: restarting the worker cannot double-launch.
      await chrome.storage.local.set({
        schedule: {
          ...schedule,
          nextRunAt: nextDailyRun(),
          lastAttemptAt: Date.now(),
          status: "starting",
        },
      });
      await chrome.storage.session.set({
        scheduledLaunch: { token, expiresAt: Date.now() + 60000 },
      });
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`sync.html?scheduled=${token}`),
        active: false,
      });
    }
    const { schedule: current } = await chrome.storage.local.get("schedule");
    if (current?.enabled)
      await chrome.alarms.create(SCHEDULE_NAME, { when: current.nextRunAt });
  } finally {
    scheduling = false;
  }
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SCHEDULE_NAME) void maintainSchedule();
});
chrome.runtime.onStartup.addListener(() => void maintainSchedule());
chrome.runtime.onInstalled.addListener(() => void maintainSchedule());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.schedule) void maintainSchedule();
});
void maintainSchedule();

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.action.onClicked.addListener(() =>
  chrome.tabs.create({ url: chrome.runtime.getURL("sync.html") })
);

/**
 * Gumball's durable handoff ends at Chrome's completed file. While an export is
 * explicitly armed by sync.js, route only that validated CleanCloud Orders
 * (Sales) download into Downloads/Gumball Inbox. Chrome itself creates the
 * subdirectory and keeps partial bytes under its normal temporary download
 * state until completion.
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let answered = false;
  const finish = proposal => {
    if (answered) return;
    answered = true;
    suggest(proposal);
  };

  void (async () => {
    const { pendingExport } = await chrome.storage.session.get("pendingExport");
    if (
      !pendingExport ||
      Date.now() > pendingExport.expiresAt ||
      pendingExport.capture
    ) {
      finish();
      return;
    }
    try {
      const capture = validateExportUrl(
        item.finalUrl || item.url,
        pendingExport.range
      );
      if (item.startTime && Date.parse(item.startTime) < pendingExport.startedAt) {
        finish();
        return;
      }
      const baseName = inboxFilename({
        storeId: capture.storeId,
        from: capture.from,
        to: capture.to,
        requestId: pendingExport.requestId,
      });
      const relativeFilename = `${GUMBALL_INBOX_DIR}/${baseName}`;
      await chrome.storage.session.set({
        pendingExport: {
          ...pendingExport,
          capture: {
            ...capture,
            downloadId: item.id,
            relativeFilename,
            startedAt: item.startTime || new Date().toISOString(),
          },
        },
      });
      finish({ filename: relativeFilename, conflictAction: "uniquify" });
    } catch {
      // Unrelated download: leave Chrome's filename untouched.
      finish();
    }
  })().catch(() => finish());

  return true;
});

chrome.downloads.onChanged.addListener(async delta => {
  const { pendingExport } = await chrome.storage.session.get("pendingExport");
  if (!pendingExport?.capture || pendingExport.capture.downloadId !== delta.id)
    return;

  if (delta.error?.current) {
    await chrome.storage.session.set({
      pendingExport: {
        ...pendingExport,
        capture: {
          ...pendingExport.capture,
          error: delta.error.current,
        },
      },
    });
    return;
  }

  if (delta.state?.current !== "complete") return;
  const [download] = await chrome.downloads.search({ id: delta.id });
  await chrome.storage.session.set({
    pendingExport: {
      ...pendingExport,
      capture: {
        ...pendingExport.capture,
        completedAt: new Date().toISOString(),
        fileSize: download?.fileSize ?? null,
        // Never send the absolute local path to Goldline. The relative inbox
        // identity is sufficient for durable provenance and Jawbreaker pickup.
        relativeFilename: pendingExport.capture.relativeFilename,
      },
    },
  });
});
