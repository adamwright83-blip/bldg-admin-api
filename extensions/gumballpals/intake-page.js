// Fixed, owner-inspected CleanCloud DOM controls. No private application calls.
export async function intakePage(mode, expected) {
  try {
    if (
      location.origin !== "https://cleancloudapp.com" ||
      location.pathname !== "/store"
    )
      throw new Error("Open the signed-in CleanCloud store.");
    const storeLabel = document.title
      .replace(/\s*\|\s*CleanCloud\s*$/, "")
      .trim();
    if (
      !document.title.endsWith("CleanCloud") ||
      storeLabel !== expected.storeLabel
    )
      throw new Error("CleanCloud store changed. Intake stopped.");
    const visible = e =>
      Boolean(
        e?.getClientRects().length &&
          getComputedStyle(e).visibility !== "hidden"
      );
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async fn => {
      for (let i = 0; i < 150; i++) {
        const value = fn();
        if (value) return value;
        await pause(100);
      }
      throw new Error(
        "Expected CleanCloud intake controls did not load. Inspect the order."
      );
    };
    const get = id => document.getElementById(id);
    const click = async id => {
      const e = await wait(() => visible(get(id)) && get(id));
      e.click();
    };
    const value = id => get(id)?.value ?? "";
    const customer = () => value("nameOmnibox").trim();
    const identify = () => {
      if (
        get("edit_id_show")?.textContent.trim() !== expected.externalOrderId ||
        customer() !== expected.sourceJson.customerName
      )
        throw new Error("Exact order ID or customer changed. Intake stopped.");
    };
    const catalog = () =>
      [
        ...document.querySelectorAll(
          "#scrollableProductButtons input.score_input"
        ),
      ].flatMap(input => {
        const id = input.id.match(/^([1-9]\d{0,15})_input$/)?.[1];
        if (!id) return [];
        const anchor = get(id + "_add"),
          label = anchor?.querySelector("p")?.textContent.trim();
        const handler = anchor?.getAttribute("onclick") ?? "";
        if (!label || !handler.startsWith("aIo(")) return [];
        const section = input.closest('[id^="s"]')?.id;
        if (!["s3", "s19"].includes(section)) return [];
        return [
          {
            id,
            label,
            unit: /^aIo\(\s*['"]\d+['"]\s*,\s*['"]\d+['"]\s*,\s*['"]1['"]\s*\)$/.test(
              handler
            )
              ? "lb"
              : "piece",
            section: section === "s3" ? "Wash, Fold & Dry" : "Dry Cleaning",
          },
        ];
      });
    const read = async () => {
      identify();
      await wait(() => !visible(get("orderSumSpinner")));
      const products = catalog();
      if (!products.length) throw new Error("CleanCloud catalog unavailable.");
      const quantities = products.map(p => ({
        productId: p.id,
        quantity: Number(value(p.id + "_input") || 0),
      }));
      if (quantities.some(p => !Number.isFinite(p.quantity)))
        throw new Error("Quantity could not be read.");
      const price = get("sbTextN")?.textContent.trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(price ?? ""))
        throw new Error("CleanCloud total could not be read.");
      const positiveQuantities = quantities.filter(p => p.quantity > 0);
      const snapshot = {
        externalOrderId: expected.externalOrderId,
        customerName: customer(),
        readyBy: get("sbText3")?.textContent.trim() ?? "",
        priceListId: value("price_list_select"),
        totalCents: Math.round(Number(price) * 100),
        bags: Number(value("liveBagsCount") || 0),
        notes: value("new_notes"),
        tableText:
          get("order_table")?.textContent.replace(/\s+/g, " ").trim() ?? "",
        quantities: positiveQuantities,
      };
      const canonical = JSON.stringify([
        snapshot.externalOrderId,
        snapshot.customerName,
        snapshot.readyBy,
        snapshot.priceListId,
        snapshot.totalCents,
        snapshot.bags,
        snapshot.notes,
        snapshot.tableText,
        [...positiveQuantities]
          .sort((a, b) => a.productId.localeCompare(b.productId))
          .map(p => [p.productId, p.quantity]),
      ]);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical)
      );
      return {
        ...snapshot,
        fingerprint: [...new Uint8Array(digest)]
          .map(x => x.toString(16).padStart(2, "0"))
          .join(""),
        observedAt: new Date().toISOString(),
      };
    };
    const openOrder = async cleaning => {
      await click(cleaning ? "slide2" : "slideDetail");
      const table = await wait(
        () =>
          visible(get(cleaning ? "awaiting_checkin" : "awaiting_detail")) &&
          get(cleaning ? "awaiting_checkin" : "awaiting_detail")
      );
      const headers = [...table.tHead.rows[0].cells].map(c =>
        c.textContent.trim()
      );
      if (
        headers[0] !== "ID" ||
        headers[3] !== "Customer" ||
        headers.length !== (cleaning ? 12 : 10)
      )
        throw new Error("CleanCloud order columns changed.");
      const matches = [...table.tBodies]
        .flatMap(t => [...t.rows])
        .filter(
          row => row.cells[0]?.textContent.trim() === expected.externalOrderId
        );
      if (matches.length !== 1)
        throw new Error(
          cleaning
            ? "Order not verified in Cleaning. Do not resubmit."
            : "Order missing from Detail. Refresh and inspect CleanCloud."
        );
      const row = matches[0];
      if (row.cells[3]?.textContent.trim() !== expected.sourceJson.customerName)
        throw new Error("Order belongs to another customer.");
      const edits = [...row.querySelectorAll("a[onclick]")].filter(
        a =>
          visible(a) &&
          new RegExp(
            "^editOrder\\(\\s*" +
              expected.externalOrderId +
              "\\s*,\\s*\\d+\\s*\\)$"
          ).test(a.getAttribute("onclick"))
      );
      if (edits.length !== 1)
        throw new Error("Exact order edit control unavailable.");
      edits[0].click();
      await wait(
        () =>
          get("edit_id_show")?.textContent.trim() ===
            expected.externalOrderId && customer()
      );
      identify();
    };
    if (mode === "capture") {
      await click("slideDetail");
      const table = await wait(
        () => visible(get("awaiting_detail")) && get("awaiting_detail")
      );
      const headers = [...table.tHead.rows[0].cells].map(c =>
        c.textContent.trim()
      );
      if (
        headers.length !== 10 ||
        headers[0] !== "ID" ||
        headers[3] !== "Customer"
      )
        throw new Error("CleanCloud Detail columns changed.");
      const rows = [...get("awaiting_detail_body").rows]
        .filter(row => !(row.cells.length === 1 && row.cells[0].colSpan === 10))
        .map(row => ({
          externalOrderId: row.cells[0].textContent.trim(),
          customerName: row.cells[3].textContent.trim(),
          readyBy: row.cells[1].textContent.replace(/\s+/g, " ").trim(),
        }));
      if (
        rows.some(
          row =>
            !/^([1-9]\d{0,15})$/.test(row.externalOrderId) || !row.customerName
        )
      )
        throw new Error("Detail order identity unreadable.");
      if (Number(get("d_o_c")?.textContent.trim()) !== rows.length)
        throw new Error(
          "CleanCloud Detail grid is incomplete. Capture stopped."
        );
      const products = catalog();
      if (!products.length)
        throw new Error("CleanCloud product catalog unavailable.");
      return {
        ok: true,
        value: {
          storeLabel,
          rows,
          catalog: products,
          observedAt: new Date().toISOString(),
        },
      };
    }
    if (mode === "read") return { ok: true, value: await read() };
    if (mode === "verify") {
      await openOrder(true);
      return { ok: true, value: { prepared: await read(), verified: true } };
    }
    if (mode === "prepare") {
      await openOrder(false);
      const products = catalog();
      const requested = new Set(
        expected.planJson.lines.map(line => line.productId)
      );
      // This is the complete actual intake, not additions to pickup estimates.
      for (const product of products) {
        const input = get(product.id + "_input");
        if (requested.has(product.id) || !(Number(input.value) > 0)) continue;
        if (product.unit === "lb")
          throw new Error(
            "Existing weighted bags need inspection in CleanCloud before replacing this intake."
          );
        input.value = "0";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(
          new KeyboardEvent("keyup", { key: "0", bubbles: true })
        );
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const line of expected.planJson.lines) {
        const product = products.find(p => p.id === line.productId);
        if (!product)
          throw new Error("Requested CleanCloud item no longer exists.");
        if (product.unit === "piece" && !Number.isInteger(line.quantity))
          throw new Error("Garment quantity must be a whole number.");
        if (!(line.quantity > 0) || line.quantity > 10000)
          throw new Error("Invalid intake quantity.");
        const section =
          product.section === "Dry Cleaning" ? "secShort19" : "secShort3";
        await click(section);
        const input = get(product.id + "_input"),
          anchor = get(product.id + "_add");
        // Expand the observed parent category through its normal UI when necessary.
        if (!visible(anchor)) {
          const parent = input
            .closest(".addbox")
            ?.className.match(/pCh([1-9]\d*)/)?.[1];
          if (parent) await click(parent + "_add");
        }
        if (product.unit === "lb") {
          // Replacing an already weighted product can alter bag notes and surcharges.
          if (Number(input.value) > 0)
            throw new Error(
              "This laundry product already has weight. Inspect and edit its existing bags in CleanCloud."
            );
          await click(product.id + "_add");
          await wait(
            () => visible(get("weight_scale_box")) && get("new_weight_amount")
          );
          const weight = get("new_weight_amount");
          weight.value = String(line.quantity);
          weight.dispatchEvent(new Event("input", { bubbles: true }));
          weight.dispatchEvent(new Event("change", { bubbles: true }));
          await click("confirm_weight_button");
          await wait(() => !visible(get("weight_scale_box")));
        } else {
          if (!visible(input)) await click(product.id + "_add");
          input.value = String(line.quantity);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(
            new KeyboardEvent("keyup", { key: "0", bubbles: true })
          );
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await wait(
          () => Number(value(product.id + "_input")) === line.quantity
        );
        identify();
      }
      await pause(750);
      const prepared = await read();
      if (
        expected.planJson.lines.some(
          line =>
            prepared.quantities.find(x => x.productId === line.productId)
              ?.quantity !== line.quantity
        )
      )
        throw new Error("Prepared quantities differ from your request.");
      return { ok: true, value: prepared };
    }
    if (mode === "submit") {
      if (
        Date.now() > Date.parse(expected.leaseUntil) ||
        Date.now() - Date.parse(expected.approvedAt) > 600000
      )
        throw new Error("Submission approval expired.");
      const prepared = await read();
      if (prepared.fingerprint !== expected.preparedJson.fingerprint)
        throw new Error(
          "Reviewed CleanCloud draft changed. Submission stopped."
        );
      const submit = await wait(
        () => visible(get("submit_order_button")) && get("submit_order_button")
      );
      if (
        submit.getAttribute("onclick") !== "newOrderCreate()" ||
        submit.disabled
      )
        throw new Error("CleanCloud Submit control changed.");
      // Called only for the explicit, current Goldline approval. Never retry this click.
      submit.click();
      return { ok: true, value: { attempted: true } };
    }
    throw new Error("Unknown intake operation.");
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
