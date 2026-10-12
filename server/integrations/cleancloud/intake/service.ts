import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../../db";
import {
  pickupConnection,
  type PickupActor,
  type PickupSource,
} from "../pickups/service";
import { intakeConnections, intakeOrders } from "./schema";
import {
  intakeFingerprintText,
  validateIntakePlan,
  type IntakeOrder,
  type IntakeProduct,
  type IntakePlan,
  type IntakePrepared,
} from "../../../../shared/cleancloudIntake";
const fail = (message: string): never => {
  throw new TRPCError({ code: "CONFLICT", message });
};
async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
}
export async function intakeConnection(actor: PickupActor) {
  const db = await database();
  const paired = await pickupConnection(actor);
  const [connection] = await db
    .select()
    .from(intakeConnections)
    .where(eq(intakeConnections.tenantId, actor.tenantId));
  return {
    ...paired,
    intake: connection ?? null,
    tenantId: actor.tenantId,
    actorId: actor.actorId,
  };
}
async function source(actor: PickupActor, input: PickupSource, enabled = true) {
  const current = await intakeConnection(actor);
  if (
    current.binding?.id !== input.bindingId ||
    current.binding.storeLabel !== input.storeLabel
  )
    fail("CleanCloud store changed. Reconnect Gumball.");
  if (
    enabled &&
    (!current.intake?.enabled ||
      current.intake.bindingId !== input.bindingId ||
      current.intake.actorId !== actor.actorId)
  )
    fail("Intake pilot paused or paired browser changed.");
  return current;
}
function fresh(time: string, max = 300000) {
  if (
    Math.abs(Date.now() - Date.parse(time)) > max ||
    !Number.isFinite(Date.parse(time))
  )
    fail("CleanCloud observation expired. Read the order again.");
}
export async function captureIntake(
  actor: PickupActor,
  input: PickupSource & {
    observedAt: string;
    rows: IntakeOrder[];
    catalog: IntakeProduct[];
  },
  connect = false
) {
  const current = await source(actor, input, !connect);
  fresh(input.observedAt);
  if (
    new Set(input.rows.map(x => x.externalOrderId)).size !==
      input.rows.length ||
    new Set(input.catalog.map(x => x.id)).size !== input.catalog.length
  )
    fail("Duplicate source identifiers. Capture stopped.");
  const db = await database();
  return db.transaction(async tx => {
    if (connect)
      await tx
        .insert(intakeConnections)
        .values({
          tenantId: actor.tenantId,
          bindingId: input.bindingId,
          actorId: actor.actorId,
          enabled: true,
          catalogJson: input.catalog,
          capturedAt: new Date(input.observedAt),
        })
        .onDuplicateKeyUpdate({
          set: {
            bindingId: input.bindingId,
            actorId: actor.actorId,
            enabled: true,
            catalogJson: input.catalog,
            capturedAt: new Date(input.observedAt),
          },
        });
    const [locked] = await tx
      .select()
      .from(intakeConnections)
      .where(eq(intakeConnections.tenantId, actor.tenantId))
      .for("update");
    if (
      !locked?.enabled ||
      locked.bindingId !== input.bindingId ||
      locked.actorId !== actor.actorId
    )
      fail("Intake connection changed.");
    const held = new Set(current.connection?.excludedOrderIds ?? []);
    await tx
      .update(intakeOrders)
      .set({ sourcePresent: false })
      .where(
        and(
          eq(intakeOrders.tenantId, actor.tenantId),
          eq(intakeOrders.bindingId, input.bindingId)
        )
      );
    for (const row of input.rows) {
      if (held.has(row.externalOrderId)) continue;
      const [existing] = await tx
        .select()
        .from(intakeOrders)
        .where(
          and(
            eq(intakeOrders.tenantId, actor.tenantId),
            eq(intakeOrders.bindingId, input.bindingId),
            eq(intakeOrders.externalOrderId, row.externalOrderId)
          )
        )
        .for("update");
      if (existing) {
        if (existing.sourceJson.customerName !== row.customerName) {
          await tx
            .update(intakeOrders)
            .set({
              state: "attention",
              lastError: "Source customer identity changed.",
              sourcePresent: false,
            })
            .where(eq(intakeOrders.id, existing.id));
          continue;
        }
        await tx
          .update(intakeOrders)
          .set({
            sourcePresent: true,
            sourceJson: row,
            observedAt: new Date(input.observedAt),
          })
          .where(eq(intakeOrders.id, existing.id));
      } else
        await tx.insert(intakeOrders).values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          bindingId: input.bindingId,
          externalOrderId: row.externalOrderId,
          sourceJson: row,
          observedAt: new Date(input.observedAt),
        });
    }
    await tx
      .update(intakeConnections)
      .set({
        catalogJson: input.catalog,
        capturedAt: new Date(input.observedAt),
      })
      .where(eq(intakeConnections.tenantId, actor.tenantId));
    return {
      imported: input.rows.filter(x => !held.has(x.externalOrderId)).length,
    };
  });
}
export async function listIntake(actor: PickupActor) {
  const current = await intakeConnection(actor);
  const db = await database();
  const rows = current.intake
    ? await db
        .select()
        .from(intakeOrders)
        .where(
          and(
            eq(intakeOrders.tenantId, actor.tenantId),
            eq(intakeOrders.bindingId, current.intake.bindingId)
          )
        )
    : [];
  const held = new Set(current.connection?.excludedOrderIds ?? []);
  return {
    enabled: current.intake?.enabled ?? false,
    catalog: current.intake?.catalogJson ?? [],
    capturedAt: current.intake?.capturedAt ?? null,
    orders: rows
      .filter(
        x =>
          !held.has(x.externalOrderId) &&
          (x.sourcePresent || x.state !== "detail")
      )
      .map(({ leaseToken, leaseUntil, ...row }) => row),
  };
}
export async function commandIntake(
  actor: PickupActor,
  input: {
    id: string;
    action: "prepare" | "approve" | "focus" | "verify";
    plan?: IntakePlan;
    revision?: string;
    fingerprint?: string;
  }
) {
  const current = await intakeConnection(actor);
  if (!current.intake?.enabled)
    fail("Connect the intake pilot in Gumball first.");
  const db = await database();
  return db.transaction(async tx => {
    const [lockedConnection] = await tx
      .select()
      .from(intakeConnections)
      .where(eq(intakeConnections.tenantId, actor.tenantId))
      .for("update");
    if (
      !lockedConnection?.enabled ||
      lockedConnection.bindingId !== current.intake!.bindingId
    )
      fail("Intake connection changed or paused.");
    const [row] = await tx
      .select()
      .from(intakeOrders)
      .where(
        and(
          eq(intakeOrders.id, input.id),
          eq(intakeOrders.tenantId, actor.tenantId)
        )
      )
      .for("update");
    if (
      !row ||
      row.bindingId !== current.intake!.bindingId ||
      current.connection?.excludedOrderIds.includes(row.externalOrderId)
    )
      fail("Order unavailable or held.");
    if (input.action === "focus") {
      if (row.state !== "review") fail("No prepared draft available.");
      await tx
        .update(intakeOrders)
        .set({ focusRequested: true })
        .where(eq(intakeOrders.id, row.id));
      return { queued: true };
    }
    if (input.action === "verify") {
      if (row.state !== "attention" || !row.submittedAt)
        fail("Only an uncertain submission can be checked.");
      await tx
        .update(intakeOrders)
        .set({
          state: "verify_pending",
          leaseToken: null,
          leaseUntil: null,
          lastError: null,
        })
        .where(eq(intakeOrders.id, row.id));
      return { queued: true };
    }
    if (input.action === "approve") {
      if (
        row.state !== "review" ||
        row.revision !== input.revision ||
        row.preparedJson?.fingerprint !== input.fingerprint ||
        !row.preparedAt ||
        Date.now() - row.preparedAt.getTime() > 600000 ||
        !row.sourcePresent
      )
        fail(
          "Reviewed draft changed or expired. Prepare and inspect it again."
        );
      await tx
        .update(intakeOrders)
        .set({
          state: "submit_pending",
          approvedAt: new Date(),
          focusRequested: false,
        })
        .where(eq(intakeOrders.id, row.id));
      return { queued: true };
    }
    if (
      [
        "prepare_pending",
        "preparing",
        "submit_pending",
        "submitting",
        "verify_pending",
        "verifying",
        "saved",
      ].includes(row.state) ||
      row.submittedAt
    )
      fail(
        "Order is already processing or submitted. Check the saved result first."
      );
    if (!row.sourcePresent || Date.now() - row.observedAt.getTime() > 300000)
      fail("Refresh CleanCloud Detail before preparing this order.");
    const plan = validateIntakePlan(input.plan!, current.intake!.catalogJson);
    await tx
      .update(intakeOrders)
      .set({
        state: "prepare_pending",
        revision: randomUUID(),
        planJson: plan,
        preparedJson: null,
        preparedAt: null,
        approvedAt: null,
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
        focusRequested: false,
      })
      .where(eq(intakeOrders.id, row.id));
    return { queued: true };
  });
}
export async function claimIntake(actor: PickupActor, input: PickupSource) {
  const current = await source(actor, input);
  const db = await database();
  return db.transaction(async tx => {
    const [connection] = await tx
      .select()
      .from(intakeConnections)
      .where(eq(intakeConnections.tenantId, actor.tenantId))
      .for("update");
    if (
      !connection?.enabled ||
      connection.actorId !== actor.actorId ||
      connection.bindingId !== input.bindingId
    )
      fail("Intake connection changed.");
    const rows = await tx
      .select()
      .from(intakeOrders)
      .where(
        and(
          eq(intakeOrders.tenantId, actor.tenantId),
          eq(intakeOrders.bindingId, input.bindingId)
        )
      )
      .for("update");
    for (const row of rows) {
      if (
        ["preparing", "submitting", "verifying"].includes(row.state) &&
        row.leaseUntil &&
        row.leaseUntil.getTime() < Date.now()
      )
        await tx
          .update(intakeOrders)
          .set({
            state: "attention",
            lastError: row.submittedAt
              ? "Submission outcome unknown. Check saved result; do not submit again."
              : "Preparation interrupted. Prepare the order again.",
            leaseToken: null,
            leaseUntil: null,
          })
          .where(eq(intakeOrders.id, row.id));
    }
    if (
      rows.some(
        x =>
          ["preparing", "submitting", "verifying"].includes(x.state) &&
          x.leaseUntil &&
          x.leaseUntil.getTime() > Date.now()
      )
    )
      return null;
    for (const row of rows) {
      if (current.connection?.excludedOrderIds.includes(row.externalOrderId))
        continue;
      if (row.state === "review" && row.focusRequested) {
        await tx
          .update(intakeOrders)
          .set({ focusRequested: false })
          .where(eq(intakeOrders.id, row.id));
        return { ...row, operation: "focus" as const };
      }
      if (
        !["prepare_pending", "submit_pending", "verify_pending"].includes(
          row.state
        )
      )
        continue;
      if (
        row.state === "submit_pending" &&
        (!row.approvedAt || Date.now() - row.approvedAt.getTime() > 600000)
      ) {
        await tx
          .update(intakeOrders)
          .set({
            state: "attention",
            lastError: "Approval expired before submission.",
          })
          .where(eq(intakeOrders.id, row.id));
        continue;
      }
      const operation =
        row.state === "prepare_pending"
          ? "prepare"
          : row.state === "submit_pending"
            ? "submit"
            : "verify";
      const leaseToken = randomUUID(),
        leaseUntil = new Date(Date.now() + 180000);
      await tx
        .update(intakeOrders)
        .set({
          state:
            operation === "prepare"
              ? "preparing"
              : operation === "submit"
                ? "submitting"
                : "verifying",
          operation,
          leaseToken,
          leaseUntil,
          ...(operation === "submit" ? { submittedAt: new Date() } : {}),
        })
        .where(eq(intakeOrders.id, row.id));
      return { ...row, operation, leaseToken, leaseUntil };
    }
    return null;
  });
}
export async function finishIntake(
  actor: PickupActor,
  input: PickupSource & {
    id: string;
    revision: string;
    leaseToken: string;
    prepared?: IntakePrepared;
    verified?: boolean;
    error?: string;
  }
) {
  await source(actor, input);
  const db = await database();
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(intakeOrders)
      .where(
        and(
          eq(intakeOrders.id, input.id),
          eq(intakeOrders.tenantId, actor.tenantId)
        )
      )
      .for("update");
    if (
      !row ||
      row.leaseToken !== input.leaseToken ||
      row.revision !== input.revision ||
      !row.leaseUntil ||
      row.leaseUntil.getTime() < Date.now()
    )
      fail("Intake lease expired. Outcome needs attention.");
    let error = input.error;
    const proof = input.prepared;
    if (!error) {
      if (!proof) error = "Missing source proof.";
      else {
        fresh(proof.observedAt);
        if (
          proof.externalOrderId !== row.externalOrderId ||
          proof.customerName !== row.sourceJson.customerName ||
          createHash("sha256")
            .update(intakeFingerprintText(proof))
            .digest("hex") !== proof.fingerprint ||
          new Set(proof.quantities.map(x => x.productId)).size !==
            proof.quantities.length
        )
          error = "Source identity or fingerprint mismatch.";
        else if (
          proof.quantities.length !== row.planJson?.lines.length ||
          row.planJson?.lines.some(
            x =>
              proof.quantities.find(p => p.productId === x.productId)
                ?.quantity !== x.quantity
          )
        )
          error = "Source quantities differ from your intake.";
        else if (
          row.operation !== "prepare" &&
          (!input.verified ||
            proof.fingerprint !== row.preparedJson?.fingerprint)
        )
          error =
            "Saved order differs from the reviewed draft or Cleaning was not verified.";
      }
    }
    await tx
      .update(intakeOrders)
      .set({
        state: error
          ? "attention"
          : row.operation === "prepare"
            ? "review"
            : "saved",
        lastError: error?.slice(0, 512) ?? null,
        leaseToken: null,
        leaseUntil: null,
        ...(!error && proof && row.operation === "prepare"
          ? { preparedJson: proof, preparedAt: new Date() }
          : {}),
        ...(!error && row.operation !== "prepare"
          ? {
              resultJson: {
                stage: "cleaning" as const,
                paymentStatus: "not_verified" as const,
                observedAt: proof!.observedAt,
              },
            }
          : {}),
      })
      .where(eq(intakeOrders.id, row.id));
    return {
      state: error
        ? "attention"
        : row.operation === "prepare"
          ? "review"
          : "saved",
    };
  });
}

