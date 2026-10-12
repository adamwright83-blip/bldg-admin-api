import { runInTab, openSite, goldlineRequest } from "./browser.js";
import { pickupPage } from "./pickup-page.js";
import { CLEANCLOUD, GOLDLINE } from "./core.js";
export const PICKUP_ALARM = "gumball-driver-pickups";
let running = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ownedTab(key, url) {
  const saved = await chrome.storage.session.get(key);
  if (saved[key]) {
    try {
      const tab = await chrome.tabs.get(saved[key]);
      if (tab.url?.startsWith(url)) return tab.id;
    } catch {
      /* closed own tab */
    }
  }
  const id = await openSite(url);
  await chrome.storage.session.set({ [key]: id });
  return id;
}
async function reloadSource(tabId) {
  await chrome.tabs.reload(tabId);
  for (let i = 0; i < 150; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await pause(100);
  }
  throw new Error("CleanCloud did not reload. Pickup update needs attention.");
}
export async function runPickupWorker() {
  if (running) return;
  running = true;
  let config;
  try {
    while (true) {
      ({ pickupConnection: config } =
        await chrome.storage.local.get("pickupConnection"));
      if (!config?.enabled) return;
      const goldlineTab = await ownedTab(
        "pickupGoldlineTab",
        `${GOLDLINE}/gumballpals`
      );
      const request = (operation, input) =>
        runInTab(goldlineTab, goldlineRequest, [`pickups.${operation}`, input]);
      const current = await request("connection");
      if (
        current.tenantId !== config.tenantId ||
        current.actorId !== config.actorId ||
        !current.connection?.enabled ||
        current.connection.bindingId !== config.bindingId ||
        current.binding?.storeLabel !== config.storeLabel
      )
        throw new Error(
          "Gumball pickup account changed or paused. Reconnect the driver pickup connection."
        );
      const sourceTab = await ownedTab(
        "pickupSourceTab",
        `${CLEANCLOUD}/store`
      );
      const source = {
        bindingId: config.bindingId,
        storeLabel: config.storeLabel,
      };
      if (
        !config.lastCaptureAt ||
        Date.now() - config.lastCaptureAt >= 60_000
      ) {
        await reloadSource(sourceTab);
        const snapshot = await runInTab(sourceTab, pickupPage, [
          "capture",
          source,
        ]);
        await request("capture", { ...snapshot, bindingId: config.bindingId });
        config = { ...config, lastCaptureAt: Date.now() };
        await chrome.storage.local.set({ pickupConnection: config });
      }
      const command = await request("claim", source);
      if (command) {
        let proof, updateError;
        try {
          await reloadSource(sourceTab);
          proof = await runInTab(sourceTab, pickupPage, ["verify", command]);
          if (!proof.verified) {
            const latest = (await chrome.storage.local.get("pickupConnection"))
              .pickupConnection;
            if (!latest?.enabled || latest.bindingId !== config.bindingId)
              throw new Error("Pickup worker paused before Collected.");
            const lease = await request("renew", {
              ...source,
              id: command.id,
              leaseToken: command.leaseToken,
            });
            if (!lease)
              throw new Error(
                "Pickup lease expired before Collected. It will be checked again."
              );
            try {
              await runInTab(sourceTab, pickupPage, [
                "collect",
                { ...command, leaseUntil: lease.leaseUntil },
              ]);
            } catch (error) {
              updateError = error.message;
            }
            await reloadSource(sourceTab);
            proof = await runInTab(sourceTab, pickupPage, ["verify", command]);
          }
        } catch (error) {
          updateError = error.message;
        }
        await request("receipt", {
          ...source,
          id: command.id,
          leaseToken: command.leaseToken,
          verified: Boolean(proof?.verified),
          externalOrderId: command.externalOrderId,
          customerName: command.customerName,
          detailRowId: proof?.detailRowId ?? null,
          observedAt: proof?.observedAt ?? new Date().toISOString(),
          ...(proof?.verified
            ? {}
            : {
                error: (
                  updateError ??
                  "Collected could not be verified in CleanCloud Detail."
                ).slice(0, 512),
              }),
        });
      }
      await chrome.storage.local.set({
        pickupPulse: { checkedAt: Date.now(), error: null },
      });
      // Chrome extension API calls on each pass reset the service worker idle
      // timer. The alarm/startup hooks also resume after a crash or sleep.
      await pause(5000);
    }
  } catch (error) {
    await chrome.storage.local.set({
      pickupPulse: { checkedAt: Date.now(), error: error.message },
    });
  } finally {
    running = false;
  }
}
export async function resumePickupWorker() {
  const { pickupConnection } =
    await chrome.storage.local.get("pickupConnection");
  if (pickupConnection?.enabled) {
    await chrome.alarms.create(PICKUP_ALARM, { periodInMinutes: 1 });
    void runPickupWorker();
  } else await chrome.alarms.clear(PICKUP_ALARM);
}
