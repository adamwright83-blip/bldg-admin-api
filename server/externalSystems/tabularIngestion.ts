import * as XLSX from "xlsx";
import { parseCsv, type CsvRecord } from "./csvIngestion";

export type TabularFileInput = {
  buffer: Buffer;
  fileName?: string | null;
  contentType?: string | null;
  csvText?: string | null;
};

const KNOWN_HEADER_TOKENS = new Set([
  "transaction date",
  "settle date",
  "settled date",
  "total sales",
  "net sales",
  "total transactions",
  "sales",
  "deposit amount",
  "transaction id",
  "amount",
]);

function isExcelFile(input: TabularFileInput): boolean {
  const name = input.fileName?.toLowerCase() ?? "";
  const type = input.contentType?.toLowerCase() ?? "";
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    type.includes("spreadsheet") ||
    type.includes("excel")
  );
}

function normalizedCell(value: unknown): string {
  return String(value ?? "").trim();
}

function headerScore(row: unknown[]): number {
  return row.reduce((score, cell) => {
    const text = normalizedCell(cell).toLowerCase().replace(/\s+/g, " ");
    return score + (KNOWN_HEADER_TOKENS.has(text) ? 1 : 0);
  }, 0);
}

export function parseTabularRows(input: TabularFileInput): CsvRecord[] {
  if (input.csvText?.trim()) return parseCsv(input.csvText);
  if (!isExcelFile(input)) return parseCsv(input.buffer.toString("utf8"));

  const workbook = XLSX.read(input.buffer, { type: "buffer", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const headerIndex = matrix.reduce(
    (best, row, index) => headerScore(row) > headerScore(matrix[best] ?? []) ? index : best,
    0
  );
  const headerRow = (matrix[headerIndex] ?? []).map(normalizedCell);
  const dataRows = matrix.slice(headerIndex + 1);
  return dataRows
    .filter((row) => row.some((value) => normalizedCell(value) !== ""))
    .map((row) =>
      Object.fromEntries(
        headerRow.map((header, index) => [header, normalizedCell(row[index])])
      )
    );
}
