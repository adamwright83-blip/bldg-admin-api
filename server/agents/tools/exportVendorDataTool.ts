import { createVendorDataExport, listVendorServices, getOrdersByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export const exportVendorDataTool: AgentTool<Record<string, any>> = {
  name: "exportVendorDataTool",
  description: "Create an immediate CSV export scoped to one vendor's clients, bookings, or services.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const exportType = input.exportType ?? "services";
    let csv = "";
    if (exportType === "bookings" || exportType === "clients") {
      const rows = await getOrdersByVendorId(vendorId);
      const filtered = exportType === "clients"
        ? rows.map((row) => ({ firstName: row.firstName, lastName: row.lastName, phone: row.phone, email: row.email }))
        : rows.map((row) => ({ id: row.id, status: row.status, pickupDate: row.pickupDate, total: row.total }));
      csv = [Object.keys(filtered[0] ?? {}).join(","), ...filtered.map((row) => Object.values(row).map(csvEscape).join(","))].filter(Boolean).join("\n");
    } else {
      const rows = await listVendorServices(ctx.tenantId, vendorId);
      csv = ["serviceName,serviceCategory,basePriceCents,recommendedPriceCents,durationMinutes", ...rows.map((row) => [row.serviceName, row.serviceCategory, row.basePriceCents, row.recommendedPriceCents, row.durationMinutes].map(csvEscape).join(","))].join("\n");
    }
    const exportUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    const id = await createVendorDataExport({
      tenantId: ctx.tenantId,
      vendorId,
      exportType,
      exportUrl,
      requestedByUserId: ctx.actorId ?? null,
    });
    return {
      entityType: "vendor_data_export",
      entityId: id,
      output: {
        exportId: id,
        vendorId,
        exportType,
        exportUrl,
        scopedToVendorId: vendorId,
        includesOtherVendorData: false,
        noExitFee: true,
        noManualRequest: true,
      },
    };
  },
};
