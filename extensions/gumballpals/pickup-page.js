// Fixed DOM workflow grounded in the owner's CleanCloud Pickups and Detail UI.
// Runs in the isolated world. No private endpoints or application internals.
export async function pickupPage(mode = "capture", expected = null) {
  try {
    if (
      location.origin !== "https://cleancloudapp.com" ||
      location.pathname !== "/store"
    )
      throw new Error("Open the signed-in CleanCloud store.");
    const pause = () => new Promise(resolve => setTimeout(resolve, 100));
    const visible = element =>
      Boolean(
        element?.getClientRects().length &&
          getComputedStyle(element).visibility !== "hidden"
      );
    const wait = async predicate => {
      for (let i = 0; i < 150; i++) {
        const value = predicate();
        if (value) return value;
        await pause();
      }
      throw new Error(
        "CleanCloud's expected pickup controls did not load. Nothing further was changed."
      );
    };
    const storeLabel = document.title
      .replace(/\s*\|\s*CleanCloud\s*$/, "")
      .trim();
    if (!document.title.endsWith("CleanCloud") || !storeLabel)
      throw new Error("CleanCloud needs to sign in again.");
    if (expected && storeLabel !== expected.storeLabel)
      throw new Error("CleanCloud store changed. Pickup update stopped.");
    const open = async label => {
      const control = await wait(() => {
        const found = [...document.querySelectorAll("a")].filter(
          element => visible(element) && element.textContent.trim() === label
        );
        return found.length === 1 ? found[0] : null;
      });
      control.click();
    };
    if (mode === "verify") {
      if (!expected || !/^[1-9]\d{0,15}$/.test(expected.externalOrderId))
        throw new Error("Invalid pickup command.");
      await open("Detail");
      await wait(
        () =>
          visible(document.getElementById("awaiting_detail_box")) &&
          document.getElementById("awaiting_detail_body")
      );
      const row = document.getElementById(`det_${expected.externalOrderId}`);
      if (row && row.parentElement?.id !== "awaiting_detail_body")
        throw new Error("Detail layout changed.");
      if (row && row.children[3]?.textContent.trim() !== expected.customerName)
        throw new Error("Detail order belongs to a different customer.");
      return {
        ok: true,
        value: {
          verified: Boolean(row),
          externalOrderId: expected.externalOrderId,
          customerName: expected.customerName,
          detailRowId: row?.id ?? null,
          observedAt: new Date().toISOString(),
        },
      };
    }
    await open("Pickups");
    const root = await wait(
      () =>
        visible(document.getElementById("awaiting_dc_pickup")) &&
        document.getElementById("awaiting_dc_pickup")
    );
    const table = await wait(() =>
      root.querySelector("#awaiting_dc_pickup_table")
    );
    const headers = [...table.tHead.rows[0].cells].map(cell =>
      cell.textContent.trim()
    );
    if (
      headers.length !== 11 ||
      headers[0] !== "ID" ||
      headers[2] !== "Customer" ||
      headers[4] !== "Contact" ||
      headers[8] !== "Pickup"
    )
      throw new Error("CleanCloud pickup columns changed. Capture stopped.");
    const date = text => {
      const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (!match) throw new Error("Pickup date could not be read.");
      const year =
        match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const month = Number(match[1]),
        day = Number(match[2]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
      )
        throw new Error("Invalid pickup date.");
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };
    const clock = text => {
      const match = text.trim().match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/i);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 12)
        throw new Error("Pickup time could not be read.");
      let hour = Number(match[1]) % 12;
      if (match[3].toLowerCase() === "pm") hour += 12;
      return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
    };
    const lines = element =>
      element.innerText
        .split(/\n/)
        .map(value => value.trim())
        .filter(Boolean);
    const rows = [
      ...root.querySelectorAll("#awaiting_dc_pickup_body tr.dcPickup_row"),
    ].map(row => {
      if (row.children.length !== 11)
        throw new Error("Pickup row layout changed.");
      const cells = row.children;
      const externalOrderId = cells[0].textContent.trim();
      if (
        !/^[1-9]\d{0,15}$/.test(externalOrderId) ||
        row.id !== `DCpickup_${externalOrderId}`
      )
        throw new Error("Pickup order ID is ambiguous.");
      const contact = lines(cells[4]);
      if (contact[0] !== "Delivery" || !contact[1] || contact[1].includes("@"))
        throw new Error("Pickup address could not be read.");
      const schedule = lines(cells[8]);
      const window = schedule[1]?.split(/\s*[–-]\s*/);
      if (!window || window.length !== 2)
        throw new Error("Pickup window could not be read.");
      const buttons = [...cells[10].querySelectorAll("a")].filter(
        element => element.textContent.trim() === "Collected"
      );
      if (
        buttons.length !== 1 ||
        buttons[0].getAttribute("onclick") !==
          `markPickup('${externalOrderId}')`
      )
        throw new Error("Collected control changed. Capture stopped.");
      return {
        externalOrderId,
        customerName: cells[2].textContent.trim(),
        address: contact[1].split(/\s*\/\/\s*/).join(", "),
        scheduledDate: date(schedule[0]),
        windowStart: clock(window[0]),
        windowEnd: clock(window[1]),
        notes: cells[7].innerText.trim() || null,
      };
    });
    const count = Number(
      document.querySelector("#online_page #pu_o_c")?.textContent.trim()
    );
    if (
      !Number.isInteger(count) ||
      count !== rows.length ||
      new Set(rows.map(row => row.externalOrderId)).size !== rows.length
    )
      throw new Error(
        "The complete pickup list could not be verified. Capture stopped."
      );
    if (mode === "capture")
      return {
        ok: true,
        value: { storeLabel, observedAt: new Date().toISOString(), rows },
      };
    if (mode !== "collect" || !expected)
      throw new Error("Unknown pickup operation.");
    const pickup = rows.find(
      row => row.externalOrderId === expected.externalOrderId
    );
    if (!pickup)
      throw new Error(
        "This order is no longer listed in Pickups. No Collected action was sent."
      );
    for (const key of [
      "customerName",
      "address",
      "scheduledDate",
      "windowStart",
      "windowEnd",
    ])
      if (pickup[key] !== expected[key])
        throw new Error(
          "The pickup changed since it was recorded. Collected action stopped."
        );
    const row = document.getElementById(`DCpickup_${pickup.externalOrderId}`);
    const button = [...row.children[10].querySelectorAll("a")].find(
      element => element.textContent.trim() === "Collected"
    );
    if (!visible(button)) throw new Error("Collected button is not available.");
    const deadline = Date.parse(expected.leaseUntil ?? "");
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      throw new Error(
        "Pickup command expired before Collected. No update was sent."
      );
    button.click();
    // This is only an acknowledgment of the UI action. A fresh Detail read
    // after reload supplies the receipt; disappearing from Pickups is not proof.
    await wait(
      () => !document.getElementById(`DCpickup_${pickup.externalOrderId}`)
    );
    return { ok: true, value: { clicked: true } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Pickup browser operation failed.",
    };
  }
}
