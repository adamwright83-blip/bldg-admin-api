import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { catalogItems, drycleanReceiptIntakes, orders, type CatalogItem } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { storagePut } from "./storage";

export const PARTNER_DISCOUNT_PERCENT = 40;
export const PARTNER_COST_PERCENT = 60;

export type ParsedReceiptLine = {
  rawLabel: string;
  qty: number;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
};

export type ParsedDryCleanReceipt = {
  receiptIntakeId?: number;
  receiptImageKey?: string;
  receiptImageUrl?: string | null;
  vendorName: string | null;
  receiptDate: string | null;
  receiptNumber: string | null;
  lines: ParsedReceiptLine[];
  dryCleanerRetailTotalCents: number;
  confidence: number;
  warnings: string[];
};

export type ReceiptCatalogMatch = {
  rawLabel: string;
  matchedCatalogSlug: string | null;
  matchedCatalogName: string | null;
  category: string | null;
  qty: number;
  dryCleanerRetailLineTotalCents: number | null;
  laundryButlerUnitPriceCents: number | null;
  laundryButlerLineTotalCents: number;
  confidence: number;
  warning: string | null;
};

export type ReceiptMatchSummary = {
  matches: ReceiptCatalogMatch[];
  dryCleanerRetailTotalCents: number;
  partnerCostCents: number;
  laundryButlerRetailSubtotalCents: number;
  customerTotalCentsAtDraft: number;
  estimatedGrossMarginCents: number;
  warnings: string[];
};

export type AssignmentCustomer = {
  orderId: number | null;
  orderStatus: string | null;
  serviceType: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
};

export function buildDrycleanItemsJsonFromReviewed(
  matches: ReceiptCatalogMatch[]
): Record<string, { label: string; category: string; unit_price_cents: number; qty: number; total_cents: number }> {
  return Object.fromEntries(
    matches
      .filter((m) => m.matchedCatalogSlug && m.qty > 0 && m.laundryButlerUnitPriceCents != null)
      .map((m) => [
        m.matchedCatalogSlug!,
        {
          label: m.matchedCatalogName ?? m.rawLabel,
          category: m.category ?? "Dry Cleaning",
          unit_price_cents: m.laundryButlerUnitPriceCents!,
          qty: m.qty,
          total_cents: m.laundryButlerUnitPriceCents! * m.qty,
        },
      ])
  );
}

const RECEIPT_PARSE_SCHEMA = {
  name: "dry_clean_receipt_parse",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      vendorName: { anyOf: [{ type: "string" }, { type: "null" }] },
      receiptDate: { anyOf: [{ type: "string" }, { type: "null" }] },
      receiptNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            rawLabel: { type: "string" },
            qty: { type: "number" },
            unitPriceCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
            lineTotalCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
          required: ["rawLabel", "qty", "unitPriceCents", "lineTotalCents"],
        },
      },
      dryCleanerRetailTotalCents: { type: "integer" },
      confidence: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "vendorName",
      "receiptDate",
      "receiptNumber",
      "lines",
      "dryCleanerRetailTotalCents",
      "confidence",
      "warnings",
    ],
  },
} as const;

function clampConfidence(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, x));
}

