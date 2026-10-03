export const GOLDLINE: string;
export const CLEANCLOUD: string;
export const MAX_BYTES: number;
export const HOSTS: string[];
export function pacificToday(now?: Date): string;
export function dateNumber(value: string): number;
export function validateRange(
  from: string,
  to: string,
  today?: string
): { from: string; to: string };
export function initialRange(now?: Date): { from: string; to: string };
export function validateExportUrl(
  raw: string,
  range: { from: string; to: string }
): {
  url: string;
  storeId: string;
  type: string;
  from: string;
  to: string;
  reportType: "orders_sales";
};
export function validateRevenueExportUrl(
  raw: string,
  range: { from: string; to: string }
): {
  url: string;
  storeId: string;
  type: string;
  from: string;
  to: string;
  reportType: "orders_revenue";
};
export function parseCsv(
  text: string,
  reportType?: "orders_sales" | "orders_revenue"
): Record<string, string>[];
export function assertPairing(
  binding: Record<string, string>,
  observed: Record<string, string>
): void;
export function recoveryState(saved: any): any;
