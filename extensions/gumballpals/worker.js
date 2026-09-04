import { validateExportUrl } from "./core.js";
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

// Passive listener: never search download history, open files, erase downloads,
// or cancel another download. Only capture a matching, explicitly armed export.
chrome.downloads.onCreated.addListener(async item => {
  const { pendingExport } = await chrome.storage.session.get("pendingExport");
  if (
    !pendingExport ||
    Date.now() > pendingExport.expiresAt ||
    pendingExport.capture
  )
    return;
  try {
    const capture = validateExportUrl(
      item.finalUrl || item.url,
      pendingExport.range
    );
    if (item.startTime && Date.parse(item.startTime) < pendingExport.startedAt)
      return;
    await chrome.storage.session.set({
      pendingExport: {
        ...pendingExport,
        capture: { ...capture, downloadId: item.id },
      },
    });
  } catch {
    /* unrelated download; do not inspect or retain it */
  }
});
