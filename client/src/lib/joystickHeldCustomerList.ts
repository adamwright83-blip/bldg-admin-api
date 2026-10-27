/**
 * A customer list shared before checkout stays in this browser, never on the
 * server, until the paid workspace exists. Then GoldlineOnboarding imports it
 * through the normal tenant import and clears it. Signup and /onboarding run on
 * the same origin (see client/public/joystick-home/app.js FUNNEL_ORIGIN), so the
 * list is still here after the Stripe round trip.
 */
export type HeldCustomerListSummary = {
  rows: number;
  usable: number;
  duplicates: number;
  needsReview: number;
  localities: Array<{ label: string; count: number }>;
  sampleNames: string[];
};

export type HeldCustomerList = {
  fileName: string;
  payload: string;
  summary: HeldCustomerListSummary;
  heldAt: string;
};

export type CustomerListDecision = "held" | "skipped";

const LIST_KEY = "joystick_held_customer_list";
const DECISION_KEY = "joystick_customer_list_decision";
export const HELD_LIST_MAX_BYTES = 500_000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readHeldCustomerList(): HeldCustomerList | null {
  try {
    const raw = storage()?.getItem(LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HeldCustomerList;
    return parsed?.payload && parsed?.fileName && parsed?.summary ? parsed : null;
  } catch {
    return null;
  }
}

export function readCustomerListDecision(): CustomerListDecision | null {
  const value = storage()?.getItem(DECISION_KEY);
  return value === "held" || value === "skipped" ? value : null;
}

/** Returns false when the browser refused to store the list (private mode, quota). */
export function holdCustomerList(list: HeldCustomerList): boolean {
  try {
    storage()?.setItem(LIST_KEY, JSON.stringify(list));
    storage()?.setItem(DECISION_KEY, "held");
    return Boolean(storage());
  } catch {
    return false;
  }
}

export function skipCustomerList(): void {
  try {
    storage()?.removeItem(LIST_KEY);
    storage()?.setItem(DECISION_KEY, "skipped");
  } catch {
    /* the choice simply is not remembered */
  }
}

export function clearHeldCustomerList(): void {
  try {
    storage()?.removeItem(LIST_KEY);
    storage()?.removeItem(DECISION_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** One plain line naming where the list says the business works, or null. */
export function heldListPlaceLine(summary: HeldCustomerListSummary): string | null {
  if (!summary.localities.length) return null;
  return summary.localities.map(l => l.label).join(" · ");
}
