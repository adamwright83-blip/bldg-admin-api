import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { isValidElement, type ReactNode } from "react";

/** The component uses the classic JSX runtime; this suite invokes it directly. */
(globalThis as any).React = React;
import { AdminCustomerSearchBlock } from "./AdminCustomerSearchBlock";
import { directoryCustomerForPhone, type HeaderDirectoryCustomer } from "@/lib/headerCustomerSearch";

/** Walk the rendered element tree without a DOM; the suite runs in the node environment. */
function collect(node: ReactNode, out: any[] = []): any[] {
  if (Array.isArray(node)) { node.forEach(child => collect(child, out)); return out; }
  if (!isValidElement(node)) return out;
  out.push(node);
  collect((node.props as any)?.children, out);
  return out;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as any)?.children);
  return "";
}

// A customer whose whole history is CleanCloud: in the directory, never in native orders.
const cleanCloudOnly: HeaderDirectoryCustomer = {
  phone: "3235550142",
  firstName: "Sam",
  lastName: "Fixture",
  email: null,
  unit: null,
  address: "100 Example St",
  totalOrders: 12,
};

function render(props: Partial<Parameters<typeof AdminCustomerSearchBlock>[0]> = {}) {
  const onPrefillNewOrder = vi.fn();
  const tree = AdminCustomerSearchBlock({
    customerSearchQuery: "sam fixture",
    setCustomerSearchQuery: () => {},
    debouncedCustomerQuery: "sam fixture",
    // Native order search finds nothing for a CleanCloud-only customer.
    searchOrders: { isLoading: false, data: [] },
    setProfilePhone: () => {},
    onPrefillNewOrder,
    ...props,
  });
  return { tree, text: textOf(tree), onPrefillNewOrder };
}

describe("AdminCustomerSearchBlock", () => {
  it("reproduces the empty search when only native orders are searched", () => {
    const { text } = render();
    expect(text).toContain("No customers or orders found.");
    expect(text).not.toContain("Sam Fixture");
  });

  it("shows a CleanCloud-only customer from the business directory", () => {
    const { text } = render({
      directoryCustomers: { isLoading: false, data: { customers: [cleanCloudOnly] } },
    });
    expect(text).toContain("Sam Fixture");
    expect(text).not.toContain("No customers or orders found.");
  });

  it("starts a new order for the picked directory customer", () => {
    const { tree, onPrefillNewOrder } = render({
      directoryCustomers: { isLoading: false, data: { customers: [cleanCloudOnly] } },
    });
    const pick = collect(tree).find(
      el => el.type === "button" && textOf(el).includes("Sam Fixture")
    );
    expect(pick).toBeTruthy();
    pick.props.onClick();
    expect(onPrefillNewOrder).toHaveBeenCalledWith("3235550142");
  });

  it("shows the business switcher beside the box and points to it when nothing matches", () => {
    const switcher = React.createElement("span", { "data-testid": "switcher" }, "Laundry Farm");
    const { tree, text } = render({ businessSwitcher: switcher });
    expect(collect(tree)).toContain(switcher);
    expect(text).toContain("searches the selected business only");
  });

  it("keeps the spinner only while both searches are empty and loading", () => {
    const loading = render({
      searchOrders: { isLoading: true },
      directoryCustomers: { isLoading: true },
    });
    expect(loading.text).not.toContain("No customers or orders found.");
    const partial = render({
      searchOrders: { isLoading: true },
      directoryCustomers: { isLoading: false, data: { customers: [cleanCloudOnly] } },
    });
    expect(partial.text).toContain("Sam Fixture");
  });
});

describe("directoryCustomerForPhone", () => {
  it("matches a seeded phone to its directory row on digits", () => {
    const formatted = { ...cleanCloudOnly, phone: "(323) 555-0142" };
    expect(directoryCustomerForPhone([formatted], "3235550142")).toBe(formatted);
    expect(directoryCustomerForPhone([formatted], "3235550143")).toBeNull();
    expect(directoryCustomerForPhone([formatted], "555")).toBeNull();
  });
});
