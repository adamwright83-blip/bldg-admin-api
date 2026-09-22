import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmCargo = vi.fn();
const proposeCargo = vi.fn();
const deliverCustodyToCustomer = vi.fn();
const acceptProposal = vi.fn();
const completeDayDirectorCommitment = vi.fn();
const updateDayDirectorCommitment = vi.fn();

vi.mock("../goldlineCargo/cargoService", () => ({
  confirmCargo: (...args: unknown[]) => confirmCargo(...args),
  proposeCargo: (...args: unknown[]) => proposeCargo(...args),
  deliverCustodyToCustomer: (...args: unknown[]) => deliverCustodyToCustomer(...args),
}));

vi.mock("../dayDirector/dayDirectorService", () => ({
  acceptProposal: (...args: unknown[]) => acceptProposal(...args),
  completeDayDirectorCommitment: (...args: unknown[]) => completeDayDirectorCommitment(...args),
  updateDayDirectorCommitment: (...args: unknown[]) => updateDayDirectorCommitment(...args),
}));

import { completeLinkedVehicleDelivery, confirmLinkedVehicleWork } from "./workdayCargoOrchestrator";
import { UNKNOWN_CARGO_IDENTITY } from "../../shared/claireWorkdayCommand";

describe("Day Line ↔ cargo linkage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not duplicate a known matched order", async () => {
    proposeCargo.mockResolvedValue({
      matchState: "matched",
      matchedOrderId: 41,
      customerDisplayName: "Sophia",
      itemDescription: "dry cleaning",
      quantity: 1,
      serviceType: "dry_cleaning",
      vehicleAction: "add",
      vehicleState: "IN_VEHICLE",
      processingState: "unknown",
      location: null,
      notes: null,
    });
    confirmCargo.mockResolvedValue({ kind: "order", id: 41 });
    acceptProposal.mockResolvedValue({ id: "line-sophia" });
    updateDayDirectorCommitment.mockResolvedValue({ ok: true, id: "line-sophia" });
    const result = await confirmLinkedVehicleWork({
      tenantId: "t",
      actorId: "a",
      vehicleId: "v",
      businessDate: "2026-09-21",
      requestId: "req-sophia",
      transcript: "Sophia's dry cleaning is in the car",
      confirmed: true,
    });
    expect(result.cargo).toEqual({ ok: true, id: "41", kind: "order", duplicated: false });
    expect(confirmCargo).toHaveBeenCalledWith(expect.objectContaining({ selectedOrderId: 41 }));
    expect(result.dayLine).toEqual({ ok: true, id: "line-sophia" });
  });

  it("creates unlinked unknown-identity field cargo after confirmation", async () => {
    proposeCargo.mockResolvedValue({ matchState: "unlinked", matchedOrderId: null });
    confirmCargo.mockResolvedValue({ kind: "field", id: "field-1" });
    acceptProposal.mockResolvedValue({ id: "line-unknown" });
    updateDayDirectorCommitment.mockResolvedValue({ ok: true, id: "line-unknown" });
    const result = await confirmLinkedVehicleWork({
      tenantId: "t",
      actorId: "a",
      vehicleId: "v",
      businessDate: "2026-09-21",
      requestId: "req-unknown",
      transcript: "Century Park East dry-cleaning, I can't remember the tenant's name",
      place: "Century Park East",
      confirmed: true,
    });
    expect(result.cargo).toMatchObject({ ok: true, kind: "field", id: "field-1" });
    expect(confirmCargo.mock.calls[0][0].fields.customerDisplayName).toBe(UNKNOWN_CARGO_IDENTITY);
    expect(acceptProposal.mock.calls[0][0].proposal.command.identityUnknown).toBe(true);
    expect(acceptProposal.mock.calls[0][0].proposal.detailState).toBe("NEEDS_DETAILS");
  });

  it("only claims cargo delivery and Day Line completion when both mutations succeed", async () => {
    deliverCustodyToCustomer.mockResolvedValue({ delivered: true });
    completeDayDirectorCommitment.mockResolvedValue({ ok: true });
    const ok = await completeLinkedVehicleDelivery({
      tenantId: "t",
      actorId: "a",
      vehicleId: "v",
      commitmentId: "line-1",
      fieldCargoId: "field-1",
      confirmed: true,
    });
    expect(ok.cargoDelivered).toBe(true);
    expect(ok.dayLineCompleted).toBe(true);
    deliverCustodyToCustomer.mockRejectedValue(new Error("cargo failed"));
    completeDayDirectorCommitment.mockResolvedValue({ ok: true });
    const partial = await completeLinkedVehicleDelivery({
      tenantId: "t",
      actorId: "a",
      vehicleId: "v",
      commitmentId: "line-1",
      fieldCargoId: "field-1",
      confirmed: true,
    });
    expect(partial.cargoDelivered).toBe(false);
    expect(partial.dayLineCompleted).toBe(true);
    expect(partial.errors).toContain("cargo failed");
  });
});
