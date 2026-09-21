/**
 * Day Line ↔ Goldline Cargo linkage.
 *
 * Unknown identity stays unknown. No fake customers or orders. Known cargo
 * is not duplicated. Delivery and Day Line completion are independent
 * mutations; speech may only claim what actually succeeded.
 */

import type { MutationReceipt } from "./assertionGuard";
import { UNKNOWN_CARGO_IDENTITY } from "../../shared/claireWorkdayCommand";
import { emptyCommandMetadata } from "../../shared/claireWorkdayCommand";
import { confirmCargo, deliverCustodyToCustomer, proposeCargo } from "../goldlineCargo/cargoService";
import { acceptProposal, completeDayDirectorCommitment, updateDayDirectorCommitment } from "../dayDirector/dayDirectorService";
import { detectUnknownCargoIdentity } from "./workdayCommandLanguage";
import { classifyDayDirectorKind } from "./workdayCommandKind";

export type LinkedVehicleWorkResult = {
  cargo: { ok: true; id: string; kind: "order" | "field"; duplicated: boolean } | { ok: false; error: string };
  dayLine: { ok: true; id: string } | { ok: false; error: string };
  receipts: MutationReceipt[];
};

export function cargoFieldsForUnknownIdentity(input: {
  transcript: string;
  place?: string | null;
}): {
  customerDisplayName: string;
  itemDescription: string;
  quantity: number | null;
  serviceType: "dry_cleaning" | "wash_fold" | null;
  vehicleAction: "add";
  vehicleState: "IN_VEHICLE";
  processingState: "unknown";
  location: string | null;
  notes: string | null;
} {
  const dry = /\bdry[ -]?clean/i.test(input.transcript);
  return {
    customerDisplayName: UNKNOWN_CARGO_IDENTITY,
    itemDescription: dry ? "dry cleaning" : "cargo",
    quantity: null,
    serviceType: dry ? "dry_cleaning" : null,
    vehicleAction: "add",
    vehicleState: "IN_VEHICLE",
    processingState: "unknown",
    location: input.place ?? null,
    notes: input.transcript,
  };
}