function cents(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

export function calculatePartnerCostCents(dryCleanerRetailTotalCents: number): number {
  return Math.round(Math.max(0, dryCleanerRetailTotalCents) * (PARTNER_COST_PERCENT / 100));
}

export function buildDraftMath(input: {
  dryCleanerRetailTotalCents: number;
  laundryButlerRetailSubtotalCents: number;
}) {
  const dryCleanerRetailTotalCents = Math.max(0, Math.round(input.dryCleanerRetailTotalCents));
  const laundryButlerRetailSubtotalCents = Math.max(0, Math.round(input.laundryButlerRetailSubtotalCents));
  const partnerCostCents = calculatePartnerCostCents(dryCleanerRetailTotalCents);
  const customerTotalCentsAtDraft = laundryButlerRetailSubtotalCents;
  return {
    dryCleanerRetailTotalCents,
    partnerCostCents,
    laundryButlerRetailSubtotalCents,
    customerDiscountPercentAtDraft: 0,
    customerTotalCentsAtDraft,
    estimatedGrossMarginCents: customerTotalCentsAtDraft - partnerCostCents,
  };
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalizeText(s).split(/\s+/).filter((t) => t.length > 1);
}

function scoreMatch(label: string, item: Pick<CatalogItem, "name" | "category" | "slug">): number {
  const labelNorm = normalizeText(label);
  const itemNorm = normalizeText(`${item.name} ${item.category} ${item.slug}`);
  if (!labelNorm || !itemNorm) return 0;
  if (itemNorm.includes(labelNorm) || labelNorm.includes(normalizeText(item.name))) return 0.96;
  const a = new Set(tokens(labelNorm));
  const b = new Set(tokens(itemNorm));
  let overlap = 0;
  Array.from(a).forEach((t) => {
    if (b.has(t)) overlap += 1;
  });
  return a.size ? overlap / a.size : 0;
}

export function matchReceiptLinesToCatalog(
  lines: ParsedReceiptLine[],
  catalogRows: CatalogItem[],
  explicitTotalCents?: number
): ReceiptMatchSummary {
  const activeDryCleanRows = catalogRows.filter((r) => {
    const st = r.serviceType ?? "dry_clean";
    return !r.archived && r.isActive && (st === "dry_clean" || st === "alteration");
  });
  const matches = lines.map((line) => {
    const ranked = activeDryCleanRows
      .map((row) => ({ row, score: scoreMatch(line.rawLabel, row) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const confidence = best ? clampConfidence(best.score) : 0;
    const matched = best && best.score >= 0.45 ? best.row : null;
    const qty = Math.max(1, Math.round(line.qty || 1));
    const laundryButlerUnitPriceCents = matched ? matched.standardPriceCents : null;
    const laundryButlerLineTotalCents = laundryButlerUnitPriceCents == null ? 0 : laundryButlerUnitPriceCents * qty;
    const warning =
      !matched
        ? `No confident Laundry Butler catalog match for "${line.rawLabel}".`
        : confidence < 0.75
          ? `Low-confidence match for "${line.rawLabel}". Review before creating draft.`
          : null;
    return {
      rawLabel: line.rawLabel,
      matchedCatalogSlug: matched?.slug ?? null,
      matchedCatalogName: matched?.name ?? null,
      category: matched?.category ?? null,
      qty,
      dryCleanerRetailLineTotalCents: line.lineTotalCents,
      laundryButlerUnitPriceCents,
      laundryButlerLineTotalCents,
      confidence,
      warning,
    };
  });
  const summedDryCleanerRetailTotalCents = matches.reduce((sum, m) => sum + (m.dryCleanerRetailLineTotalCents ?? 0), 0);
  const dryCleanerRetailTotalCents =
    explicitTotalCents && explicitTotalCents > 0 ? explicitTotalCents : summedDryCleanerRetailTotalCents;
  const laundryButlerRetailSubtotalCents = matches.reduce((sum, m) => sum + m.laundryButlerLineTotalCents, 0);
  const math = buildDraftMath({ dryCleanerRetailTotalCents, laundryButlerRetailSubtotalCents });
  return {
    matches,
    ...math,
    warnings: matches.map((m) => m.warning).filter((w): w is string => !!w),
  };
}

export async function parseDryCleanReceiptPhoto(input: {
  tenantId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}): Promise<ParsedDryCleanReceipt> {
  const buffer = Buffer.from(input.base64, "base64");
  const ext = input.mimeType.split("/")[1] || "jpg";
  const stored = await storagePut(
    `dryclean-receipts/${input.tenantId}/${Date.now()}-${nanoid(8)}.${ext}`,
    buffer,
    input.mimeType
  );

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const inserted = await db.insert(drycleanReceiptIntakes).values({
    tenantId: input.tenantId,
    receiptImageKey: stored.key,
    receiptImageUrl: stored.url,
    status: "uploaded",
  });
  const receiptIntakeId = Number(inserted[0].insertId);

  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      temperature: 0,
      maxTokens: 2048,
      outputSchema: RECEIPT_PARSE_SCHEMA,
      messages: [
        {
          role: "system",
          content:
            "Return JSON only. Parse a dry-cleaning retail receipt photo. The receipt may be yellow paper, messy handwriting, partial image, or low light. Extract only visible items and prices. Do not invent customer name. Do not invent missing prices. If a line is ambiguous, include it with low confidence and a warning. If total is visible, capture it. If item line totals do not match visible total, return both and a warning.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract vendorName, receiptDate, receiptNumber, line items, visible dry-cleaner retail total in cents, confidence 0-1, and warnings.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${input.mimeType};base64,${input.base64}`, detail: "high" },
            },
          ],
        },
      ],
    });
    const raw = result.choices[0]?.message.content;
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed: ParsedDryCleanReceipt = {
      receiptIntakeId,
      receiptImageKey: stored.key,
      receiptImageUrl: stored.url,
      vendorName: typeof json.vendorName === "string" ? json.vendorName : null,
      receiptDate: typeof json.receiptDate === "string" ? json.receiptDate : null,
      receiptNumber: typeof json.receiptNumber === "string" ? json.receiptNumber : null,
      lines: Array.isArray(json.lines)
        ? json.lines.map((line: any) => ({
            rawLabel: String(line.rawLabel || "").trim() || "Unlabeled receipt line",
            qty: Math.max(1, Number(line.qty) || 1),
            unitPriceCents: cents(line.unitPriceCents),
            lineTotalCents: cents(line.lineTotalCents),
          }))
        : [],
      dryCleanerRetailTotalCents: cents(json.dryCleanerRetailTotalCents) ?? 0,
      confidence: clampConfidence(json.confidence),
      warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
    };
    await db
      .update(drycleanReceiptIntakes)
      .set({
        parseJson: parsed,
        dryCleanerRetailTotalCents: parsed.dryCleanerRetailTotalCents,
        partnerCostCents: calculatePartnerCostCents(parsed.dryCleanerRetailTotalCents),
        status: "parsed",
      })
      .where(eq(drycleanReceiptIntakes.id, receiptIntakeId));
    return parsed;
  } catch (error) {
    await db.update(drycleanReceiptIntakes).set({ status: "failed" }).where(eq(drycleanReceiptIntakes.id, receiptIntakeId));
    throw error;
  }
}

