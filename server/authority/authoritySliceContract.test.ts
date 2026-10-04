import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("three-fact authority slice", () => {
  it("makes payment truth pass through a durable receipt before native order mutation", () => {
    const route = source("server/routers.ts");
    const admission = source("server/authority/paymentAdmission.ts");
    const commercial = source("server/commercialPipeline/commercialPipelineService.ts");
    expect(route).toContain("admitNativeStripePayment");
    expect(admission).toContain("prepareNativeStripePaymentTenant");
    expect(route).toContain(
      "const paymentTenantId = await prepareNativeStripePaymentTenant"
    );
    expect(
      route.indexOf("const paymentTenantId = await prepareNativeStripePaymentTenant")
    ).toBeLessThan(route.indexOf("stripe.paymentIntents.create({"));
    expect(route).toContain("tenantId: paymentTenantId");
    expect(admission).toContain('claimType: "payment_verified"');
    const nativeAdmission = admission.slice(
      admission.indexOf("export async function admitNativeStripePayment")
    );
    expect(nativeAdmission.indexOf("admitAuthorityClaimWith")).toBeLessThan(
      nativeAdmission.indexOf("paid: true")
    );
    expect(commercial).toContain("findAuthorityReceiptForSubjectWith");
    expect(commercial).toContain("hasNativePaymentAuthority(order)");
    expect(commercial).toContain('paymentAuthority?.sourceType === "stripe_payment_intent"');
    expect(commercial).toContain("paymentAuthority.sourceRef === paymentIntentId");
  });

  it("creates account-win authority in the same mission transaction and makes Goldline require it", () => {
    const missions = source("server/commercialMissions/commercialMissionStore.ts");
    const worldStore = source("server/goldlineWorld/worldEventStore.ts");
    const worldContract = source("shared/goldlineWorld.ts");
    expect(missions).toContain('claimType: "account_won"');
    expect(missions).toContain("authorityReceiptId: winAuthority.id");
    expect(worldStore).toContain("Goldline account_won requires an authority receipt");
    expect(worldStore).toContain('receipt.subjectType !== "commercial_mission"');
    expect(worldStore).toContain("receipt.subjectId !== commercialMissionId");
    expect(worldStore).toContain("/^\\d+$/");
    expect(worldStore).toContain("receipt.sourceRef !== input.sourceEvidenceReference");
    expect(worldStore).toContain('eq(physicalEntityBindings.bindingType, "commercial_account")');
    expect(worldStore).toContain('eq(physicalEntityBindings.reviewState, "accepted")');
    expect(worldContract).toContain('input.eventType === "account_won"');
    expect(worldContract).toContain("input.metadata?.authorityReceiptId");
  });

  it("does not allow a tool to claim a message send without provider evidence", () => {
    const communications = source("server/twilioPlatform/communicationReceipts.ts");
    const customer = source("server/agents/tools/sendCustomerReminderTool.ts");
    const vendor = source("server/agents/tools/requestVendorConfirmationTool.ts");
    const vendorBooking = source("server/agents/tools/requestVendorBookingConfirmationTool.ts");
    expect(communications).toContain('claimType: "message_sent"');
    expect(communications).toContain("db.transaction(async tx");
    expect(customer).toContain("sendSMSWithReceipt");
    expect(customer).toContain("Customer reminder requires a durable idempotency key");
    expect(customer).toContain("recordCommunicationReceipt");
    expect(customer).toContain("authorityReceiptId: authority.id");
    expect(customer).toContain("sent: false");
    expect(vendor).toContain('status: "prepared_awaiting_transport"');
    expect(vendor).toContain("messageSent: false");
    expect(vendorBooking).toContain('status: "prepared_awaiting_transport"');
    expect(vendorBooking).toContain("messageSent: false");
    expect(vendor + vendorBooking).not.toContain('status: "confirmation_requested"');
  });

  it("ships a migration and legacy backfill for all three fact classes", () => {
    const migration = source("drizzle/0113_authority_receipts.sql");
    const migrate = source("scripts/migrate.mjs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `authority_receipts`");
    expect(migrate).toContain("legacy_stripe_payment_backfill_v1");
    expect(migrate).toContain(
      "WHEN tenantId IS NULL OR TRIM(tenantId) = '' THEN 'default'"
    );
    expect(migrate).toContain("legacy_cleancloud_payment_backfill_v1");
    expect(migrate).toContain("legacy_commercial_win_backfill_v1");
    expect(migrate).toContain("e.eventName = 'account_won'");
    expect(migrate).toContain(
      "remove non-win commercial account authority receipts"
    );
    expect(migrate).toContain("'$.commercialMissionId'");
    expect(migrate).toContain("physical_entity_bindings b");
    expect(migrate).toContain("legacy_twilio_message_backfill_v1");
  });
});
