import { runInTab, openSite, goldlineRequest } from "./browser.js";
import { intakePage } from "./intake-page.js";
import { CLEANCLOUD, GOLDLINE } from "./core.js";
export const INTAKE_ALARM = "gumball-intake-pilot";
let running = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function owned(key, url) {
  const saved = await chrome.storage.session.get(key);
  if (saved[key]) {
    try {
      const tab = await chrome.tabs.get(saved[key]);
      if (tab.url?.startsWith(url)) return tab.id;
    } catch {}
  }
  const id = await openSite(url);
  await chrome.storage.session.set({ [key]: id });
  return id;
}
export async function runIntakeWorker() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const { intakeConnection: config } =
        await chrome.storage.local.get("intakeConnection");
      if (!config?.enabled) return;
      const goldline = await owned(
        "intakeGoldlineTab",
        `${GOLDLINE}/gumballpals`
      );
      const rpc = (name, input) =>
        runInTab(goldline, goldlineRequest, ["intake." + name, input]);
      const current = await rpc("connection");
      if (
        current.tenantId !== config.tenantId ||
        current.actorId !== config.actorId ||
        !current.intake?.enabled ||
        current.intake.bindingId !== config.bindingId ||
        current.binding?.storeLabel !== config.storeLabel
      )
        throw new Error("Intake paired account changed. Reconnect Gumball.");
      const source = {
        bindingId: config.bindingId,
        storeLabel: config.storeLabel,
      };
      if (!config.lastCaptureAt || Date.now() - config.lastCaptureAt >= 60000) {
        const captureTab = await owned(
          "intakeCaptureTab",
          `${CLEANCLOUD}/store`
        );
        await chrome.tabs.reload(captureTab);
        for (let i = 0; i < 150; i++) {
          if ((await chrome.tabs.get(captureTab)).status === "complete") break;
          if (i === 149)
            throw new Error("CleanCloud capture tab did not load.");
          await pause(100);
        }
        const snapshot = await runInTab(captureTab, intakePage, [
          "capture",
          source,
        ]);
        await rpc("capture", { ...snapshot, bindingId: config.bindingId });
        await chrome.storage.local.set({
          intakeConnection: { ...config, lastCaptureAt: Date.now() },
        });
      }
      const command = await rpc("claim", source);
      if (command) {
        const key = "intakeDraft_" + command.id + "_" + command.revision;
        const { [key]: draft } = await chrome.storage.session.get(key);
        if (command.operation === "focus") {
          if (draft) await chrome.tabs.update(draft.tabId, { active: true });
        } else {
          let proof, error;
          try {
            const expected = { ...command, ...source };
            if (command.operation === "prepare") {
              const tabId = await openSite(`${CLEANCLOUD}/store`);
              await chrome.storage.session.set({
                [key]: { tabId, attempted: false },
              });
              proof = {
                prepared: await runInTab(tabId, intakePage, [
                  "prepare",
                  expected,
                ]),
              };
            } else if (command.operation === "submit") {
              if (!draft || draft.attempted)
                throw new Error(
                  "Prepared tab unavailable or submission already attempted. Check saved result."
                );
              await chrome.tabs.get(draft.tabId);
              const latest = (
                await chrome.storage.local.get("intakeConnection")
              ).intakeConnection;
              if (!latest?.enabled || latest.bindingId !== config.bindingId)
                throw new Error("Intake worker paused before Submit.");
              await rpc("authorize", {
                ...source,
                id: command.id,
                revision: command.revision,
                leaseToken: command.leaseToken,
              });
              // Persist before the click, including across extension service-worker restarts.
              await chrome.storage.session.set({
                [key]: { ...draft, attempted: true },
              });
              await runInTab(draft.tabId, intakePage, ["submit", expected]);
              await pause(2500);
              // Do not dismiss unknown payment or confirmation dialogs. A fresh separate tab
              // reads the saved queue without disrupting the submitted draft or card modal.
              const verifyTab = await openSite(`${CLEANCLOUD}/store`);
              proof = await runInTab(verifyTab, intakePage, [
                "verify",
                expected,
              ]);
            } else {
              const verifyTab = await openSite(`${CLEANCLOUD}/store`);
              proof = await runInTab(verifyTab, intakePage, [
                "verify",
                expected,
              ]);
            }
          } catch (e) {
            error = e.message;
          }
          await rpc("receipt", {
            ...source,
            id: command.id,
            revision: command.revision,
            leaseToken: command.leaseToken,
            ...(proof ?? {}),
            ...(error ? { error: error.slice(0, 512) } : {}),
          });
        }
      }
      await chrome.storage.local.set({
        intakePulse: { checkedAt: Date.now(), error: null },
      });
      await pause(5000);
    }
  } catch (e) {
    await chrome.storage.local.set({
      intakePulse: { checkedAt: Date.now(), error: e.message },
    });
  } finally {
    running = false;
  }
}
export async function resumeIntakeWorker() {
  const { intakeConnection } =
    await chrome.storage.local.get("intakeConnection");
  if (intakeConnection?.enabled) {
    await chrome.alarms.create(INTAKE_ALARM, { periodInMinutes: 1 });
    void runIntakeWorker();
  } else await chrome.alarms.clear(INTAKE_ALARM);
}