export async function searchCustomersForAssignment(q: string): Promise<AssignmentCustomer[]> {
  const db = await getDb();
  if (!db) return [];
  const trimmed = q.trim().slice(0, 80);
  if (trimmed.length < 2) return [];
  const safe = trimmed.replace(/[%_\\]/g, "");
  const pattern = `%${safe}%`;
  const phoneDigits = trimmed.replace(/\D/g, "");
  const conditions = [
    like(orders.firstName, pattern),
    like(orders.lastName, pattern),
    like(orders.email, pattern),
    like(orders.unit, pattern),
    like(orders.buildingSlug, pattern),
    sql`CONCAT(${orders.firstName}, ' ', ${orders.lastName}) LIKE ${pattern}`,
  ];
  if (phoneDigits.length >= 2) conditions.push(like(orders.phone, `%${phoneDigits}%`));
  const rows = await db
    .select({
      orderId: orders.id,
      orderStatus: orders.status,
      serviceType: orders.serviceType,
      firstName: orders.firstName,
      lastName: orders.lastName,
      phone: orders.phone,
      email: orders.email,
      unit: orders.unit,
      address: orders.address,
      buildingSlug: orders.buildingSlug,
      stripeCustomerId: orders.stripeCustomerId,
      stripePaymentMethodId: orders.stripePaymentMethodId,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(or(...conditions))
    .orderBy(desc(orders.updatedAt))
    .limit(50);

  const seen = new Set<string>();
  const out: AssignmentCustomer[] = [];
  for (const row of rows) {
    const key = row.phone.replace(/\D/g, "") || `${row.firstName}:${row.lastName}:${row.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      orderId: row.orderId,
      orderStatus: row.orderStatus,
      serviceType: row.serviceType,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      unit: row.unit,
      address: row.address,
      buildingSlug: row.buildingSlug,
      stripeCustomerId: row.stripeCustomerId,
      stripePaymentMethodId: row.stripePaymentMethodId,
    });
    if (out.length >= 10) break;
  }
  return out;
}

export async function updateReceiptIntakeAfterMatch(input: {
  receiptIntakeId: number;
  match: ReceiptMatchSummary;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(drycleanReceiptIntakes)
    .set({
      matchJson: input.match,
      dryCleanerRetailTotalCents: input.match.dryCleanerRetailTotalCents,
      partnerCostCents: input.match.partnerCostCents,
      laundryButlerRetailSubtotalCents: input.match.laundryButlerRetailSubtotalCents,
      customerDiscountPercentAtDraft: 0,
      customerTotalCentsAtDraft: input.match.customerTotalCentsAtDraft,
      estimatedGrossMarginCents: input.match.estimatedGrossMarginCents,
      status: "reviewed",
    })
    .where(eq(drycleanReceiptIntakes.id, input.receiptIntakeId));
}

export async function updateReceiptIntakeAfterOrder(input: {
  receiptIntakeId: number;
  orderId: number;
  customer: AssignmentCustomer;
  matchJson: unknown;
  parseJson?: unknown;
  dryCleanerRetailTotalCents: number;
  partnerCostCents: number;
  laundryButlerRetailSubtotalCents: number;
  customerTotalCentsAtDraft: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(drycleanReceiptIntakes)
    .set({
      orderId: input.orderId,
      assignedCustomerPhone: input.customer.phone,
      assignedCustomerName: `${input.customer.firstName} ${input.customer.lastName}`.trim(),
      assignedCustomerUnit: input.customer.unit ?? null,
      assignedBuildingSlug: input.customer.buildingSlug ?? null,
      dryCleanerRetailTotalCents: input.dryCleanerRetailTotalCents,
      partnerCostCents: input.partnerCostCents,
      laundryButlerRetailSubtotalCents: input.laundryButlerRetailSubtotalCents,
      customerDiscountPercentAtDraft: 0,
      customerTotalCentsAtDraft: input.customerTotalCentsAtDraft,
      estimatedGrossMarginCents: input.customerTotalCentsAtDraft - input.partnerCostCents,
      parseJson: input.parseJson,
      matchJson: input.matchJson,
      status: "order_created",
    })
    .where(and(eq(drycleanReceiptIntakes.id, input.receiptIntakeId)));
}
