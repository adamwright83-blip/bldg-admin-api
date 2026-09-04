import { validateExportUrl } from "./core.js";

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
