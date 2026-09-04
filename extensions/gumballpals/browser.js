import { GOLDLINE, CLEANCLOUD, MAX_BYTES } from "./core.js";

export async function runInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func,
    args,
  });
  const result = results.find(r => r.frameId === 0)?.result;
  if (!result || !result.ok)
    throw new Error(
      result?.error || "Browser operation interrupted. Check the source tab."
    );
  return result.value;
}

export async function openSite(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  for (let i = 0; i < 100; i++) {
    const current = await chrome.tabs.get(tab.id);
    if (current.status === "complete") return tab.id;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Page did not finish loading. Sign in and retry.");
}

// All actions and selectors below were grounded in the visible gumball export
// UI. No application internals, cookies, localStorage or private API are read.
export async function prepareSource(range) {
  let stage = "opening reporting";
  try {
    if (
      location.origin !== "https://cleancloudapp.com" ||
      location.pathname !== "/store"
    )
      throw new Error("Open the signed-in gumball store.");
    const pause = () => new Promise(r => setTimeout(r, 100));
    const visible = e =>
      e &&
      e.getClientRects().length &&
      getComputedStyle(e).visibility !== "hidden";
    const wait = async predicate => {
      for (let i = 0; i < 100; i++) {
        const v = predicate();
        if (v) return v;
        await pause();
      }
      throw new Error(
        `gumball preparation stopped while ${stage}. The expected control did not become available.`
      );
    };
    const exact = (root, selector, text) =>
      [...root.querySelectorAll(selector)].filter(
        e => visible(e) && e.textContent.trim() === text
      );
    const clickOne = elements => {
      if (elements.length !== 1)
        throw new Error("Ambiguous reporting control. Sync stopped.");
      elements[0].click();
    };
    const storeLabel = document.title
      .replace(/\s*\|\s*CleanCloud\s*$/, "")
      .trim();
    if (!storeLabel || !document.title.endsWith("CleanCloud"))
      throw new Error("Sign into gumball first.");
    if (!visible(document.querySelector("#metricsContainer"))) {
      (await wait(() => document.querySelector("#accountShow"))).click();
      (
        await wait(
          () =>
            visible(document.querySelector("#slide6")) &&
            document.querySelector("#slide6")
        )
      ).click();
    }
    const metrics = await wait(
      () =>
        visible(document.querySelector("#metricsContainer")) &&
        document.querySelector("#metricsContainer")
    );
    clickOne(exact(metrics, "a", "Data Export"));
    // Report navigation can replace the metrics subtree. Never keep querying
    // the pre-navigation element after the asynchronous report loads.
    const reportRoot = () => document.querySelector("#metricsContainer");
    stage = "loading the export form";
    const exportButton = await wait(() =>
      reportRoot()?.querySelector("#submit_export_button")
    );
    const input = await wait(() =>
      reportRoot()?.querySelector('input[placeholder="Export Type"]')
    );
    const reportSelect = input.closest(".multiselect");
    stage = "selecting Orders (Sales)";
    // Vue Multiselect opens on mousedown, not click. HTMLElement.click()
    // skips that event and leaves all options hidden.
    reportSelect.querySelector(".multiselect__select").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })
    );
    clickOne(
      await wait(() => {
        const es = exact(
          reportSelect,
          ".multiselect__option",
          "Orders (Sales)"
        );
        return es.length ? es : null;
      })
    );
    stage = "checking the selected store";
    const storesInput = await wait(() =>
      reportRoot()?.querySelector('input[placeholder="Pick Stores"]')
    );
    const storeSelect = storesInput.closest(".multiselect");
    const selected = [
      ...storeSelect.querySelectorAll(".multiselect__option--selected"),
    ].map(e => e.textContent.trim().replace(/\s+-\s*$/, ""));
    if (selected.length !== 1 || selected[0] !== storeLabel)
      throw new Error(
        "Select exactly the currently signed-in store. Group exports are not supported."
      );
    stage = "setting the requested dates";
    const dateInput = reportRoot().querySelector("#undefined-input");
    if (!dateInput) throw new Error("Date picker changed.");
    dateInput.focus();
    dateInput.click();
    stage = "locating the open date calendar (build 0.1.6)";
    // The picker can be portalled outside the report container. Match its
    // input-derived calendar ID, and require exactly one visible instance.
    const calendarId = dateInput.id.replace(/-input$/, "") + "-picker-container-DatePicker";
    const picker = await wait(() => {
      const calendars = [...document.querySelectorAll(".datetimepicker")].filter(e =>
        visible(e) && [...e.querySelectorAll("[id]")].some(node => node.id === calendarId)
      );
      return calendars.length === 1 ? calendars[0] : null;
    });
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    async function pickDate(iso) {
      stage = `selecting ${iso} (build 0.1.6)`;
      const [year, month, day] = iso.split("-").map(Number);
      for (let i = 0; i < 25; i++) {
        const labels = await wait(() => {
          const values = [
          ...picker.querySelectorAll(
            ".datepicker-container-label .custom-button-content"
          ),
          ].filter(visible).map(e => e.textContent.trim());
          const animating = picker.matches('[class*="-enter-active"], [class*="-leave-active"]') ||
            picker.querySelector('[class*="-enter-active"], [class*="-leave-active"]');
          return !animating && values.length === 2 ? values : null;
        });
        const currentMonth = monthNames.indexOf(labels[0]) + 1,
          currentYear = Number(labels[1]);
        if (!currentMonth || !currentYear)
          throw new Error("Unrecognized calendar.");
        const delta = (year - currentYear) * 12 + month - currentMonth;
        if (!delta) {
          clickOne(await wait(() => {
            const days = exact(picker, "button.datepicker-day.enable", String(day));
            return days.length === 1 ? days : null;
          }));
          await pause();
          return;
        }
        const arrow = picker.querySelector(
          delta < 0 ? ".datepicker-prev" : ".datepicker-next"
        );
        if (!arrow || arrow.disabled) throw new Error("Date is unavailable.");
        arrow.click();
        await wait(() => {
          const values = [...picker.querySelectorAll(".datepicker-container-label .custom-button-content")]
            .filter(visible).map(e => e.textContent.trim());
          return values.length === 2 && values.join("|") !== labels.join("|");
        });
      }
      throw new Error("Date range is too far from the current calendar.");
    }
    await pickDate(range.from);
    await pickDate(range.to);
    stage = "checking export availability (build 0.1.6)";
    // The captured export URL is checked against both requested dates before import.
    if (exportButton.disabled)
      throw new Error("Report export is not available.");
    return {
      ok: true,
      value: { storeLabel, range, reportType: "orders_sales" },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function clickExport(expectedStoreLabel) {
  try {
    if (
      location.origin !== "https://cleancloudapp.com" ||
      document.title.replace(/\s*\|\s*CleanCloud\s*$/, "").trim() !==
        expectedStoreLabel
    )
      throw new Error("gumball account changed.");
    const button = document.querySelector(
      "#metricsContainer #submit_export_button"
    );
    if (!button || button.disabled)
      throw new Error("Export button unavailable.");
    button.click();
    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function fetchReport(url, expectedStoreLabel, maxBytes) {
  try {
    const target = new URL(url);
    if (
      location.origin !== "https://cleancloudapp.com" ||
      target.origin !== location.origin ||
      target.pathname !== "/include/data-export-endpoint.php"
    )
      throw new Error("Unexpected report origin.");
    if (
      document.title.replace(/\s*\|\s*CleanCloud\s*$/, "").trim() !==
      expectedStoreLabel
    )
      throw new Error("gumball account changed.");
    const response = await fetch(target.href, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    if (
      !response.ok ||
      /text\/html/i.test(response.headers.get("content-type") || "")
    )
      throw new Error("Report unavailable. Check login and export permission.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Report exceeds 4 MB. Use a shorter period.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      ok: true,
      value: {
        csv: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        contentType: response.headers.get("content-type"),
      },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Only these purpose-built operations can be invoked. No generic URL proxy,
// page-message listener, shared secret, or cross-origin CORS relaxation.
export async function goldlineRequest(operation, input) {
  try {
    if (location.origin !== "https://admin.bldg.chat")
      throw new Error("Unexpected Goldline origin.");
    const methods = {
      context: "GET",
      pair: "POST",
      import: "POST",
      receipt: "GET",
      resolve: "POST",
    };
    if (!Object.hasOwn(methods, operation))
      throw new Error("Unknown operation.");
    const method = methods[operation];
    const path = `/api/trpc/system.gumball.${operation}`;
    const response = await fetch(
      path +
        (method === "GET" && input
          ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
          : ""),
      {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers:
          method === "POST" ? { "Content-Type": "application/json" } : {},
        body: method === "POST" ? JSON.stringify({ json: input }) : undefined,
        signal: AbortSignal.timeout(operation === "import" ? 120000 : 15000),
      }
    );
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "Goldline browser-sync backend is not installed yet."
          : `Goldline rejected the request (${response.status}). Check sign-in, account, and sync permissions.`
      );
    const result = await response.json();
    if (result.error || !result.result?.data)
      throw new Error("Goldline returned an unexpected response.");
    return { ok: true, value: result.result.data.json };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export const sites = { GOLDLINE, CLEANCLOUD, MAX_BYTES };
