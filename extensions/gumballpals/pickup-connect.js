import { runInTab, openSite, goldlineRequest } from "./browser.js";
import { pickupPage } from "./pickup-page.js";
import { HOSTS, GOLDLINE, CLEANCLOUD } from "./core.js";
const byId = id => document.getElementById(id);
let prepared = null;
const status = message => {
  byId("pickup-status").textContent = message;
};
const holds = () =>
  byId("pickup-holds")
    .value.split(/[\s,]+/)
    .filter(Boolean);
async function rpc(tab, operation, input) {
  return runInTab(tab, goldlineRequest, [operation, input]);
}
byId("pickup-prepare").addEventListener("click", async () => {
  try {
    if (
      !(await chrome.permissions.contains({ origins: HOSTS })) &&
      !(await chrome.permissions.request({ origins: HOSTS }))
    )
      throw new Error(
        "Allow the existing CleanCloud and Goldline connection to continue."
      );
    byId("pickup-prepare").disabled = true;
    status("Reading your paired account and current CleanCloud pickups…");
    const goldlineTab = await openSite(`${GOLDLINE}/gumballpals`);
    const context = await rpc(goldlineTab, "context");
    if (!context.binding)
      throw new Error(
        "Pair your CleanCloud store using the connection above first."
      );
    const sourceTab = await openSite(`${CLEANCLOUD}/store`);
    const snapshot = await runInTab(sourceTab, pickupPage, [
      "capture",
      { storeLabel: context.binding.storeLabel },
    ]);
    const excludedOrderIds = holds();
    if (excludedOrderIds.some(id => !/^[1-9]\d{0,15}$/.test(id)))
      throw new Error("Held order IDs must be numbers, separated by commas.");
    const list = byId("pickup-review");
    list.replaceChildren();
    for (const row of snapshot.rows) {
      const item = document.createElement("li");
      item.textContent = `${excludedOrderIds.includes(row.externalOrderId) ? "ON HOLD · " : ""}#${row.externalOrderId} · ${row.customerName} · ${row.scheduledDate} ${row.windowStart}–${row.windowEnd} · ${row.address}`;
      list.append(item);
    }
    prepared = { goldlineTab, sourceTab, context, snapshot, excludedOrderIds };
    byId("pickup-confirm").hidden = false;
    status(
      `${context.binding.storeLabel} → ${context.accountLabel}. Confirm the pickup feed and Collected updates triggered by Picked up in DAYLINE.`
    );
  } catch (error) {
    status(error.message);
  } finally {
    byId("pickup-prepare").disabled = false;
  }
});
byId("pickup-confirm").addEventListener("click", async () => {
  if (!prepared) return;
  byId("pickup-confirm").disabled = true;
  try {
    const { goldlineTab, sourceTab, context, snapshot, excludedOrderIds } =
      prepared;
    const latest = await runInTab(sourceTab, pickupPage, [
      "capture",
      { storeLabel: context.binding.storeLabel },
    ]);
    if (
      JSON.stringify(latest.rows) !== JSON.stringify(snapshot.rows) ||
      JSON.stringify(holds()) !== JSON.stringify(excludedOrderIds)
    )
      throw new Error(
        "The pickup list or holds changed. Review the connection again."
      );
    const result = await rpc(goldlineTab, "pickups.connect", {
      ...latest,
      bindingId: context.binding.id,
      excludedOrderIds,
    });
    await chrome.storage.session.set({
      pickupGoldlineTab: goldlineTab,
      pickupSourceTab: sourceTab,
    });
    await chrome.storage.local.set({
      pickupConnection: {
        enabled: true,
        tenantId: context.tenantId,
        actorId: context.actorId,
        bindingId: context.binding.id,
        storeLabel: context.binding.storeLabel,
        lastCaptureAt: Date.now(),
      },
    });
    byId("pickup-confirm").hidden = true;
    status(
      `${result.imported} pickups connected; ${result.excluded} held. Picked up in DAYLINE now queues a verified Collected update. Chrome must stay running and signed in.`
    );
    prepared = null;
  } catch (error) {
    status(error.message);
  } finally {
    byId("pickup-confirm").disabled = false;
  }
});
byId("pickup-pause").addEventListener("click", async () => {
  const { pickupConnection } =
    await chrome.storage.local.get("pickupConnection");
  if (pickupConnection)
    await chrome.storage.local.set({
      pickupConnection: { ...pickupConnection, enabled: false },
    });
  status(
    "This browser's pickup worker is paused. Recorded pickups remain saved."
  );
});
const { pickupConnection, pickupPulse } = await chrome.storage.local.get([
  "pickupConnection",
  "pickupPulse",
]);
if (pickupConnection?.enabled)
  status(
    `Driver pickups connected to ${pickupConnection.storeLabel}. ${pickupPulse?.error ?? "Waiting for the next pickup."}`
  );
