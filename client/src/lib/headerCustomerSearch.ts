/**
 * The admin header "Customer" box. Native order rows alone miss every customer whose
 * history is only in CleanCloud, so customers come from the active business's
 * directory (admin.listCustomers) and order rows stay as receipt links.
 */

export type HeaderDirectoryCustomer = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug?: string | null;
  totalOrders?: number;
};

export type HeaderOrderHit = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  total: string | null;
  serviceType: string;
};

export const HEADER_CUSTOMER_LIMIT = 6;

const phoneDigits = (phone: string | null | undefined): string =>
  (phone ?? "").replace(/\D/g, "");

export function headerCustomerSearchSections(input: {
  directoryCustomers: readonly HeaderDirectoryCustomer[] | undefined;
  orderHits: readonly HeaderOrderHit[] | undefined;
  limit?: number;
}): { customers: HeaderDirectoryCustomer[]; orders: HeaderOrderHit[] } {
  const seen = new Set<string>();
  const customers: HeaderDirectoryCustomer[] = [];
  for (const customer of input.directoryCustomers ?? []) {
    const key = phoneDigits(customer.phone) || `${customer.firstName} ${customer.lastName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    customers.push(customer);
    if (customers.length >= (input.limit ?? HEADER_CUSTOMER_LIMIT)) break;
  }
  return { customers, orders: [...(input.orderHits ?? [])] };
}

/** The directory row for a phone picked elsewhere (header, profile), matched on digits. */
export function directoryCustomerForPhone<T extends { phone: string }>(
  customers: readonly T[] | undefined,
  phone: string
): T | null {
  const wanted = phoneDigits(phone);
  if (wanted.length < 7) return null;
  return customers?.find(customer => phoneDigits(customer.phone) === wanted) ?? null;
}
