import { describe, expect, it } from "vitest";
import * as React from "react";
import { isValidElement, type ReactNode } from "react";

/** The component uses the classic JSX runtime; this suite invokes it directly. */
(globalThis as any).React = React;
import { CustomerClusterDetail } from "./CustomerClusterDetail";
import { clusterGeographicCustomers, type GeographicCustomer } from "./customerGeography";

const resident = (id: string, phone: string | null): GeographicCustomer => ({
  identityKey: id,
  displayName: `Resident ${id}`,
  phone,
  cadence: { state: "active", daysSinceLastOrder: 1 },
  location: { latitude: 34.0618, longitude: -118.3011, x: 65, y: 63, outOfBounds: false, canonicalAddress: "3545 Wilshire Blvd" },
});

/** Walk the rendered element tree without a DOM; the suite runs in the node environment. */
function collect(node: ReactNode, out: any[] = []): any[] {
  if (Array.isArray(node)) { node.forEach(child => collect(child, out)); return out; }
  if (!isValidElement(node)) return out;
  out.push(node);
  collect((node.props as any)?.children, out);
  return out;
}

const clusterOf = (...members: GeographicCustomer[]) => clusterGeographicCustomers(members)[0]!;

/** Buttons that open a resident, in rendered order (excludes the close control). */
const residentButtons = (tree: any[]) =>
  tree.filter(el => el.type === "button" && el.props?.["aria-label"] !== "Close customer cluster");

describe("CustomerClusterDetail roster", () => {
  const cluster = clusterOf(resident("a", "3105550001"), resident("b", "3105550002"), resident("c", "3105550003"));

  it("renders every resident of a multi-customer physical location", () => {
    const tree = collect(CustomerClusterDetail({ cluster, onClose: () => {}, onOpenCustomer: () => {} }));
    expect(cluster.total).toBe(3);
    expect(residentButtons(tree)).toHaveLength(3);
  });

  it("opens the resident that was selected rather than the first customer", () => {
    const opened: string[] = [];
    const tree = collect(CustomerClusterDetail({ cluster, onClose: () => {}, onOpenCustomer: phone => opened.push(phone) }));
    const buttons = residentButtons(tree);
    buttons[1].props.onClick();
    buttons[2].props.onClick();
    const phones = cluster.customers.map(c => c.phone);
    expect(opened).toEqual([phones[1], phones[2]]);
    expect(opened).not.toContain(phones[0]);
  });

  it("disables a resident with no reachable phone instead of opening the wrong customer", () => {
    const mixed = clusterOf(resident("a", "3105550001"), resident("b", null));
    const tree = collect(CustomerClusterDetail({ cluster: mixed, onClose: () => {}, onOpenCustomer: () => {} }));
    expect(residentButtons(tree).some(b => b.props.disabled === true)).toBe(true);
  });

  it("keeps a single-customer location as a one-resident roster", () => {
    const solo = clusterOf(resident("a", "3105550001"));
    const tree = collect(CustomerClusterDetail({ cluster: solo, onClose: () => {}, onOpenCustomer: () => {} }));
    expect(residentButtons(tree)).toHaveLength(1);
  });
});
