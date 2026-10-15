/** Desk copy for a win-back book that did not yield a call sheet. */
export function callSheetWithheldCopy(winBack: {
  area: string;
  emptyMeansNoLapsedCustomers: boolean;
  lapsedCount: number | null;
  withheldReason: string | null;
  contacts: readonly unknown[];
}): { heading: string; body: string } | null {
  if (winBack.contacts.length > 0) return null;
  if (winBack.emptyMeansNoLapsedCustomers && winBack.lapsedCount === 0) {
    return {
      heading: `No lapsed ${winBack.area} customers`,
      body: "The current book has no lapsed customers in this area.",
    };
  }
  return {
    heading: "Call sheet withheld",
    body:
      winBack.withheldReason ??
      "Lapsed customers could not be read. That is not an empty customer list.",
  };
}
