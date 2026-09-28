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
      reportFailure: "POST",
      recordWitness: "POST",
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
        signal: AbortSignal.timeout(
          operation === "import" || operation === "recordWitness" ? 120000 : 15000
        ),
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

// Metrics → Overview. Navigation uses the same observed menu as the sales
// export. Totals are taken from visible text beside an exact label. Date
// controls that this extension has not observed are not clicked.
export async function readMetricsOverview(range) {
  let stage = "opening reporting";
  try {
    if (location.origin !== "https://cleancloudapp.com" || location.pathname !== "/store")
      throw new Error("Open the signed-in gumball store.");
    const pause = () => new Promise(r => setTimeout(r, 100));
    const visible = e =>
      e && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
    const wait = async predicate => {
      for (let i = 0; i < 100; i++) {
        const value = predicate();
        if (value) return value;
        await pause();
      }
      throw new Error(
        `Overview capture stopped while ${stage}. The expected control did not become available.`
      );
    };
    const exact = (root, selector, text) =>
      [...root.querySelectorAll(selector)].filter(
        e => visible(e) && e.textContent.trim() === text
      );
    const storeLabel = document.title.replace(/\s*\|\s*CleanCloud\s*$/, "").trim();
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
    const overviewRoot = await wait(
      () =>
        visible(document.querySelector("#metricsContainer")) &&
        document.querySelector("#metricsContainer")
    );
    stage = "opening Overview";
    const overview = exact(overviewRoot, "a, button", "Overview");
    if (overview.length > 1) throw new Error("Ambiguous Overview control. Capture stopped.");
    if (overview.length === 1) overview[0].click();
    const metrics = await wait(
      () =>
        visible(document.querySelector("#metricsContainer")) &&
        document.querySelector("#metricsContainer")
    );
    const labels = [
      "Sales",
      "Revenue",
      "Orders",
      "New Customers",
      "Comparison Sales",
      "Comparison Revenue",
      "Comparison Orders",
    ];
    const directText = el =>
      [...el.childNodes]
        .filter(node => node.nodeType === 3)
        .map(node => node.textContent.trim())
        .filter(Boolean)
        .join(" ");
    const fields = [];
    for (const label of labels) {
      const nodes = [...metrics.querySelectorAll("*")].filter(
        el => visible(el) && directText(el) === label
      );
      if (nodes.length > 1) throw new Error(`${label} appeared more than once.`);
      if (nodes.length === 0) continue;
      const sibling = nodes[0].nextElementSibling;
      const value = sibling && visible(sibling) ? sibling.textContent.trim().replace(/\s+/g, " ") : "";
      if (!value || value.length > 40 || labels.includes(value))
        throw new Error(`${label} had no unambiguous value.`);
      fields.push({ label, valueText: value });
    }
    for (const label of ["Sales", "Revenue", "Orders"]) {
      if (!fields.some(field => field.label === label))
        throw new Error(`${label} was not on the page.`);
    }
    const months =
      "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
    const dateRe = new RegExp(
      `\\d{4}-\\d{2}-\\d{2}|\\b(?:${months})\\s+\\d{1,2},\\s*\\d{4}|\\b\\d{1,2}/\\d{1,2}/\\d{4}`,
      "gi"
    );
    const mentions = (text, iso) => {
      const [year, month, day] = iso.split("-").map(Number);
      const names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const name = names[month - 1];
      return [
        iso,
        `${month}/${day}/${year}`,
        `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`,
        `${name} ${day}, ${year}`,
        `${name.slice(0, 3)} ${day}, ${year}`,
      ].some(form => text.includes(form));
    };
    const candidates = [...metrics.querySelectorAll("*")].filter(el => {
      if (!visible(el)) return false;
      const text = el.textContent.trim().replace(/\s+/g, " ");
      if (!text || text.length > 180) return false;
      const childHasDate = [...el.children].some(child => {
        dateRe.lastIndex = 0;
        return dateRe.test(child.textContent || "");
      });
      if (childHasDate) return false;
      dateRe.lastIndex = 0;
      return [...text.matchAll(dateRe)].length === 2;
    }).map(el => el.textContent.trim().replace(/\s+/g, " "));
    const unique = [...new Set(candidates)];
    const primary = unique.filter(
      text => mentions(text, range.from) && mentions(text, range.to)
    );
    if (primary.length !== 1)
      throw new Error(
        "The overview is not on the requested dates, and the date control is not one this extension has observed. Nothing was saved."
      );
    const others = unique.filter(text => text !== primary[0]);
    if (others.length > 1) throw new Error("The comparison period is ambiguous. Nothing was saved.");
    return {
      ok: true,
      value: {
        storeLabel,
        rangeText: primary[0],
        comparisonText: others[0] ?? null,
        fields,
      },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function assertCleanCloudScreenshotTarget(tab) {
  let url;
  try {
    url = new URL(tab?.url || "");
  } catch {
    throw new Error("Screenshot refused. The tab is not the signed-in CleanCloud store.");
  }
  if (url.origin !== "https://cleancloudapp.com" || url.pathname !== "/store")
    throw new Error("Screenshot refused. The tab is not the signed-in CleanCloud store.");
  if (!tab.active)
    throw new Error("Screenshot refused. The store tab is not the visible tab.");
}

export const sites = { GOLDLINE, CLEANCLOUD, MAX_BYTES };
