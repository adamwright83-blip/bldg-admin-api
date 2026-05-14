import * as XLSX from "xlsx";
import { parseCsv, type CsvRecord } from "./csvIngestion";

export type TabularFileInput = {
  buffer: Buffer;
  fileName?: string | null;
  contentType?: string | null;
  csvText?: string | null;
};

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

export function parseTabularRows(input: TabularFileInput): CsvRecord[] {
  if (input.csvText?.trim()) return parseCsv(input.csvText);
  if (!isExcelFile(input)) return parseCsv(input.buffer.toString("utf8"));

  const workbook = XLSX.read(input.buffer, { type: "buffer", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: "",
  });
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])
    )
  );
}