// Recheck the authoritative approval immediately before the connector's one click.
export async function authorizeIntakeSubmit(
  actor: PickupActor,
  input: PickupSource & { id: string; revision: string; leaseToken: string }
) {
  const current = await source(actor, input);
  const db = await database();
  const [row] = await db
    .select()
    .from(intakeOrders)
    .where(
      and(
        eq(intakeOrders.id, input.id),
        eq(intakeOrders.tenantId, actor.tenantId)
      )
    );
  if (
    !row ||
    row.bindingId !== input.bindingId ||
    row.state !== "submitting" ||
    row.revision !== input.revision ||
    row.leaseToken !== input.leaseToken ||
    !row.leaseUntil ||
    row.leaseUntil.getTime() <= Date.now() ||
    !row.approvedAt ||
    Date.now() - row.approvedAt.getTime() > 600000 ||
    !row.sourcePresent ||
    current.connection?.excludedOrderIds.includes(row.externalOrderId)
  )
    fail("Approval, lease, source order, or hold changed. Submission stopped.");
  return { authorized: true };
}
export async function pauseIntake(actor: PickupActor) {
  const db = await database();
  await db
    .update(intakeConnections)
    .set({ enabled: false })
    .where(eq(intakeConnections.tenantId, actor.tenantId));
  return { paused: true };
}