export async function confirmLinkedVehicleWork(input: {
  tenantId: string;
  actorId: string;
  vehicleId: string;
  businessDate: string;
  requestId: string;
  transcript: string;
  place?: string | null;
  confirmed: boolean;
}): Promise<LinkedVehicleWorkResult> {
  const receipts: MutationReceipt[] = [];
  if (!input.confirmed) {
    return {
      cargo: { ok: false, error: "Vehicle cargo must be explicitly confirmed." },
      dayLine: { ok: false, error: "Day Line work must be explicitly confirmed." },
      receipts,
    };
  }

  const proposal = await proposeCargo({ tenantId: input.tenantId, transcript: input.transcript });
  const unknown = detectUnknownCargoIdentity(input.transcript);
  const fields = unknown
    ? cargoFieldsForUnknownIdentity({ transcript: input.transcript, place: input.place })
    : proposal;

  let cargo: LinkedVehicleWorkResult["cargo"];
  try {
    if (!unknown && proposal.matchState === "matched" && proposal.matchedOrderId != null) {
      const confirmed = await confirmCargo({
        tenantId: input.tenantId,
        actorId: input.actorId,
        vehicleId: input.vehicleId,
        requestId: input.requestId,
        transcript: input.transcript,
        fields,
        selectedOrderId: proposal.matchedOrderId,
        confirmed: true,
      });
      cargo = { ok: true, id: String(confirmed.id), kind: confirmed.kind, duplicated: false };
      receipts.push({
        claimedState: "created",
        entityId: String(confirmed.id),
        statement: `Linked existing ${confirmed.kind} cargo without duplicating it`,
      });
    } else {
      const confirmed = await confirmCargo({
        tenantId: input.tenantId,
        actorId: input.actorId,
        vehicleId: input.vehicleId,
        requestId: input.requestId,
        transcript: input.transcript,
        fields,
        confirmed: true,
      });
      cargo = { ok: true, id: String(confirmed.id), kind: confirmed.kind, duplicated: false };
      receipts.push({
        claimedState: "created",
        entityId: String(confirmed.id),
        statement: unknown
          ? `Recorded unlinked field cargo with ${UNKNOWN_CARGO_IDENTITY}`
          : `Recorded vehicle cargo`,
      });
    }
  } catch (error) {
    cargo = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  let dayLine: LinkedVehicleWorkResult["dayLine"];
  try {
    const command = emptyCommandMetadata();
    command.identityUnknown = unknown;
    command.cargoLink = cargo.ok
      ? { kind: cargo.kind, id: cargo.id }
      : null;
    command.role = "fixed";
    const title = unknown
      ? `Drop off dry cleaning${input.place ? ` at ${input.place}` : ""} (${UNKNOWN_CARGO_IDENTITY})`
      : `Drop off ${fields.customerDisplayName} cargo`;
    const stored = await acceptProposal({
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: input.businessDate,
      proposal: {
        promptKey: `cargo-line:${input.requestId}`,
        title: title.slice(0, 255),
        kind: classifyDayDirectorKind(input.transcript),
        quantity: fields.quantity,
        sourceText: input.transcript,
        prerequisites: [],
        question: unknown ? "Whose order is this?" : null,
        intelligence: "manual_fallback",
        detailState: unknown ? "NEEDS_DETAILS" : "COMPLETE",
        missingDetails: unknown ? ["customer identity"] : [],
        detailNote: unknown ? `${UNKNOWN_CARGO_IDENTITY}${input.place ? ` · ${input.place}` : ""}` : null,
        command,
      },
    });
    const id = stored && typeof stored === "object" && "id" in stored ? String((stored as { id?: unknown }).id ?? "") : "";
    if (!id) throw new Error("Day Line item was not persisted");
    if (cargo.ok) {
      await updateDayDirectorCommitment({
        tenantId: input.tenantId,
        actorId: input.actorId,
        commitmentId: id,
        patch: {
          detailNote: unknown
            ? `${UNKNOWN_CARGO_IDENTITY}${input.place ? ` · ${input.place}` : ""} · cargo ${cargo.kind}:${cargo.id}`
            : `cargo ${cargo.kind}:${cargo.id}`,
        },
      }).catch(() => undefined);
    }
    dayLine = { ok: true, id };
    receipts.push({ claimedState: "created", entityId: id, statement: `Added ${title} to the Day Line` });
  } catch (error) {
    dayLine = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return { cargo, dayLine, receipts };
}

export async function completeLinkedVehicleDelivery(input: {
  tenantId: string;
  actorId: string;
  vehicleId: string;
  commitmentId: string;
  orderId?: number;
  fieldCargoId?: string;
  confirmed: boolean;
}): Promise<{
  cargoDelivered: boolean;
  dayLineCompleted: boolean;
  receipts: MutationReceipt[];
  errors: string[];
}> {
  const receipts: MutationReceipt[] = [];
  const errors: string[] = [];
  let cargoDelivered = false;
  let dayLineCompleted = false;
  if (!input.confirmed) {
    return { cargoDelivered, dayLineCompleted, receipts, errors: ["Delivery must be explicitly confirmed."] };
  }
  try {
    const result = await deliverCustodyToCustomer({
      tenantId: input.tenantId,
      actorId: input.actorId,
      vehicleId: input.vehicleId,
      orderId: input.orderId,
      fieldCargoId: input.fieldCargoId,
      confirmed: true,
    });
    cargoDelivered = Boolean(result?.delivered);
    if (cargoDelivered) {
      receipts.push({
        claimedState: "completed",
        entityId: String(input.orderId ?? input.fieldCargoId),
        statement: "Marked vehicle cargo delivered",
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const result = await completeDayDirectorCommitment({
      tenantId: input.tenantId,
      actorId: input.actorId,
      commitmentId: input.commitmentId,
    });
    dayLineCompleted = Boolean(result?.ok);
    if (dayLineCompleted) {
      receipts.push({
        claimedState: "completed",
        entityId: input.commitmentId,
        statement: "Completed linked Day Line work",
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { cargoDelivered, dayLineCompleted, receipts, errors };
}
