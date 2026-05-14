export type CsvRecord = Record<string, string>;

export type ExternalImportSummary = {
  source: string;
  sourceFileName: string;
  importBatchId: number | null;
  parsedRowCount: number;
  importedRowCount: number;
  skippedRowCount: number;
  duplicateRowCount: number;
  unresolvedBuildingCount: number;
  importStatus: "completed" | "completed_with_errors" | "failed";
  errors: Array<{ rowNumber?: number; message: string }>;
};

export type BrowserAutomationPlaybookStep = {
  name: string;
  actor: "browser" | "operator" | "system";
  instruction: string;
};

export type BrowserAutomationPlaybook = {
  system: string;
  playbook: string;
  cadence: string;
  downloadArtifact: "csv" | "xlsx" | "pdf" | "json";
  handoffEndpoint: string;
  steps: BrowserAutomationPlaybookStep[];
};

export function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!headerRow) return [];

  const headers = headerRow.map((h) => h.trim());
  return dataRows
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) =>
      Object.fromEntries(
        headers.map((header, index) => [header, String(r[index] ?? "").trim()])
      )
    );
}
