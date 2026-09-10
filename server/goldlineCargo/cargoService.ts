import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import {
  matchingCargoOrders,
  parseCargoTranscript,
  type CargoVoiceFields,
} from "../../shared/goldlineCargoVoice";
import { getDb } from "../db";

export type CargoState =
  | "IN_VEHICLE_UNPROCESSED"
  | "AT_PROCESSOR"
  | "IN_VEHICLE_PROCESSED";
let schemaReady: Promise<void> | null = null;

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  if (!schemaReady) {
    schemaReady = database
      .execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS goldline_field_cargo (
      id varchar(36) NOT NULL, tenantId varchar(64) NOT NULL, vehicleId varchar(128) NULL,
      actorId varchar(128) NOT NULL, requestId varchar(64) NOT NULL, transcript text NOT NULL,
      customerDisplayName varchar(191) NOT NULL, itemDescription varchar(255) NOT NULL,
      quantity int NULL, serviceType enum('dry_cleaning','wash_fold') NULL,
      vehicleState enum('IN_VEHICLE','AT_PROCESSOR','REMOVED') NOT NULL DEFAULT 'IN_VEHICLE',
      processingState enum('unknown','unprocessed','processed') NOT NULL DEFAULT 'unknown',
      location varchar(512) NULL, notes text NULL, linkedOrderId int NULL,
      confirmedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_goldline_field_cargo_request (tenantId,requestId),
      KEY idx_goldline_field_cargo_vehicle (tenantId,vehicleId,vehicleState),
      KEY idx_goldline_field_cargo_order (tenantId,linkedOrderId)
    )`)
      )
      .then(() => undefined)
      .catch(error => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
  return database;
}

export async function listCargo(tenantId: string, vehicleId: string) {
  const database = await db();
  const nativeRows: any[] =
    (
      (await database.execute(
        sql`SELECT c.state,c.vehicleId,c.transferredAt,c.evidenceJson,o.id,o.firstName,o.lastName,o.address,o.status,o.serviceType FROM goldline_vehicle_custody c JOIN orders o ON o.id=c.orderId AND o.tenantId=c.tenantId WHERE c.tenantId=${tenantId} AND c.vehicleId=${vehicleId} AND c.state IN ('IN_VEHICLE_UNPROCESSED','IN_VEHICLE_PROCESSED') AND o.status NOT IN ('delivered','cancelled') ORDER BY c.transferredAt,o.id`
      )) as any
    )[0] ?? [];
  const fieldRows: any[] =
    (
      (await database.execute(
        sql`SELECT * FROM goldline_field_cargo WHERE tenantId=${tenantId} AND vehicleId=${vehicleId} AND vehicleState='IN_VEHICLE' ORDER BY confirmedAt,id`
      )) as any
    )[0] ?? [];
  return [
    ...nativeRows.map(row => ({
      ...row,
      source: "order" as const,
      evidenceJson:
        typeof row.evidenceJson === "string"
          ? JSON.parse(row.evidenceJson)
          : row.evidenceJson,
    })),
    ...fieldRows.map(row => ({
      id: `field:${row.id}`,
      fieldCargoId: row.id,
      source: "field" as const,
      firstName: row.customerDisplayName,
      lastName: null,
      address: row.location,
      state:
        row.processingState === "processed"
          ? "IN_VEHICLE_PROCESSED"
          : "IN_VEHICLE_UNPROCESSED",
      customerDisplayName: row.customerDisplayName,
      itemDescription: row.itemDescription,
      quantity: row.quantity == null ? null : Number(row.quantity),
      serviceType: row.serviceType,
      processingState: row.processingState,
      linkedOrderId:
        row.linkedOrderId == null ? null : Number(row.linkedOrderId),
      unlinked: row.linkedOrderId == null,
      notes: row.notes,
      transcript: row.transcript,
      confirmedAt: new Date(row.confirmedAt).toISOString(),
    })),
  ];
}

export async function listAtProcessor(tenantId: string) {
  const database = await db();
  return ((
    (await database.execute(
      sql`SELECT c.state,c.vehicleId,c.transferredAt,c.evidenceJson,o.id,o.firstName,o.lastName,o.address,o.status FROM goldline_vehicle_custody c JOIN orders o ON o.id=c.orderId AND o.tenantId=c.tenantId WHERE c.tenantId=${tenantId} AND c.state='AT_PROCESSOR' AND o.status NOT IN ('delivered','cancelled') ORDER BY c.transferredAt,o.id`
    )) as any
  )[0] ?? []) as any[];
}

export async function listUnassignedPickedUp(tenantId: string) {
  const database = await db();
  const explicit: any[] =
    (
      (await database.execute(
        sql`SELECT orderId FROM goldline_vehicle_custody WHERE tenantId=${tenantId}`
      )) as any
    )[0] ?? [];
  const claimed = new Set(explicit.map(row => Number(row.orderId)));
  return (
    await database
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "collected")))
  ).filter(order => !claimed.has(order.id));
}

export async function transferCustody(input: {
  tenantId: string;
  orderId: number;
  actorId: string;
  vehicleId: string;
  to: CargoState;
  confirmed: boolean;
}) {
  if (!input.confirmed)
    throw new Error("Physical transfer must be explicitly confirmed.");
  const database = await db();
  return database.transaction(async tx => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(eq(orders.tenantId, input.tenantId), eq(orders.id, input.orderId))
      )
      .limit(1);
    if (!order) throw new Error("Order not found in this tenant.");
    if (
      !(["collected", "processing", "ready"] as string[]).includes(order.status)
    )
      throw new Error("Order status does not support this custody transfer.");
    const prior: any[] =
      (
        (await tx.execute(
          sql`SELECT state,revision FROM goldline_vehicle_custody WHERE tenantId=${input.tenantId} AND orderId=${input.orderId} FOR UPDATE`
        )) as any
      )[0] ?? [];
    const from: CargoState | "AWAITING_PICKUP" =
      prior[0]?.state ?? "AWAITING_PICKUP";
    const allowed =
      (from === "AWAITING_PICKUP" &&
        input.to === "IN_VEHICLE_UNPROCESSED" &&
        order.status === "collected") ||
      (from === "IN_VEHICLE_UNPROCESSED" && input.to === "AT_PROCESSOR") ||
      (from === "AT_PROCESSOR" &&
        input.to === "IN_VEHICLE_PROCESSED" &&
        order.status === "ready");
    if (!allowed) {
      if (from === input.to) return { state: from, idempotent: true };
      throw new Error(
        `Custody cannot move from ${from} to ${input.to} while order is ${order.status}.`
      );
    }
    const evidence = {
      confirmedBy: input.actorId,
      confirmedAt: new Date().toISOString(),
      from,
      to: input.to,
      orderStatus: order.status,
      claims: { gpsProvesTransfer: false },
    };
    await tx.execute(
      sql`INSERT INTO goldline_vehicle_custody (tenantId,orderId,state,vehicleId,actorId,evidenceJson) VALUES (${input.tenantId},${input.orderId},${input.to},${input.to === "AT_PROCESSOR" ? null : input.vehicleId},${input.actorId},${JSON.stringify(evidence)}) ON DUPLICATE KEY UPDATE state=VALUES(state),vehicleId=VALUES(vehicleId),actorId=VALUES(actorId),evidenceJson=VALUES(evidenceJson),revision=revision+1,transferredAt=CURRENT_TIMESTAMP`
    );
    return { state: input.to, idempotent: false };
  });
}

export function cargoAppearance(
  state: Extract<CargoState, "IN_VEHICLE_UNPROCESSED" | "IN_VEHICLE_PROCESSED">
) {
  return state === "IN_VEHICLE_UNPROCESSED"
    ? {
        kind: "paper_bag" as const,
        condition: "scrunched garments",
        next: "Processor handoff",
      }
    : {
        kind: "garment_bag" as const,
        condition: "Processed cargo",
        next: "Customer return",
      };
}

export type CargoMatch = {
  orderId: number;
  customerDisplayName: string;
  address: string;
  serviceType: "wash_fold" | "dry_cleaning";
  status: string;
};
export type CargoProposal = CargoVoiceFields & {
  transcript: string;
  matchState: "unlinked" | "matched" | "ambiguous";
  matchedOrderId: number | null;
  candidates: CargoMatch[];
  confirmationRequired: true;
};

export async function proposeCargo(input: {
  tenantId: string;
  transcript: string;
}): Promise<CargoProposal> {
  const fields = parseCargoTranscript(input.transcript);
  const database = await db();
  if (fields.vehicleAction === "remove")
    return {
      ...fields,
      transcript: input.transcript.trim(),
      matchState: "unlinked",
      matchedOrderId: null,
      candidates: [],
      confirmationRequired: true,
    };
  const active = await database
    .select({
      id: orders.id,
      firstName: orders.firstName,
      lastName: orders.lastName,
      address: orders.address,
      serviceType: orders.serviceType,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, input.tenantId),
        inArray(orders.status, ["collected", "ready"])
      )
    );
  const candidates = matchingCargoOrders(fields.customerDisplayName, active)
    .filter(order =>
      fields.processingState === "processed"
        ? order.status === "ready"
        : order.status === "collected"
    )
    .map(order => ({
    orderId: order.id,
    customerDisplayName: `${order.firstName} ${order.lastName}`.trim(),
    address: order.address,
    serviceType: order.serviceType,
    status: order.status,
    }));
  return {
    ...fields,
    transcript: input.transcript.trim(),
    matchState:
      candidates.length === 1
        ? "matched"
        : candidates.length > 1
          ? "ambiguous"
          : "unlinked",
    matchedOrderId: candidates.length === 1 ? candidates[0].orderId : null,
    candidates,
    confirmationRequired: true,
  };
}

export async function confirmCargo(input: {
  tenantId: string;
  actorId: string;
  vehicleId: string;
  requestId: string;
  transcript: string;
  fields: CargoVoiceFields;
  selectedOrderId?: number | null;
  confirmed: boolean;
}) {
  if (!input.confirmed)
    throw new Error("Vehicle cargo must be explicitly confirmed.");
  const proposal = await proposeCargo({
    tenantId: input.tenantId,
    transcript: input.transcript,
  });
  const fields = input.fields;
  if (fields.vehicleAction === "remove") {
    const database = await db();
    const rows: any[] =
      (
        (await database.execute(
          sql`SELECT id FROM goldline_field_cargo WHERE tenantId=${input.tenantId} AND vehicleId=${input.vehicleId} AND vehicleState='IN_VEHICLE' AND LOWER(customerDisplayName)=LOWER(${fields.customerDisplayName}) ORDER BY confirmedAt DESC`
        )) as any
      )[0] ?? [];
    if (rows.length !== 1)
      throw new Error(
        rows.length
          ? "More than one cargo item matches. Choose the item manually."
          : "No matching unlinked cargo is in this vehicle."
      );
    await database.execute(
      sql`UPDATE goldline_field_cargo SET vehicleState='REMOVED',actorId=${input.actorId} WHERE tenantId=${input.tenantId} AND id=${rows[0].id}`
    );
    return {
      kind: "field" as const,
      id: rows[0].id,
      state: "REMOVED" as const,
    };
  }
  const selected = input.selectedOrderId ?? proposal.matchedOrderId;
  if (proposal.matchState === "ambiguous" && !selected)
    throw new Error("Choose which order before adding cargo.");
  if (selected) {
    const candidate = proposal.candidates.find(
      candidate => candidate.orderId === selected
    );
    if (!candidate)
      throw new Error("The selected order is not an authoritative match.");
    const result = await transferCustody({
      tenantId: input.tenantId,
      actorId: input.actorId,
      vehicleId: input.vehicleId,
      orderId: selected,
      to:
        candidate.status === "ready"
          ? "IN_VEHICLE_PROCESSED"
          : "IN_VEHICLE_UNPROCESSED",
      confirmed: true,
    });
    return { kind: "order" as const, id: selected, state: result.state };
  }
  const database = await db();
  const id = randomUUID();
  await database.execute(
    sql`INSERT INTO goldline_field_cargo (id,tenantId,vehicleId,actorId,requestId,transcript,customerDisplayName,itemDescription,quantity,serviceType,processingState,location,notes) VALUES (${id},${input.tenantId},${input.vehicleId},${input.actorId},${input.requestId},${input.transcript.trim()},${fields.customerDisplayName},${fields.itemDescription},${fields.quantity},${fields.serviceType},${fields.processingState},${fields.location},${fields.notes}) ON DUPLICATE KEY UPDATE requestId=requestId`
  );
  const stored: any[] =
    (
      (await database.execute(
        sql`SELECT id FROM goldline_field_cargo WHERE tenantId=${input.tenantId} AND requestId=${input.requestId} LIMIT 1`
      )) as any
    )[0] ?? [];
  return {
    kind: "field" as const,
    id: String(stored[0]?.id ?? id),
    state: "IN_VEHICLE" as const,
  };
}

/**
 * Edits an existing field-cargo entry in place — the same row the on-car
 * garment bag / cargo list article already renders, identified by its real
 * id. Scoped to this vehicle's own still-in-vehicle cargo so a driver can
 * only edit their own current custody, never another vehicle's record or
 * one that has already moved on (AT_PROCESSOR/REMOVED).
 */
export async function updateFieldCargo(input: {
  tenantId: string;
  vehicleId: string;
  fieldCargoId: string;
  fields: Pick<
    CargoVoiceFields,
    | "customerDisplayName"
    | "itemDescription"
    | "quantity"
    | "serviceType"
    | "processingState"
    | "notes"
  >;
}) {
  const database = await db();
  const result: any = await database.execute(
    sql`UPDATE goldline_field_cargo SET customerDisplayName=${input.fields.customerDisplayName},itemDescription=${input.fields.itemDescription},quantity=${input.fields.quantity},serviceType=${input.fields.serviceType},processingState=${input.fields.processingState},notes=${input.fields.notes} WHERE tenantId=${input.tenantId} AND id=${input.fieldCargoId} AND vehicleId=${input.vehicleId} AND vehicleState='IN_VEHICLE'`
  );
  const updated = Number(result?.[0]?.affectedRows ?? 0) === 1;
  if (!updated)
    throw new Error(
      "That cargo entry is no longer in this vehicle, so it can't be edited here."
    );
  return { updated: true as const, id: input.fieldCargoId };
}

export async function linkFieldCargo(input: {
  tenantId: string;
  fieldCargoId: string;
  orderId: number;
  actorId: string;
}) {
  const database = await db();
  const [order] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(eq(orders.tenantId, input.tenantId), eq(orders.id, input.orderId))
    )
    .limit(1);
  if (!order) throw new Error("Order not found in this tenant.");
  const result: any = await database.execute(
    sql`UPDATE goldline_field_cargo SET linkedOrderId=${input.orderId},actorId=${input.actorId} WHERE tenantId=${input.tenantId} AND id=${input.fieldCargoId} AND linkedOrderId IS NULL`
  );
  return {
    linked: Number(result?.[0]?.affectedRows ?? 0) === 1,
    orderId: input.orderId,
  };
}
