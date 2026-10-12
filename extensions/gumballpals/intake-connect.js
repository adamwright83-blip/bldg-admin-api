import { runInTab, openSite, goldlineRequest } from "./browser.js";
import { intakePage } from "./intake-page.js";
import { CLEANCLOUD, GOLDLINE, HOSTS } from "./core.js";
const byId = id => document.getElementById(id);
byId("intake-connect").addEventListener("click", async () => {
  const status = byId("intake-status");
  byId("intake-connect").disabled = true;
  try {
    if (
      !(await chrome.permissions.contains({ origins: HOSTS })) &&
      !(await chrome.permissions.request({ origins: HOSTS }))
    )
      throw new Error(
        "Allow your existing CleanCloud and Goldline connection."
      );
    const goldline = await openSite(`${GOLDLINE}/gumballpals`);
    const context = await runInTab(goldline, goldlineRequest, ["context"]);
    if (!context.binding) throw new Error("Pair your store above first.");
    const tab = await openSite(`${CLEANCLOUD}/store`);
    const snapshot = await runInTab(tab, intakePage, [
      "capture",
      { storeLabel: context.binding.storeLabel },
    ]);
    const result = await runInTab(goldline, goldlineRequest, [
      "intake.connect",
      { ...snapshot, bindingId: context.binding.id },
    ]);
    await chrome.storage.session.set({
      intakeGoldlineTab: goldline,
      intakeCaptureTab: tab,
    });
    await chrome.storage.local.set({
      intakeConnection: {
        enabled: true,
        tenantId: context.tenantId,
        actorId: context.actorId,
        bindingId: context.binding.id,
        storeLabel: context.binding.storeLabel,
        lastCaptureAt: Date.now(),
      },
    });
    status.textContent = `${result.imported} Detail orders available. Open Goldline admin Intake on your phone. Every submission requires your inspection and approval.`;
  } catch (e) {
    status.textContent = e.message;
  } finally {
    byId("intake-connect").disabled = false;
  }
});
byId("intake-pause").addEventListener("click", async () => {
  const { intakeConnection } =
    await chrome.storage.local.get("intakeConnection");
  if (intakeConnection)
    await chrome.storage.local.set({
      intakeConnection: { ...intakeConnection, enabled: false },
    });
  try {
    const tab = await openSite(`${GOLDLINE}/gumballpals`);
    await runInTab(tab, goldlineRequest, ["intake.pause"]);
    byId("intake-status").textContent = "Intake pilot paused.";
  } catch (e) {
    byId("intake-status").textContent =
      "This browser is paused. Server pause needs attention: " + e.message;
  }
});
const { intakeConnection, intakePulse } = await chrome.storage.local.get([
  "intakeConnection",
  "intakePulse",
]);
if (intakeConnection?.enabled)
  byId("intake-status").textContent =
    `Intake pilot connected. ${intakePulse?.error ?? "Waiting for your Goldline intake instructions."}`;
