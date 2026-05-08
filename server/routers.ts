import { getDashboardTimeZone } from "./dashboardZoned";
import { writeOrderToSheet } from "./sheets";
import { COOKIE_NAME, VENDOR_COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, platformOrVendorProcedure, vendorProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createOrder,
  updateOrderStripe,
  getOrderById,
  getOrdersByStatus,
  getOrdersByDateAndStatus,
  updateOrderStatus,
  updateOrderIntake,
  searchCustomerByPhone,
  searchOrdersForReceipt,
  hasCustomerPaidBefore,
  findStripeCardByPhone,
  deleteOrder,
  updateOrderVendor,
  createVendor,
  getVendorById,
  listVendors,
  updateVendorIsActive,
  updateVendorConnectAccount,
  updateVendorConnectStatus,
  createVendorCoverage,
  updateVendorCoverage,
  deleteVendorCoverage,
  listVendorCoverage,
  getVendorForOrder,
  getVendorBySlug,
  getVendorUserByVendorIdAndEmail,
  getOrdersByVendorId,
  getVendorCustomers,
  getVendorPayouts,
  createVendorUser,
  updateVendorUserPassword,
  updateVendorBranding,
  updateVendorSlug,
  listVendorUsers,
  listCoordinatedRequests,
  getNewCoordinatedRequestsCount,
  updateServiceRequestStatus,
  createLead,
  getLeadById,
  listLeads,
  getUnreadLeadsCount,
  updateLeadStatus,
  markLeadAsRead,
  markLeadAsUnread,
  updateLeadNotes,
  getOrdersByPhoneExact,
  listAdminCustomerAggregates,
  listPaidOrdersForBuildingRevenue,
  getAdminDashboardSummary,
  listCatalogItemsForAdmin,
  listActiveCatalogForPublic,
  createCatalogItemRow,
  updateCatalogItemRow,
  archiveCatalogItemRow,
  reorderCatalogItemsForTenant,
  bulkApplyCatalogImport,
  getCatalogItemBySlugForTenant,
  resolveActiveCatalogItemBySlugOrName,
} from "./db";
import {
  normalizeCatalogCategory,
  parseMenuFileWithLLM,
  parseCatalogCommandWithLLM,
  slugifyCatalogName,
} from "./catalogAi";
import {
  buildCustomerProfile,
  deriveFloorNumber,
  hydrateCustomerAggregates,
} from "./customerProfile";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import { notifyPickupEnRoute, notifyCardCharged, notifyDeliveryEnRoute } from "./_core/sms";
import { centsToDollars } from "@shared/pricing";
import { z } from "zod";
import Stripe from "stripe";
import * as jose from "jose";
import { matchBuilding } from "@shared/buildings";
import { normalizePropertyTower, TOWER_DEFINITIONS } from "@shared/propertyTowers";
import { cleanCloudLegacyCustomers } from "./cleancloudLegacy";
import {
  getActedOnTodayCents,
  getAwaitingPaymentCents,
  upsertAwaitingPaymentAdjustmentCents,
  getCollectedTodayCents,
  getLevel1ApexCommand as loadLevel1ApexCommand,
  getLevel2TacticalCluster as loadLevel2TacticalCluster,
  getRevenueInterventionOrderDebug,
  sendPaymentReminderForOrder,
} from "./revenueIntervention";
import { getLevel4OffensiveState as loadLevel4OffensiveState } from "./level4Offensive";
import {
  generateOffensiveCopy as generateLevel4OffensiveCopy,
  type GenerateOffensiveCopyInput,
} from "./level4OffensiveCopy";
import {
  executeOffensiveAction as executeLevel4OffensiveAction,
  type ExecuteOffensiveInput,
} from "./level4OffensiveExecute";
import { getLevel4GateState as loadLevel4GateState } from "./level4Gate";
import { runAgentTool, runOperatorVoiceCommand } from "./agents/agentRuntime";
import { getAgentEventTimeline } from "./agents/agentEvents";
import { getTenantAiLimitState } from "./agents/costTracking";
import { listAgentTools } from "./agents/toolRegistry";
import type { AgentType, ActorType } from "./agents/permissions";

const STRIPE_API_VERSION = "2025-03-31.basil" as const;

function getStripe(): Stripe {
  const key =
    process.env.STRIPE_SECRET_KEY_OVERRIDE || process.env.STRIPE_SECRET_KEY || "";
  if (!key || key.length < 20) {
    throw new Error(
      "STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_OVERRIDE) must be set and non-empty. Check env."
    );
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION as any });
}

export function validateStripeEnv(): void {
  const key =
    process.env.STRIPE_SECRET_KEY_OVERRIDE || process.env.STRIPE_SECRET_KEY || "";
  if (!key || key.length < 20) {
    throw new Error(
      "STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_OVERRIDE) must be set at startup. Set in Railway env."
    );
  }
  if (process.env.STRIPE_SECRET_KEY_OVERRIDE) {
    console.log("[Stripe] Using alternate account (key ends ..." + key.slice(-4) + ")");
  }
}

const APP_SHARED_SECRET = new TextEncoder().encode(process.env.APP_SHARED_API_SECRET || "fallback-secret");

/** Catalog/menu LLM errors → tRPC (Anthropic Messages API). */
function throwCatalogAiAsTrpc(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  const max = 2000;
  const clip = (s: string) => (s.length > max ? `${s.slice(0, max)}…` : s);

  if (msg.includes("ANTHROPIC_API_KEY is not configured")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI is not configured. Set ANTHROPIC_API_KEY on the server.",
    });
  }
  if (msg.includes("authentication failed")) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: clip(msg) });
  }
  if (msg.includes("rate limit")) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: clip(msg) });
  }
  if (
    msg.includes("no tool_use") ||
    msg.includes("tool mismatch") ||
    msg.includes("empty input object") ||
    msg.includes("invalid JSON") ||
    msg.includes("Command parse returned") ||
    msg.includes("Menu parse returned") ||
    msg.includes("missing items array") ||
    msg.includes("requires a data URL") ||
    msg.includes("Menu parse missing") ||
    msg.includes("Command parse:") ||
    msg.includes("Menu parse:")
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: clip(msg) });
  }
  if (msg.includes("rejected the request") || msg.includes("Anthropic API error")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: clip(msg) });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: clip(msg) });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /** Resident + marketing sites: active, online catalog for request Host tenant only */
  catalog: router({
    getActiveCatalog: publicProcedure.query(async ({ ctx }) => {
      return listActiveCatalogForPublic(ctx.tenantId);
    }),
  }),

  vendor: router({
    /** Public — returns vendor info when session valid, null otherwise. For vendor portal auth check. */
    me: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.vendorSession) return null;
      const vendor = await getVendorById(ctx.vendorSession.vendorId);
      if (!vendor) return null;
      return {
        vendorId: vendor.id,
        vendorSlug: vendor.slug ?? "",
        brandName: vendor.brandName ?? vendor.name,
        logoUrl: vendor.logoUrl ?? null,
        chargesEnabled: vendor.chargesEnabled ?? false,
        payoutsEnabled: vendor.payoutsEnabled ?? false,
      };
    }),
    logout: vendorProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(VENDOR_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    dashboard: vendorProcedure.query(async ({ ctx }) => {
      const vid = ctx.vendorSession.vendorId;
      const today = new Date().toISOString().split("T")[0];
      const orders = await getOrdersByVendorId(vid);
      const todayOrders = orders.filter(o =>
        (o.pickupDate === today || o.deliveryDate === today)
      );
      const awaitingIntake = orders.filter(o => o.status === "collected");
      const readyForDelivery = orders.filter(o => o.status === "ready");
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];
      const thisWeekOrders = orders.filter(o => {
        const d = o.updatedAt ? new Date(o.updatedAt).toISOString().split("T")[0] : "";
        return d >= weekStartStr && o.paid;
      });
      const grossCents = thisWeekOrders.reduce((s, o) => s + (o.total ? Math.round(parseFloat(String(o.total)) * 100) : 0), 0);
      const payoutCents = thisWeekOrders.reduce((s, o) => s + (o.vendorPayoutCents ?? 0), 0);
      const last5 = orders.slice(0, 5);
      return {
        todayOrderCount: todayOrders.length,
        awaitingIntakeCount: awaitingIntake.length,
        readyForDeliveryCount: readyForDelivery.length,
        thisWeekGrossCents: grossCents,
        thisWeekPayoutCents: payoutCents,
        recentOrders: last5,
      };
    }),
    listOrders: vendorProcedure
      .input(z.object({ status: z.enum(["new", "intake-pending", "collected", "processing", "ready", "delivered"]).optional() }))
      .query(async ({ ctx, input }) => {
        return getOrdersByVendorId(ctx.vendorSession.vendorId, input.status);
      }),
    listByStatus: vendorProcedure
      .input(z.object({ status: z.enum(["new", "intake-pending", "collected", "processing", "ready", "delivered"]) }))
      .query(async ({ ctx, input }) => {
        return getOrdersByVendorId(ctx.vendorSession.vendorId, input.status);
      }),
    listByDate: vendorProcedure
      .input(z.object({
        date: z.string(),
        status: z.enum(["new", "intake-pending", "collected", "processing", "ready", "delivered"]),
        dateField: z.enum(["pickupDate", "deliveryDate"]).default("pickupDate"),
      }))
      .query(async ({ ctx, input }) => {
        return getOrdersByDateAndStatus(
          input.date,
          input.status,
          input.dateField,
          ctx.vendorSession.vendorId
        );
      }),
    listCustomers: vendorProcedure.query(async ({ ctx }) => {
      return getVendorCustomers(ctx.vendorSession.vendorId);
    }),
    listPayouts: vendorProcedure.query(async ({ ctx }) => {
      return getVendorPayouts(ctx.vendorSession.vendorId);
    }),
    getConnectDashboardLink: vendorProcedure.query(async ({ ctx }) => {
      const vendor = await getVendorById(ctx.vendorSession.vendorId);
      if (!vendor?.stripeConnectAccountId) return null;
      const stripe = getStripe();
      const link = await stripe.accounts.createLoginLink(vendor.stripeConnectAccountId);
      return { url: link.url };
    }),
  }),

  /* ===== CUSTOMER-FACING ORDERS (public) ===== */
  orders: router({
    create: publicProcedure
      .input(
        z.object({
          serviceType: z.enum(["wash_fold", "dry_cleaning"]),
          pickupDate: z.string(),
          pickupTimeWindow: z.string(),
          address: z.string().min(1),
          unit: z.string().optional(),
          specialInstructions: z.string().optional(),
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          phone: z.string().min(1),
          email: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Calculate default delivery date (pickup + 1 day)
        const pickupDateObj = new Date(input.pickupDate + "T00:00:00");
        pickupDateObj.setDate(pickupDateObj.getDate() + 1);
        const deliveryDate = pickupDateObj.toISOString().split("T")[0];

        const orderId = await createOrder({
          tenantId: ctx.tenantId,
          serviceType: input.serviceType,
          pickupDate: input.pickupDate,
          pickupTimeWindow: input.pickupTimeWindow,
          deliveryDate,
          deliveryTimeWindow: input.pickupTimeWindow,
          address: input.address,
          unit: input.unit || null,
          specialInstructions: input.specialInstructions || null,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email || null,
          status: "new",
        });

        return { orderId };
      }),

    createSetupIntent: publicProcedure
      .input(
        z.object({
          orderId: z.number(),
          firstName: z.string(),
          lastName: z.string(),
          email: z.string().optional(),
          phone: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const stripe = getStripe();
        const customer = await stripe.customers.create({
          name: `${input.firstName} ${input.lastName}`,
          email: input.email || undefined,
          phone: input.phone,
          metadata: {
            orderId: input.orderId.toString(),
            source: "laundry-butler-website",
          },
        });

        const setupIntent = await stripe.setupIntents.create({
          customer: customer.id,
          payment_method_types: ["card"],
          metadata: { orderId: input.orderId.toString() },
        });

        await updateOrderStripe(input.orderId, customer.id, "");

        return {
          clientSecret: setupIntent.client_secret!,
          customerId: customer.id,
        };
      }),

    confirmCard: publicProcedure
      .input(
        z.object({
          orderId: z.number(),
          stripeCustomerId: z.string(),
          stripePaymentMethodId: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        await updateOrderStripe(
          input.orderId,
          input.stripeCustomerId,
          input.stripePaymentMethodId
        );

        try {
          const order = await getOrderById(input.orderId);
          if (order) {
            const serviceLabel = order.serviceType === "wash_fold" ? "Wash & Fold" : "Dry Cleaning";
            await notifyOwner({
              title: `New Pickup Order #${order.id}`,
              content: [
                `${order.firstName} ${order.lastName} just placed a ${serviceLabel} order.`,
                ``,
                `Pickup: ${order.pickupDate} | ${order.pickupTimeWindow}`,
                `Address: ${order.address}${order.unit ? `, ${order.unit}` : ""}`,
                `Phone: ${order.phone}${order.email ? ` | Email: ${order.email}` : ""}`,
                order.specialInstructions ? `Notes: ${order.specialInstructions}` : "",
              ].filter(Boolean).join("\n"),
            });
          }
        } catch (err) {
          console.warn("[Notification] Failed to notify owner:", err);
        }

        return { success: true };
      }),

    /**
     * HS256 JWT for app.bldg.chat welcome handoff (APP_SHARED_API_SECRET).
     * Claims: phone, firstName, lastName, orderId, buildingSlug, exp (15m).
     */
    generatePortalToken: publicProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input }) => {
        const order = await getOrderById(input.orderId);
        if (!order) throw new Error("Order not found");

        const buildingSlug =
          (order.buildingSlug && order.buildingSlug.trim()) ||
          matchBuilding(order.address)?.slug ||
          null;

        const payload = {
          phone: order.phone,
          firstName: order.firstName,
          lastName: order.lastName,
          orderId: order.id,
          buildingSlug,
          exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
        };

        const token = await new jose.SignJWT(payload)
          .setProtectedHeader({ alg: "HS256" })
          .sign(APP_SHARED_SECRET);

        return { token };
      }),
  }),

  /* ===== LEADS (public submission from Add Your Building form) ===== */
  leads: router({
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          building_name: z.string().min(1),
          role: z.string().optional(),
          email: z.string().email(),
          number_of_units: z.union([z.string(), z.number()]).optional(),
          phone: z.string().optional(),
          source: z.string().optional(),
          source_url: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const leadId = await createLead({
          name: input.name,
          buildingName: input.building_name,
          role: input.role || null,
          email: input.email,
          numberOfUnits: input.number_of_units?.toString() || null,
          phone: input.phone || null,
          source: input.source || "add_your_building_form",
          sourceUrl: input.source_url || null,
        });

        try {
          await notifyOwner({
            title: `New Building Lead: ${input.building_name}`,
            content: [
              `${input.name} submitted the "Add Your Building" form.`,
              ``,
              `Building: ${input.building_name}`,
              `Role: ${input.role || "—"}`,
              `Email: ${input.email}`,
              `Units: ${input.number_of_units || "—"}`,
              input.phone ? `Phone: ${input.phone}` : "",
            ].filter(Boolean).join("\n"),
          });
        } catch (err) {
          console.warn("[Notification] Failed to notify owner of new lead:", err);
        }

        return { success: true, id: leadId.toString() };
      }),
  }),

  /* ===== ADMIN ROUTES (protected — owner only) ===== */
  admin: router({
    /** List orders by status — platform or vendor (vendor gets scoped list) */
    listByStatus: platformOrVendorProcedure
      .input(z.object({ status: z.enum(["new", "intake-pending", "collected", "processing", "ready", "delivered"]) }))
      .query(async ({ ctx, input }) => {
        const vendorId = ctx.vendorSession?.vendorId;
        return getOrdersByStatus(input.status, vendorId);
      }),

    /** List orders by date + status — platform or vendor */
    listByDate: platformOrVendorProcedure
      .input(z.object({
        date: z.string(),
        status: z.enum(["new", "intake-pending", "collected", "processing", "ready", "delivered"]),
        dateField: z.enum(["pickupDate", "deliveryDate"]).default("pickupDate"),
      }))
      .query(async ({ ctx, input }) => {
        const vendorId = ctx.vendorSession?.vendorId;
        return getOrdersByDateAndStatus(input.date, input.status, input.dateField, vendorId);
      }),

    /** Get single order detail — vendor can only get own orders */
    getOrder: platformOrVendorProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const order = await getOrderById(input.id);
        if (!order) return null;
        if (ctx.vendorSession && order.vendorId !== ctx.vendorSession.vendorId) {
          return null; // vendor cannot see other vendor's orders
        }
        return order;
      }),

    /** Search orders by customer name or phone — platform only (find receipt) */
    searchOrdersForReceipt: protectedProcedure
      .input(z.object({ q: z.string().min(2).max(100) }))
      .query(async ({ input }) => searchOrdersForReceipt(input.q)),

    /** Home command center — paid revenue by `paidAt` in dashboard TZ (legacy rows without paidAt use `updatedAt`). */
    dashboardSummary: protectedProcedure.query(async () => {
      const row = await getAdminDashboardSummary();
      return row ?? {
        revenueTimestampBasis: "paidAt" as const,
        dashboardTimeZone: getDashboardTimeZone(),
        revenueToday: 0,
        revenueWeek: 0,
        revenueMonth: 0,
        paidOrderCountMonth: 0,
        avgOrderValueMonth: null,
        distinctBuildingsWithSlug: 0,
        distinctCustomerPhones: 0,
        totalOrders: 0,
      };
    }),

    /** Manual recovery actions logged today (attempted/delivered — not cash collection). */
    getActedOnToday: adminProcedure.query(async ({ ctx }) => {
      const r = await getActedOnTodayCents(ctx.tenantId);
      if (!r) {
        return {
          cents: 0,
          businessYmd: "",
          timeZone: getDashboardTimeZone(),
          dbAvailable: false,
        };
      }
      return {
        cents: r.cents,
        businessYmd: r.bounds.ymd,
        timeZone: r.bounds.timeZone,
        dbAvailable: true,
      };
    }),

    /** Unpaid intervention pipeline — sum of at-risk order totals plus optional manual adjustment. */
    getAwaitingPayment: adminProcedure.query(async ({ ctx }) => {
      const r = await getAwaitingPaymentCents(ctx.tenantId);
      if (!r) {
        return {
          cents: 0,
          pipelineCents: 0,
          adjustmentCents: 0,
          businessYmd: "",
          timeZone: getDashboardTimeZone(),
          dbAvailable: false,
        };
      }
      return {
        cents: r.cents,
        pipelineCents: r.pipelineCents,
        adjustmentCents: r.adjustmentCents,
        businessYmd: r.bounds.ymd,
        timeZone: r.bounds.timeZone,
        dbAvailable: true,
      };
    }),

    /** Manual adjustment to "Awaiting payment" (display = max(0, pipeline + adjustment)). */
    setAwaitingPaymentAdjustment: adminProcedure
      .input(z.object({ adjustmentCents: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const clamped = Math.max(-500_000_000, Math.min(500_000_000, input.adjustmentCents));
        try {
          await upsertAwaitingPaymentAdjustmentCents(ctx.tenantId, clamped);
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : "Failed to save adjustment",
          });
        }
        return { ok: true as const };
      }),

    /** Paid orders today — sums totals where `paidAt` falls in the business day (not action logs). */
    getCollectedToday: adminProcedure.query(async ({ ctx }) => {
      const r = await getCollectedTodayCents(ctx.tenantId);
      if (!r) {
        return {
          cents: 0,
          businessYmd: "",
          timeZone: getDashboardTimeZone(),
          dbAvailable: false,
          timestampBasis: "paidAt" as const,
        };
      }
      return {
        cents: r.cents,
        businessYmd: r.bounds.ymd,
        timeZone: r.bounds.timeZone,
        dbAvailable: true,
        timestampBasis: "paidAt" as const,
      };
    }),

    /**
     * Level 4 v1.6 gate — read-only, schema-free business truth.
     * Uses orders + admin_action_log only. Stale items surface as decay warnings
     * but do not block today's boss unlock.
     */
    getLevel4GateState: adminProcedure.query(async ({ ctx }) => {
      return loadLevel4GateState(ctx.tenantId);
    }),

    agent: router({
      listTools: adminProcedure.query(() => listAgentTools()),
      events: adminProcedure
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
        .query(async ({ ctx, input }) => getAgentEventTimeline(ctx.tenantId, input.limit)),
      aiUsageState: adminProcedure.query(async ({ ctx }) => getTenantAiLimitState(ctx.tenantId)),
      runTool: adminProcedure
        .input(z.object({
          toolName: z.string().min(1),
          input: z.unknown().default({}),
          agentType: z.enum([
            "resident_agent",
            "operator_voice_agent",
            "vendor_agent",
            "driver_agent",
            "gm_agent",
            "building_agent",
            "collections_agent",
          ]),
          actorType: z.enum(["human", "voice", "resident_chat", "driver", "vendor", "ai_agent", "system"]).default("human"),
          sessionId: z.string().optional(),
          conversationId: z.string().optional(),
          approvedByUserId: z.string().optional(),
          trustedUiFlow: z.boolean().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          return runAgentTool(input.toolName, input.input, {
            tenantId: ctx.tenantId,
            sessionId: input.sessionId ?? null,
            conversationId: input.conversationId ?? null,
            agentType: input.agentType as AgentType,
            actorType: input.actorType as ActorType,
            actorId: ctx.user?.id != null ? String(ctx.user.id) : null,
            approvedByUserId: input.approvedByUserId ?? null,
            trustedUiFlow: input.trustedUiFlow ?? false,
          });
        }),
      runOperatorVoiceCommand: adminProcedure
        .input(z.object({
          note: z.string().min(1),
          sessionId: z.string().optional(),
          conversationId: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          return runOperatorVoiceCommand(input.note, {
            tenantId: ctx.tenantId,
            sessionId: input.sessionId ?? null,
            conversationId: input.conversationId ?? null,
            agentType: "operator_voice_agent",
            actorType: "voice",
            actorId: ctx.user?.id != null ? String(ctx.user.id) : null,
            trustedUiFlow: true,
          });
        }),
    }),

    /** Static UI hints (env-backed); delivery truth remains on admin_action_log + webhooks. */
    revenueInterventionUiContext: adminProcedure.query(() => ({
      outboundReminderProviderConfigured: ENV.revenueReminderOutboundConfigured,
    })),

    /** Development-only: raw eligibility + log status for one order (NODE_ENV !== production). */
    getRevenueInterventionOrderDebug: adminProcedure
      .input(z.object({ orderId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (process.env.NODE_ENV === "production") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Revenue intervention debug is available in development only.",
          });
        }
        const r = await getRevenueInterventionOrderDebug(ctx.tenantId, input.orderId);
        if (r === null) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }
        if ("error" in r) {
          throw new TRPCError({
            code: r.error === "order_not_found" ? "NOT_FOUND" : "FORBIDDEN",
            message: r.error === "order_not_found" ? "Order not found" : "Order not in tenant",
          });
        }
        return r;
      }),

    /** Highest-scored at-risk order without send_reminder attempted/delivered today. */
    getLevel1ApexCommand: adminProcedure.query(async ({ ctx }) => {
      const r = await loadLevel1ApexCommand(ctx.tenantId);
      if (!r) {
        return {
          dbAvailable: false,
          candidate: null,
          businessYmd: "",
          timeZone: getDashboardTimeZone(),
        };
      }
      const { bounds, candidate } = r;
      if (!candidate) {
        return {
          dbAvailable: true,
          candidate: null,
          businessYmd: bounds.ymd,
          timeZone: bounds.timeZone,
        };
      }
      const o = candidate.order;
      return {
        dbAvailable: true,
        businessYmd: bounds.ymd,
        timeZone: bounds.timeZone,
        candidate: {
          issueLabel: candidate.issueLabel,
          score: candidate.score,
          dollarValueCents: candidate.dollarValueCents,
          order: {
            id: o.id,
            firstName: o.firstName,
            lastName: o.lastName,
            phone: o.phone,
            status: o.status,
            total: o.total,
            paid: o.paid,
            paidAt: o.paidAt,
            updatedAt: o.updatedAt,
            buildingSlug: o.buildingSlug,
            manualRiskFlag: o.manualRiskFlag,
          },
        },
      };
    }),

    /** Next 2–3 scored actions after Level 1 (same ordering); optional aggregate hint when one mutation type. */
    getLevel2TacticalCluster: adminProcedure.query(async ({ ctx }) => {
      const r = await loadLevel2TacticalCluster(ctx.tenantId);
      if (!r) {
        return {
          dbAvailable: false,
          businessYmd: "",
          timeZone: getDashboardTimeZone(),
          items: [] as const,
          aggregateMutationType: null as null,
        };
      }
      const { bounds, items, aggregateMutationType } = r;
      return {
        dbAvailable: true,
        businessYmd: bounds.ymd,
        timeZone: bounds.timeZone,
        aggregateMutationType,
        items: items.map((c) => {
          const o = c.order;
          return {
            issueLabel: c.issueLabel,
            score: c.score,
            dollarValueCents: c.dollarValueCents,
            mutationType: "send_reminder" as const,
            order: {
              id: o.id,
              firstName: o.firstName,
              lastName: o.lastName,
              phone: o.phone,
              status: o.status,
              total: o.total,
              paid: o.paid,
              paidAt: o.paidAt,
              updatedAt: o.updatedAt,
              buildingSlug: o.buildingSlug,
              manualRiskFlag: o.manualRiskFlag,
            },
          };
        }),
      };
    }),

    /** Level 4 Offensive Growth — read-only deterministic snapshot of the three offensive blocks (no scoring engine). */
    getLevel4OffensiveState: adminProcedure.query(async ({ ctx }) => {
      return loadLevel4OffensiveState(ctx.tenantId);
    }),

    /**
     * Level 4 Offensive Growth — LLM-generated outreach copy for a single block.
     * Block C (market_hole) returns a deterministic stub; no LLM call is made for it.
     * Caller passes the same per-block payload shape returned by getLevel4OffensiveState.
     */
    generateOffensiveCopy: adminProcedure
      .input(
        z.discriminatedUnion("block", [
          z.object({
            block: z.literal("building_penetration"),
            brand: z.enum(["default", "laundry_farm"]),
            payload: z.object({
              buildingSlug: z.string().min(1),
              buildingName: z.string().min(1),
              convertedUsers: z.number().int().min(0),
              convertedPaidUsers: z.number().int().min(0),
              total: z.number().int().min(0),
              unconverted: z.number().int().min(0),
              penetrationPct: z.number().min(0),
              paidPenetrationPct: z.number().min(0),
            }),
          }),
          z.object({
            block: z.literal("referral_request"),
            brand: z.enum(["default", "laundry_farm"]),
            payload: z.object({
              firstName: z.string().min(1),
              lastInitial: z.string().min(0).max(1),
              orderCount: z.number().int().min(0),
              ltvCents: z.number().int().min(0),
            }),
          }),
          z.object({
            block: z.literal("market_hole"),
            brand: z.enum(["default", "laundry_farm"]).optional(),
            payload: z.object({}).strict(),
          }),
        ])
      )
      .mutation(async ({ input }) => {
        try {
          return await generateLevel4OffensiveCopy(input as GenerateOffensiveCopyInput);
        } catch (e) {
          throwCatalogAiAsTrpc(e);
        }
      }),

    /**
     * Level 4 Offensive Growth — executes the admin's deploy click.
     * Writes one admin_action_log row of the canonical actionType for the block
     * and dedups per the per-block rules in server/level4OffensiveExecute.ts.
     * No outbound delivery in v1 — logging the decision retires the card.
     */
    executeOffensiveAction: adminProcedure
      .input(
        z.discriminatedUnion("block", [
          z.object({
            block: z.literal("building_penetration"),
            buildingSlug: z.string().min(1),
            buildingName: z.string().min(1),
            metadata: z
              .object({
                convertedUsers: z.number().int().min(0).optional(),
                convertedPaidUsers: z.number().int().min(0).optional(),
                total: z.number().int().min(0).optional(),
                unconverted: z.number().int().min(0).optional(),
                penetrationPct: z.number().min(0).optional(),
                paidPenetrationPct: z.number().min(0).optional(),
              })
              .optional(),
            generatedCopy: z.object({
              headline: z.string().min(1),
              body: z.string().min(1),
              primaryCopy: z.string().min(1),
              internalNote: z.string().min(1),
              deliverable: z.enum(["sms", "card"]),
              brandId: z.enum(["default", "laundry_farm"]),
            }),
          }),
          z.object({
            block: z.literal("referral_request"),
            userId: z.number().int().positive(),
            firstName: z.string().min(1),
            lastInitial: z.string().min(0).max(1),
            orderCount: z.number().int().min(0),
            ltvCents: z.number().int().min(0),
            generatedCopy: z.object({
              headline: z.string().min(1),
              body: z.string().min(1),
              primaryCopy: z.string().min(1),
              internalNote: z.string().min(1),
              deliverable: z.enum(["sms", "card"]),
              brandId: z.enum(["default", "laundry_farm"]),
            }),
          }),
          z.object({
            block: z.literal("market_hole_outreach"),
            note: z.string().optional(),
          }),
        ])
      )
      .mutation(async ({ ctx, input }) => {
        const out = await executeLevel4OffensiveAction(
          ctx.tenantId,
          input as ExecuteOffensiveInput
        );
        if (!out.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: out.error });
        }
        return {
          deduped: out.deduped,
          logId: out.logId,
          actionType: out.actionType,
        };
      }),

    /** Logs admin_action_log (send_reminder, status=attempted); idempotent per order per dashboard business day. */
    sendPaymentReminder: adminProcedure
      .input(z.object({ orderId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const out = await sendPaymentReminderForOrder({
          tenantId: ctx.tenantId,
          orderId: input.orderId,
        });
        if (!out.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: out.error });
        }
        return {
          deduped: out.deduped,
          logId: out.logId,
          logWriteSucceeded: out.logWriteSucceeded,
          logStatus: out.logStatus,
          outboundReminderAttempted: out.outboundReminderAttempted,
          outboundReminderDelivered: out.outboundReminderDelivered,
          paymentCollected: out.paymentCollected,
          actedOnTodayCents: out.actedOnTodayCents,
        };
      }),

    /** Search customer by phone — platform only (new order prefill) */
    searchCustomer: protectedProcedure
      .input(z.object({ phone: z.string().min(3) }))
      .query(async ({ input }) => {
        const order = await searchCustomerByPhone(input.phone);
        if (!order) return null;
        return {
          firstName: order.firstName,
          lastName: order.lastName,
          phone: order.phone,
          email: order.email,
          address: order.address,
          unit: order.unit,
          specialInstructions: order.specialInstructions,
          stripeCustomerId: order.stripeCustomerId,
          stripePaymentMethodId: order.stripePaymentMethodId,
        };
      }),

    /** Customer intelligence — all orders for exact phone (no Stripe fields in response) */
    getCustomerProfile: protectedProcedure
      .input(z.object({ phone: z.string().min(3).max(50) }))
      .query(async ({ input }) => {
        const phone = input.phone.trim();
        const rows = await getOrdersByPhoneExact(phone);
        return buildCustomerProfile(phone, rows);
      }),

    /** Directory of customers grouped by phone (loads all orders once; fine for typical LB volume) */
    listCustomers: protectedProcedure
      .input(
        z
          .object({
            search: z.string().max(120).optional(),
            sortBy: z.enum(["spend", "orders", "lastOrder"]).default("lastOrder"),
            status: z.enum(["new", "active", "warm", "cooling", "lapsed"]).optional(),
            tier: z.enum(["vip", "standard"]).optional(),
            buildingSlug: z.string().max(100).optional(),
            propertyGroup: z.enum(["opus_la", "century_park_east", "unknown"]).optional(),
            towerKey: z.string().max(100).optional(),
            includeLegacyCleanCloud: z.boolean().default(true),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const safeLower = (value: unknown): string =>
          typeof value === "string" ? value.toLowerCase() : "";

        const [aggregateRows, paidOrders] = await Promise.all([
          listAdminCustomerAggregates(),
          listPaidOrdersForBuildingRevenue(),
        ]);
        const includeLegacyCleanCloud = input?.includeLegacyCleanCloud ?? true;
        let rows: any[] = hydrateCustomerAggregates(aggregateRows).map((row) => {
          const tower = normalizePropertyTower(row.address);
          return {
            ...row,
            propertyGroup: tower.propertyGroup,
            propertyDisplayName: tower.propertyDisplayName,
            towerKey: tower.towerKey,
            towerDisplayName: tower.towerDisplayName,
            buildingAddressCanonical: tower.buildingAddressCanonical,
            stripeVerifiedRevenue: row.lifetimeSpend,
            legacyCleanCloudRevenue: 0,
            totalOperationalRevenue: row.lifetimeSpend,
            source: "stripe",
            paymentProcessor: "stripe",
            includedInStripe: true,
            includedInOperationalRevenue: true,
            stripePaymentIntentId: null,
          };
        });

        let abeDedupedOrLinked = false;
        if (includeLegacyCleanCloud) {
          for (const legacy of cleanCloudLegacyCustomers) {
            const legacyEmail = legacy.email?.trim().toLowerCase() || "";
            const legacyPhoneDigits = legacy.phone.replace(/\D/g, "");
            const existing = rows.find((row) => {
              const rowEmail = row.email?.trim().toLowerCase() || "";
              const rowPhoneDigits = row.phone.replace(/\D/g, "");
              return (
                (legacyEmail && rowEmail === legacyEmail) ||
                (legacyPhoneDigits.length >= 7 && rowPhoneDigits === legacyPhoneDigits)
              );
            });

            if (existing) {
              existing.legacyCleanCloudRevenue =
                Math.round((existing.legacyCleanCloudRevenue + legacy.totalSpend) * 100) / 100;
              existing.totalOperationalRevenue =
                Math.round((existing.stripeVerifiedRevenue + existing.legacyCleanCloudRevenue) * 100) / 100;
              existing.totalOrders += legacy.orderCount;
              existing.lifetimeSpend = existing.totalOperationalRevenue;
              existing.cleancloudCustomerId = legacy.cleancloudCustomerId;
              existing.source = "stripe_plus_cleancloud_legacy";
              existing.paymentProcessor = "stripe,cleancloud";
              existing.includedInStripe = true;
              existing.includedInOperationalRevenue = true;
              existing.legacyImportNote = legacy.legacyImportNote;
              existing.cleanCloudLegacyBadge = "LEGACY · CLEANCLOUD";
              existing.cleanCloudStripeStatus = "Not in Stripe";
              if (legacy.email === "abectunes@gmail.com" || legacy.phone === "5165871292") {
                abeDedupedOrLinked = true;
              }
              continue;
            }

            rows.push({
              phone: legacy.phone,
              firstName: legacy.firstName,
              lastName: legacy.lastName,
              email: legacy.email,
              unit: legacy.unit,
              buildingSlug:
                legacy.propertyGroup === "opus_la"
                  ? "opusla"
                  : legacy.propertyGroup === "century_park_east"
                    ? "centuryparkeast"
                    : null,
              floorNumber: deriveFloorNumber(legacy.unit),
              address: legacy.address,
              totalOrders: legacy.orderCount,
              lifetimeSpend: legacy.totalSpend,
              firstOrderAt: new Date(`${legacy.firstOrderDate}T12:00:00Z`),
              lastOrderAt: new Date(`${legacy.lastOrderDate}T12:00:00Z`),
              lastOrderId: 0,
              avgOrderValue: Math.round((legacy.totalSpend / legacy.orderCount) * 100) / 100,
              daysSinceLastOrder: 0,
              ordersLast30Days: 0,
              ordersLast90Days: 0,
              recencyStatus: "lapsed",
              tier: legacy.totalSpend >= 150 ? "vip" : "standard",
              statusColor: "muted",
              bldgUserIds: [],
              propertyGroup: legacy.propertyGroup,
              propertyDisplayName: legacy.propertyDisplayName,
              towerKey: legacy.towerKey,
              towerDisplayName: legacy.towerDisplayName,
              buildingAddressCanonical: legacy.buildingAddressCanonical,
              stripeVerifiedRevenue: 0,
              legacyCleanCloudRevenue: legacy.totalSpend,
              totalOperationalRevenue: legacy.totalSpend,
              source: legacy.source,
              paymentProcessor: legacy.paymentProcessor,
              includedInStripe: false,
              includedInOperationalRevenue: true,
              stripePaymentIntentId: null,
              cleancloudCustomerId: legacy.cleancloudCustomerId,
              legacyImportNote: legacy.legacyImportNote,
              cleanCloudLegacyBadge: "LEGACY · CLEANCLOUD",
              cleanCloudStripeStatus: "Not in Stripe",
              note: legacy.note,
            });
          }
        }
        const q = input?.search?.trim().toLowerCase();
        if (q) {
          rows = rows.filter(
            (r) =>
              safeLower(r.phone).includes(q) ||
              `${safeLower(r.firstName)} ${safeLower(r.lastName)}`.includes(q) ||
              safeLower(r.email).includes(q)
          );
        }
        if (input?.status) {
          rows = rows.filter((r) => r.recencyStatus === input.status);
        }
        if (input?.tier) {
          rows = rows.filter((r) => r.tier === input.tier);
        }
        if (input?.buildingSlug) {
          rows = rows.filter((r) => r.buildingSlug === input.buildingSlug);
        }
        if (input?.propertyGroup) {
          rows = rows.filter((r) => r.propertyGroup === input.propertyGroup);
        }
        if (input?.towerKey) {
          rows = rows.filter((r) => r.towerKey === input.towerKey);
        }
        const sortBy = input?.sortBy ?? "lastOrder";
        if (sortBy === "spend") {
          rows.sort((a, b) => b.lifetimeSpend - a.lifetimeSpend || b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
        } else if (sortBy === "orders") {
          rows.sort((a, b) => b.totalOrders - a.totalOrders || b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
        } else {
          rows.sort(
            (a, b) =>
              new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime()
          );
        }

        const buildingSummaryMap = new Map<
          string,
          {
            totalCustomers: number;
            activeCustomers: number;
            totalRevenue: number;
            floors: Record<number, { totalCustomers: number; activeCustomers: number; totalRevenue: number }>;
          }
        >();

        for (const row of rows) {
          const key = row.buildingSlug || "unknown";
          const existing = buildingSummaryMap.get(key) ?? {
            totalCustomers: 0,
            activeCustomers: 0,
            totalRevenue: 0,
            floors: {},
          };
          existing.totalCustomers += 1;
          if (row.recencyStatus === "active") existing.activeCustomers += 1;
          if (row.floorNumber != null) {
            const floor = row.floorNumber;
            const floorEntry = existing.floors[floor] ?? {
              totalCustomers: 0,
              activeCustomers: 0,
              totalRevenue: 0,
            };
            floorEntry.totalCustomers += 1;
            if (row.recencyStatus === "active") floorEntry.activeCustomers += 1;
            existing.floors[floor] = floorEntry;
          }
          buildingSummaryMap.set(key, existing);
        }

        for (const order of paidOrders) {
          const key = order.buildingSlug?.trim() || matchBuilding(order.address)?.slug || "unknown";
          const existing = buildingSummaryMap.get(key) ?? {
            totalCustomers: 0,
            activeCustomers: 0,
            totalRevenue: 0,
            floors: {},
          };
          const amount = parseFloat(String(order.total ?? "0"));
          const revenue = Number.isFinite(amount) ? amount : 0;
          existing.totalRevenue += revenue;
          const floor = deriveFloorNumber(order.unit);
          if (floor != null) {
            const floorEntry = existing.floors[floor] ?? {
              totalCustomers: 0,
              activeCustomers: 0,
              totalRevenue: 0,
            };
            floorEntry.totalRevenue += revenue;
            existing.floors[floor] = floorEntry;
          }
          buildingSummaryMap.set(key, existing);
        }

        const contestTotals = {
          stripeOnlyHelperText: "Stripe-only view excludes legacy CleanCloud orders.",
          legacyHelperText:
            "Legacy CleanCloud orders are included for operational history only. They are not Stripe transactions and will not appear in Stripe reports.",
          includeLegacyCleanCloud,
          abeDedupedOrLinked,
          grand: {
            stripeVerifiedRevenue: 0,
            legacyCleanCloudRevenue: 0,
            totalOperationalRevenue: 0,
          },
          properties: {
            opus_la: {
              propertyDisplayName: "OPUS LA",
              stripeVerifiedRevenue: 0,
              legacyCleanCloudRevenue: 0,
              totalOperationalRevenue: 0,
              towers: {
                opus_south_3545: { ...TOWER_DEFINITIONS.opus_south_3545, stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, totalOperationalRevenue: 0 },
                opus_north_3650: { ...TOWER_DEFINITIONS.opus_north_3650, stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, totalOperationalRevenue: 0 },
                unknown: { ...TOWER_DEFINITIONS.unknown, propertyGroup: "opus_la", propertyDisplayName: "OPUS LA", stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, totalOperationalRevenue: 0 },
              },
            },
            century_park_east: {
              propertyDisplayName: "Century Park East",
              stripeVerifiedRevenue: 0,
              legacyCleanCloudRevenue: 0,
              totalOperationalRevenue: 0,
              towers: {
                cpe_south_2170: { ...TOWER_DEFINITIONS.cpe_south_2170, stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, totalOperationalRevenue: 0 },
                cpe_north_2160: { ...TOWER_DEFINITIONS.cpe_north_2160, stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, totalOperationalRevenue: 0 },
              },
            },
          },
        };

        for (const row of rows) {
          if (row.propertyGroup !== "opus_la" && row.propertyGroup !== "century_park_east") continue;
          const prop = contestTotals.properties[row.propertyGroup];
          const stripe = Number(row.stripeVerifiedRevenue ?? 0);
          const legacy = includeLegacyCleanCloud ? Number(row.legacyCleanCloudRevenue ?? 0) : 0;
          const operational = stripe + legacy;
          prop.stripeVerifiedRevenue += stripe;
          prop.legacyCleanCloudRevenue += legacy;
          prop.totalOperationalRevenue += operational;
          contestTotals.grand.stripeVerifiedRevenue += stripe;
          contestTotals.grand.legacyCleanCloudRevenue += legacy;
          contestTotals.grand.totalOperationalRevenue += operational;
          const towers = prop.towers as Record<string, { stripeVerifiedRevenue: number; legacyCleanCloudRevenue: number; totalOperationalRevenue: number }>;
          const towerKey = row.towerKey in towers ? row.towerKey : "unknown";
          if (towers[towerKey]) {
            towers[towerKey].stripeVerifiedRevenue += stripe;
            towers[towerKey].legacyCleanCloudRevenue += legacy;
            towers[towerKey].totalOperationalRevenue += operational;
          }
        }

        const roundTotals = (obj: Record<string, unknown>) => {
          for (const key of ["stripeVerifiedRevenue", "legacyCleanCloudRevenue", "totalOperationalRevenue"]) {
            if (typeof obj[key] === "number") obj[key] = Math.round((obj[key] as number) * 100) / 100;
          }
        };
        roundTotals(contestTotals.grand);
        for (const prop of Object.values(contestTotals.properties)) {
          roundTotals(prop as unknown as Record<string, unknown>);
          for (const tower of Object.values(prop.towers)) roundTotals(tower as unknown as Record<string, unknown>);
        }

        const buildingSummary = Object.fromEntries(
          Array.from(buildingSummaryMap.entries()).map(([slug, val]) => [
            slug,
            {
              ...val,
              totalRevenue: Math.round(val.totalRevenue * 100) / 100,
              floors: Object.fromEntries(
                Object.entries(val.floors).map(([floor, data]) => [
                  floor,
                  {
                    ...data,
                    totalRevenue: Math.round(data.totalRevenue * 100) / 100,
                  },
                ])
              ),
            },
          ])
        );

        return { customers: rows, buildingSummary, contestTotals };
      }),

    /** Create order manually (admin new order tab) */
    createOrder: protectedProcedure
      .input(z.object({
        serviceType: z.enum(["wash_fold", "dry_cleaning"]),
        pickupDate: z.string(),
        pickupTimeWindow: z.string(),
        deliveryDate: z.string().optional(),
        deliveryTimeWindow: z.string().optional(),
        address: z.string(),
        unit: z.string().optional(),
        specialInstructions: z.string().optional(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().min(1),
        email: z.string().optional(),
        stripeCustomerId: z.string().optional(),
        stripePaymentMethodId: z.string().optional(),
        buildingSlug: z.string(),
        vendorId: z.number().optional(),
      }).refine(
        (d) => d.address.trim().length > 0 || d.buildingSlug.trim().length > 0,
        { message: "Either address or buildingSlug is required" }
      ))
      .mutation(async ({ input }) => {
        const pickupDateObj = new Date(input.pickupDate + "T00:00:00");
        pickupDateObj.setDate(pickupDateObj.getDate() + 1);
        const defaultDeliveryDate = pickupDateObj.toISOString().split("T")[0];

        // Resolve vendorId: explicit > Phase 2 routing > null
        let resolvedVendorId: number | null = input.vendorId ?? null;
        if (!resolvedVendorId && input.buildingSlug.trim()) {
          const vendor = await getVendorForOrder(
            input.buildingSlug.trim(),
            input.serviceType
          );
          resolvedVendorId = vendor?.id ?? null;
          if (vendor) {
            console.log(`[VendorRouting] assigned vendor #${vendor.id} (${vendor.name}) for building=${input.buildingSlug} service=${input.serviceType}`);
          } else {
            console.log(`[VendorRouting] no vendor found for building=${input.buildingSlug} service=${input.serviceType}`);
          }
        }

        const orderId = await createOrder({
          tenantId: "default",
          serviceType: input.serviceType,
          pickupDate: input.pickupDate,
          pickupTimeWindow: input.pickupTimeWindow,
          deliveryDate: input.deliveryDate || defaultDeliveryDate,
          deliveryTimeWindow: input.deliveryTimeWindow || input.pickupTimeWindow,
          address: input.address,
          unit: input.unit || null,
          specialInstructions: input.specialInstructions || null,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email || null,
          stripeCustomerId: input.stripeCustomerId || null,
          stripePaymentMethodId: input.stripePaymentMethodId || null,
          buildingSlug: input.buildingSlug,
          vendorId: resolvedVendorId,
          status: "new",
        });

        return { orderId };
      }),

    /** Update order status — platform or vendor (vendor scoped to own orders) */
    updateStatus: platformOrVendorProcedure
      .input(z.object({
        orderId: z.number(),
        status: z.enum(["new", "intake-pending", "collected", "processing", "ready", "delivered"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const order = await getOrderById(input.orderId);
        if (!order) throw new Error("Order not found");
        if (ctx.vendorSession && order.vendorId !== ctx.vendorSession.vendorId) {
          throw new Error("Unauthorized");
        }
        await updateOrderStatus(input.orderId, input.status);

        // SMS: Pickup en route when marking as collected
        if (input.status === "collected") {
          const order = await getOrderById(input.orderId);
          if (order) {
            try {
              await notifyPickupEnRoute(order.phone);
            } catch (err) {
              console.warn("[SMS] Failed to send pickup notification:", err);
            }
          }
        }

        return { success: true };
      }),

    /** Mark ready — platform or vendor (vendor scoped to own orders) */
    markReady: platformOrVendorProcedure
      .input(z.object({
        orderId: z.number(),
        bagCount: z.number().int().min(1).default(1),
        garmentCount: z.number().int().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const order = await getOrderById(input.orderId);
        if (!order) throw new Error("Order not found");
        if (ctx.vendorSession && order.vendorId !== ctx.vendorSession.vendorId) {
          throw new Error("Unauthorized");
        }
        await updateOrderIntake(input.orderId, {
          status: "ready",
          bagCount: input.bagCount,
          garmentCount: input.garmentCount ?? null,
        });

        // SMS: Delivery en route when marking as ready
        if (order) {
          try {
            await notifyDeliveryEnRoute(order.phone);
          } catch (err) {
            console.warn("[SMS] Failed to send delivery notification:", err);
          }
        }

        return { success: true };
      }),

    /** Save intake data — platform or vendor (chargeCard stays platform-only) */
    saveIntake: platformOrVendorProcedure
      .input(z.object({
        orderId: z.number(),
        weightLbs: z.number().optional(),
        subtotal: z.string(),
        discountPercent: z.string(),
        total: z.string(),
        upchargesJson: z.any().optional(),
        drycleanItemsJson: z.any().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const order = await getOrderById(input.orderId);
        if (!order) throw new Error("Order not found");
        if (ctx.vendorSession && order.vendorId !== ctx.vendorSession.vendorId) {
          throw new Error("Unauthorized");
        }
        await updateOrderIntake(input.orderId, {
          weightLbs: input.weightLbs?.toString() ?? null,
          subtotal: input.subtotal,
          discountPercent: input.discountPercent,
          total: input.total,
          upchargesJson: input.upchargesJson ?? null,
          drycleanItemsJson: input.drycleanItemsJson ?? null,
        });
        return { success: true };
      }),

    /** Charge card off-session */
    chargeCard: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        amountCents: z.number().int().min(50), // Stripe minimum $0.50
      }))
      .mutation(async ({ input }) => {
        const stripe = getStripe();
        const order = await getOrderById(input.orderId);
        if (!order) {
          throw new Error("Order not found");
        }

        let customerId = order.stripeCustomerId;
        let paymentMethodId = order.stripePaymentMethodId;

        // If we have customer ID but no payment method ID, retrieve default from Stripe
        if (customerId && !paymentMethodId) {
          try {
            const customer = await stripe.customers.retrieve(customerId);
            if ('invoice_settings' in customer && customer.invoice_settings?.default_payment_method) {
              paymentMethodId = customer.invoice_settings.default_payment_method as string;
              await updateOrderStripe(input.orderId, customerId, paymentMethodId);
            }
          } catch (err) {
            console.warn(`[Stripe] Failed to retrieve customer ${customerId}:`, err);
          }
        }

        // Fallback: look up card from another order with the same phone
        if (!customerId || !paymentMethodId) {
          const cardFromPhone = await findStripeCardByPhone(order.phone);
          if (cardFromPhone) {
            customerId = cardFromPhone.stripeCustomerId;
            paymentMethodId = cardFromPhone.stripePaymentMethodId;
            // Persist the Stripe IDs on this order so future lookups are instant
            await updateOrderStripe(input.orderId, customerId, paymentMethodId);
          }
        }

        if (!customerId || !paymentMethodId) {
          return {
            success: false,
            error: "No card on file for this customer. Collect payment manually.",
          };
        }

        try {
          // Resolve vendor for payout routing
          const vendor = order.vendorId ? await getVendorById(order.vendorId) : null;
          const vendorAccountId = vendor?.stripeConnectAccountId
            ?? process.env.STRIPE_CONNECT_VENDOR_ACCOUNT_ID
            ?? null;
          const payoutReady = !!vendorAccountId && vendor?.payoutsEnabled === true;

          let paymentIntent;
          let platformFeeCents: number | null = null;
          let vendorPayoutCents: number | null = null;

          if (payoutReady) {
            const feePercent = vendor?.platformFeePercent != null
              ? parseFloat(vendor.platformFeePercent as string)
              : ENV.platformFeePercent;
            platformFeeCents = Math.round(input.amountCents * feePercent / 100);
            vendorPayoutCents = input.amountCents - platformFeeCents;
            const useOnBehalfOf = process.env.STRIPE_CONNECT_ON_BEHALF_OF === "true";

            paymentIntent = await stripe.paymentIntents.create({
              customer: customerId,
              payment_method: paymentMethodId,
              amount: input.amountCents,
              currency: "usd",
              confirm: true,
              off_session: true,
              transfer_data: { destination: vendorAccountId! },
              application_fee_amount: platformFeeCents,
              ...(useOnBehalfOf ? { on_behalf_of: vendorAccountId! } : {}),
            });
            console.log(`[ChargeCard] Destination charge for vendor ${vendorAccountId}`);
            console.log(`[ChargeCard] Vendor payout: $${(vendorPayoutCents / 100).toFixed(2)}  Platform fee: $${(platformFeeCents / 100).toFixed(2)} (${feePercent}%)`);
          } else {
            paymentIntent = await stripe.paymentIntents.create({
              customer: customerId,
              payment_method: paymentMethodId,
              amount: input.amountCents,
              currency: "usd",
              confirm: true,
              off_session: true,
            });
            console.log(`[ChargeCard] No payout routing applied for order #${input.orderId}`);
          }

          // Generate receipt JWT for app.bldg.chat
          const jwtSigningSecret =
  process.env.JWT_SHARED_SECRET ||
  process.env.JWT_SECRET ||
  process.env.APP_SHARED_API_SECRET;

if (!jwtSigningSecret) {
  throw new Error("Missing JWT signing secret (JWT_SHARED_SECRET / JWT_SECRET / APP_SHARED_API_SECRET)");
}

const sharedSecret = new TextEncoder().encode(jwtSigningSecret);
          const vendorName = vendor?.name ?? (order.serviceType === "wash_fold" ? "Laundry Butler" : "Laundry Butler");
          const receiptToken = await new jose.SignJWT({
            orderId: input.orderId,
            customerId: customerId,
            totalWeight: order.weightLbs ? parseFloat(order.weightLbs) : 0,
            finalAmount: input.amountCents,
            currency: "usd",
            vendorName: vendorName,
          })
            .setProtectedHeader({ alg: "HS256" })
            .setExpirationTime("365d")
            .setIssuedAt()
            .sign(sharedSecret);

          const receiptUrl = `https://app.bldg.chat/receipt/${receiptToken}`;
          const hasPaidBefore = await hasCustomerPaidBefore(customerId!);

          const paidAt = new Date(paymentIntent.created * 1000);

          await updateOrderIntake(input.orderId, {
            paid: true,
            paidAt,
            stripePaymentIntentId: paymentIntent.id,
            status: "processing",
            isFirstPaidOrder: !hasPaidBefore,
            portalJwt: receiptUrl,
            ...(payoutReady ? {
              platformFeeCents,
              vendorPayoutCents,
              stripeConnectedAccountIdSnapshot: vendorAccountId,
              vendorNameSnapshot: vendor?.name ?? null,
              routingPrioritySnapshot: null,
            } : {}),
          });

          // Notify owner
          try {
            await notifyOwner({
              title: `Payment Received — Order #${order.id}`,
              content: `${order.firstName} ${order.lastName} charged $${centsToDollars(input.amountCents)} for ${order.serviceType === "wash_fold" ? "Wash & Fold" : "Dry Cleaning"}.`,
            });
          } catch (err) {
            console.warn("[Notification] Failed:", err);
          }

          // SMS: Card charged notification to customer
          try {
            await notifyCardCharged(order.phone, centsToDollars(input.amountCents));
          } catch (err) {
            console.warn("[SMS] Failed to send card charged notification:", err);
          }

          // Send receipt notification to app.bldg.chat via webhook
          if (order.bldgUserId) {
            try {
              console.log('[ChargeCard] Sending receipt webhook for user', order.bldgUserId);
              const webhookUrl = "https://app.bldg.chat/api/webhooks/receipt";
              const webhookSecret = process.env.APP_SHARED_API_SECRET || "";
              const webhookResponse = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": webhookSecret,
                },
                body: JSON.stringify({
                  bldgUserId: order.bldgUserId,
                  receiptUrl: receiptUrl,
                  orderId: order.id,
                }),
              });
              if (!webhookResponse.ok) {
                const errorText = await webhookResponse.text();
                console.warn('[ChargeCard] Webhook failed:', webhookResponse.status, errorText);
              } else {
                console.log('[ChargeCard] Receipt webhook sent successfully for user', order.bldgUserId);
              }
            } catch (err) {
              console.warn('[ChargeCard] Failed to send receipt webhook:', err);
            }
          }

          try {
            await writeOrderToSheet(order, input.amountCents);
            console.log('[Sheets] Revenue written successfully');
          } catch (err) {
            console.warn('[Sheets] Failed to write revenue:', err);
          }

          return {
            success: true,
            paymentIntentId: paymentIntent.id,
            isFirstPaidOrder: !hasPaidBefore,
            receiptUrl,
          };
        } catch (err: any) {
          console.error("[Stripe] Charge failed:", err.message);
          return {
            success: false,
            error: err.message || "Payment failed. Card may have been declined.",
          };
        }
      }),

    /**
     * Re-run Google Sheets revenue write for a paid order only.
     * Does not charge, notify, webhook, or update the database.
     */
    resendToSheets: adminProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input }) => {
        console.log(`[Sheets:Manual] Resending order #${input.orderId} to Sheets`);
        try {
          const order = await getOrderById(input.orderId);
          if (!order) {
            console.warn(`[Sheets:Manual] Failed: order #${input.orderId} — Order not found`);
            return { success: false as const, error: "Order not found" };
          }
          if (!order.paid) {
            console.warn(`[Sheets:Manual] Failed: order #${input.orderId} — Order not charged yet`);
            return { success: false as const, error: "Order not charged yet" };
          }
          const amountCents = Math.round(Number.parseFloat(String(order.total ?? "0")) * 100);
          if (!Number.isFinite(amountCents)) {
            console.warn(`[Sheets:Manual] Failed: order #${input.orderId} — Invalid charge total`);
            return { success: false as const, error: "Invalid charge total" };
          }
          const sheetResult = await writeOrderToSheet(order, amountCents);
          if (!sheetResult.ok) {
            console.warn(
              `[Sheets:Manual] Failed: order #${input.orderId} — ${sheetResult.reason}`,
            );
            return { success: false as const, error: sheetResult.reason };
          }
          console.log(
            `[Sheets:Manual] Success: order #${input.orderId} written to ${sheetResult.tabName}`,
          );
          return { success: true as const };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Sheets:Manual] Failed: order #${input.orderId} — ${msg}`);
          return { success: false as const, error: msg };
        }
      }),

    /** Delete order */
    deleteOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteOrder(input.orderId);
        return { success: true };
      }),

    /** Manually assign/reassign vendor on an order */
    updateOrderVendor: protectedProcedure
      .input(z.object({ orderId: z.number(), vendorId: z.number().nullable() }))
      .mutation(async ({ input }) => {
        await updateOrderVendor(input.orderId, input.vendorId);
        return { success: true };
      }),

    /* ===== COORDINATED REQUESTS (from resident app) ===== */

    listCoordinatedRequests: protectedProcedure.query(async () => {
      return listCoordinatedRequests();
    }),

    countNewCoordinatedRequests: protectedProcedure.query(async () => {
      return getNewCoordinatedRequestsCount();
    }),

    updateRequestStatus: protectedProcedure
      .input(z.object({ requestId: z.number(), status: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await updateServiceRequestStatus(input.requestId, input.status);
        return { success: true };
      }),

    /* ===== LEADS (Add Your Building form submissions) ===== */

    listLeads: protectedProcedure.query(async () => {
      return listLeads();
    }),

    getLead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getLeadById(input.id);
      }),

    countUnreadLeads: protectedProcedure.query(async () => {
      return getUnreadLeadsCount();
    }),

    updateLeadStatus: protectedProcedure
      .input(z.object({
        leadId: z.number(),
        status: z.enum(["New", "Contacted", "Qualified", "Closed", "Spam"]),
      }))
      .mutation(async ({ input }) => {
        await updateLeadStatus(input.leadId, input.status);
        return { success: true };
      }),

    markLeadAsRead: protectedProcedure
      .input(z.object({ leadId: z.number() }))
      .mutation(async ({ input }) => {
        await markLeadAsRead(input.leadId);
        return { success: true };
      }),

    markLeadAsUnread: protectedProcedure
      .input(z.object({ leadId: z.number() }))
      .mutation(async ({ input }) => {
        await markLeadAsUnread(input.leadId);
        return { success: true };
      }),

    updateLeadNotes: protectedProcedure
      .input(z.object({ leadId: z.number(), notes: z.string().nullable() }))
      .mutation(async ({ input }) => {
        await updateLeadNotes(input.leadId, input.notes);
        return { success: true };
      }),

    /* ===== VENDOR MANAGEMENT (Phase 1) ===== */

    createVendor: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.string().email().optional(),
        country: z.string().length(2).optional(),
        platformFeePercent: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await createVendor({
          name: input.name,
          email: input.email,
          country: input.country,
          platformFeePercent: input.platformFeePercent ?? null,
        });
        return getVendorById(id);
      }),

    listVendors: protectedProcedure
      .query(async () => {
        return listVendors();
      }),

    updateVendorActive: protectedProcedure
      .input(z.object({ vendorId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await updateVendorIsActive(input.vendorId, input.isActive);
        return { success: true };
      }),

    setVendorUserPassword: adminProcedure
      .input(z.object({
        vendorId: z.number(),
        email: z.string().email(),
        password: z.string().min(6),
      }))
      .mutation(async ({ input }) => {
        const hash = await import("bcryptjs").then(b => b.default.hash(input.password, 10));
        const existing = await getVendorUserByVendorIdAndEmail(input.vendorId, input.email);
        if (existing) {
          await updateVendorUserPassword(input.vendorId, input.email, hash);
        } else {
          await createVendorUser({
            vendorId: input.vendorId,
            email: input.email,
            passwordHash: hash,
          });
        }
        return { success: true };
      }),

    updateVendorBranding: adminProcedure
      .input(z.object({
        vendorId: z.number(),
        brandName: z.string().nullable().optional(),
        logoUrl: z.string().url().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateVendorBranding(input.vendorId, {
          brandName: input.brandName,
          logoUrl: input.logoUrl,
        });
        return { success: true };
      }),

    updateVendorSlug: adminProcedure
      .input(z.object({ vendorId: z.number(), slug: z.string().min(1).max(50) }))
      .mutation(async ({ input }) => {
        await updateVendorSlug(input.vendorId, input.slug.trim().toLowerCase());
        return { success: true };
      }),

    listVendorUsers: adminProcedure
      .input(z.object({ vendorId: z.number() }))
      .query(async ({ input }) => {
        return listVendorUsers(input.vendorId);
      }),

    createConnectAccount: protectedProcedure
      .input(z.object({ vendorId: z.number() }))
      .mutation(async ({ input }) => {
        const vendor = await getVendorById(input.vendorId);
        if (!vendor) throw new Error("Vendor not found");
        if (vendor.stripeConnectAccountId) throw new Error("Vendor already has a Connect account");

        const stripe = getStripe();
        const account = await stripe.accounts.create({
          type: "express",
          business_type: "company",
          country: vendor.country ?? "US",
          company: { name: vendor.name },
          email: vendor.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });

        await updateVendorConnectAccount(input.vendorId, account.id);
        console.log(`[Connect] Created Express account ${account.id} for vendor #${input.vendorId} (${vendor.name})`);
        return { accountId: account.id };
      }),

    createConnectOnboardingLink: protectedProcedure
      .input(z.object({ vendorId: z.number() }))
      .mutation(async ({ input }) => {
        const vendor = await getVendorById(input.vendorId);
        if (!vendor) throw new Error("Vendor not found");
        if (!vendor.stripeConnectAccountId) throw new Error("Vendor has no Connect account. Create one first.");

        const stripe = getStripe();
        const link = await stripe.accountLinks.create({
          account: vendor.stripeConnectAccountId,
          type: "account_onboarding",
          refresh_url: `${ENV.adminBaseUrl}/admin?tab=Vendors`,
          return_url: `${ENV.adminBaseUrl}/admin?tab=Vendors`,
          collection_options: { fields: "eventually_due" },
        });

        console.log(`[Connect] Generated fresh onboarding link for vendor #${input.vendorId}`);
        return { url: link.url };
      }),

    getConnectAccountStatus: protectedProcedure
      .input(z.object({ vendorId: z.number() }))
      .mutation(async ({ input }) => {
        const vendor = await getVendorById(input.vendorId);
        if (!vendor) throw new Error("Vendor not found");
        if (!vendor.stripeConnectAccountId) throw new Error("Vendor has no Connect account");

        const stripe = getStripe();
        const account = await stripe.accounts.retrieve(vendor.stripeConnectAccountId);

        const currentlyDue = account.requirements?.currently_due ?? [];
        const pastDue = account.requirements?.past_due ?? [];
        const disabledReason = account.requirements?.disabled_reason ?? null;

        await updateVendorConnectStatus(input.vendorId, {
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          currentlyDue: JSON.stringify(currentlyDue),
          pastDue: JSON.stringify(pastDue),
          disabledReason: disabledReason,
        });

        console.log(`[Connect] Refreshed status for vendor #${input.vendorId}: payoutsEnabled=${account.payouts_enabled}`);
        return {
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          currentlyDue,
          pastDue,
          disabledReason,
        };
      }),

    /* ===== VENDOR SERVICE COVERAGE (Phase 2) ===== */

    createVendorCoverage: protectedProcedure
      .input(z.object({
        vendorId: z.number(),
        buildingSlug: z.string().min(1),
        serviceType: z.enum(["wash_fold", "dry_cleaning"]),
        priority: z.number().int().default(10),
        isActive: z.boolean().default(true),
        isDefault: z.boolean().default(false),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await createVendorCoverage(input);
        return { id };
      }),

    updateVendorCoverage: protectedProcedure
      .input(z.object({
        coverageId: z.number(),
        priority: z.number().int().optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { coverageId, ...data } = input;
        await updateVendorCoverage(coverageId, data);
        return { success: true };
      }),

    deleteVendorCoverage: protectedProcedure
      .input(z.object({ coverageId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteVendorCoverage(input.coverageId);
        return { success: true };
      }),

    listVendorCoverage: protectedProcedure
      .input(z.object({ vendorId: z.number().optional() }))
      .query(async ({ input }) => {
        return listVendorCoverage(input.vendorId);
      }),

    /* ===== CATALOG (Revenue Control Surface) — platform admin, tenant-scoped by Host ===== */
    catalog: router({
      list: adminProcedure
        .input(z.object({ includeArchived: z.boolean().optional() }).optional())
        .query(async ({ ctx, input }) => {
          return listCatalogItemsForAdmin(ctx.tenantId, {
            includeArchived: input?.includeArchived ?? false,
          });
        }),

      create: adminProcedure
        .input(
          z.object({
            slug: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Slug: letters, numbers, hyphen, underscore"),
            name: z.string().min(1).max(255),
            category: z.string().min(1).max(100),
            serviceType: z
              .enum(["dry_clean", "wash_fold", "alteration", "other"])
              .optional(),
            standardPriceCents: z.number().int().min(0),
            expressPriceCents: z.number().int().min(0).nullable().optional(),
            costCents: z.number().int().min(0).nullable().optional(),
            isActive: z.boolean().optional(),
            isOnline: z.boolean().optional(),
            iconUrl: z.string().max(512).optional().nullable(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          try {
            const id = await createCatalogItemRow({
              tenantId: ctx.tenantId,
              slug: input.slug.trim().toLowerCase(),
              name: input.name.trim(),
              category: input.category.trim(),
              serviceType: input.serviceType,
              standardPriceCents: input.standardPriceCents,
              expressPriceCents: input.expressPriceCents ?? null,
              costCents: input.costCents ?? null,
              isActive: input.isActive,
              isOnline: input.isOnline,
              iconUrl:
                input.iconUrl && String(input.iconUrl).trim().length > 0
                  ? String(input.iconUrl).trim()
                  : null,
            });
            return { id };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("Duplicate") || msg.includes("duplicate") || msg.includes("uq_catalog")) {
              throw new TRPCError({ code: "CONFLICT", message: "Slug already exists for this tenant" });
            }
            throw e;
          }
        }),

      update: adminProcedure
        .input(
          z.object({
            id: z.number().int(),
            slug: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[a-z0-9][a-z0-9_-]*$/i)
              .optional(),
            name: z.string().min(1).max(255).optional(),
            category: z.string().min(1).max(100).optional(),
            serviceType: z.enum(["dry_clean", "wash_fold", "alteration", "other"]).optional(),
            standardPriceCents: z.number().int().min(0).optional(),
            expressPriceCents: z.number().int().min(0).nullable().optional(),
            costCents: z.number().int().min(0).nullable().optional(),
            isActive: z.boolean().optional(),
            isOnline: z.boolean().optional(),
            iconUrl: z.string().max(512).optional().nullable(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const { id, iconUrl, ...rest } = input;
          const patch: Parameters<typeof updateCatalogItemRow>[2] = {};
          if (rest.slug !== undefined) patch.slug = rest.slug.trim().toLowerCase();
          if (rest.name !== undefined) patch.name = rest.name.trim();
          if (rest.category !== undefined) patch.category = rest.category.trim();
          if (rest.serviceType !== undefined) patch.serviceType = rest.serviceType;
          if (rest.standardPriceCents !== undefined) patch.standardPriceCents = rest.standardPriceCents;
          if (rest.expressPriceCents !== undefined) patch.expressPriceCents = rest.expressPriceCents;
          if (rest.costCents !== undefined) patch.costCents = rest.costCents;
          if (rest.isActive !== undefined) patch.isActive = rest.isActive;
          if (rest.isOnline !== undefined) patch.isOnline = rest.isOnline;
          if (iconUrl !== undefined) {
            patch.iconUrl =
              iconUrl && String(iconUrl).trim().length > 0 ? String(iconUrl).trim() : null;
          }
          try {
            const ok = await updateCatalogItemRow(id, ctx.tenantId, patch);
            if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
            return { success: true as const };
          } catch (e: unknown) {
            if (e instanceof TRPCError) throw e;
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("Duplicate") || msg.includes("duplicate") || msg.includes("uq_catalog")) {
              throw new TRPCError({ code: "CONFLICT", message: "Slug already exists for this tenant" });
            }
            throw e;
          }
        }),

      archive: adminProcedure
        .input(z.object({ id: z.number().int() }))
        .mutation(async ({ ctx, input }) => {
          const ok = await archiveCatalogItemRow(input.id, ctx.tenantId);
          if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found or already archived" });
          return { success: true as const };
        }),

      reorder: adminProcedure
        .input(z.object({ orderedIds: z.array(z.number().int()) }))
        .mutation(async ({ ctx, input }) => {
          await reorderCatalogItemsForTenant(ctx.tenantId, input.orderedIds);
          return { success: true as const };
        }),

      parseMenuImport: adminProcedure
        .input(
          z.object({
            mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
            base64: z.string().max(9_000_000),
          })
        )
        .mutation(async ({ ctx, input }) => {
          try {
            const parsed = await parseMenuFileWithLLM({
              mimeType: input.mimeType,
              base64Data: input.base64,
            });
            const existing = await listCatalogItemsForAdmin(ctx.tenantId, { includeArchived: false });
            const bySlug = new Map(existing.map((r) => [r.slug, r]));
            const rows = parsed.map((it) => {
              const slug = slugifyCatalogName(it.name);
              const hit = bySlug.get(slug);
              const inferredCost =
                it.costCents != null ? it.costCents : Math.round(it.standardPriceCents / 2);
              return {
                name: it.name,
                category: it.category,
                serviceType: it.serviceType,
                standardPriceCents: it.standardPriceCents,
                expressPriceCents: it.expressPriceCents ?? null,
                costCents: inferredCost,
                pricingUnit: it.pricingUnit,
                slug,
                existingMatch: hit
                  ? { id: hit.id, slug: hit.slug, name: hit.name }
                  : null,
              };
            });
            return { rows };
          } catch (e: unknown) {
            throwCatalogAiAsTrpc(e);
          }
        }),

      confirmMenuImport: adminProcedure
        .input(
          z.object({
            rows: z.array(
              z.object({
                slug: z.string().min(1).max(128),
                name: z.string().min(1).max(255),
                category: z.string().min(1).max(100),
                serviceType: z.enum(["dry_clean", "wash_fold", "alteration", "other"]),
                standardPriceCents: z.number().int().min(0),
                expressPriceCents: z.number().int().min(0).nullable(),
                costCents: z.number().int().min(0).nullable(),
                isActive: z.boolean(),
                isOnline: z.boolean(),
                duplicateAction: z.enum(["skip", "update_existing", "create_new"]),
              })
            ),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const mapped = input.rows.map((r) => ({
            slug: r.slug.trim().toLowerCase(),
            name: r.name.trim(),
            category: r.category.trim(),
            serviceType: r.serviceType,
            standardPriceCents: r.standardPriceCents,
            expressPriceCents: r.expressPriceCents,
            costCents: r.costCents,
            isActive: r.isActive,
            isOnline: r.isOnline,
            duplicateAction: r.duplicateAction,
          }));
          return bulkApplyCatalogImport(ctx.tenantId, mapped);
        }),

      parseCommand: adminProcedure
        .input(z.object({ command: z.string().min(1).max(2000) }))
        .mutation(async ({ ctx, input }) => {
          try {
            const list = await listCatalogItemsForAdmin(ctx.tenantId, { includeArchived: false });
            const summary = list
              .map((r) => `${r.slug} | ${r.name} | ${r.standardPriceCents}`)
              .join("\n");
            const draft = await parseCatalogCommandWithLLM({
              command: input.command.trim(),
              existingCatalogSummary: summary.slice(0, 12_000),
            });
            return { draft };
          } catch (e: unknown) {
            throwCatalogAiAsTrpc(e);
          }
        }),

      applyCommand: adminProcedure
        .input(
          z.object({
            intent: z.enum(["create", "update_price", "archive", "toggle_online"]),
            slug: z.string().min(1).max(128).nullable().optional(),
            name: z.string().max(255).nullable().optional(),
            category: z.string().max(100).nullable().optional(),
            serviceType: z.enum(["dry_clean", "wash_fold", "alteration", "other"]).nullable().optional(),
            standardPriceCents: z.number().int().min(0).nullable().optional(),
            expressPriceCents: z.number().int().min(0).nullable().optional(),
            costCents: z.number().int().min(0).nullable().optional(),
            isOnline: z.boolean().nullable().optional(),
            notes: z.string().nullable().optional(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const tid = ctx.tenantId;

          if (input.intent === "create") {
            const name = input.name?.trim();
            const cat = normalizeCatalogCategory(input.category);
            if (!name || !cat) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Create requires name and category in the preview.",
              });
            }
            if (input.standardPriceCents == null) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Create requires standard price (cents) in the preview.",
              });
            }
            const baseSlug =
              input.slug?.trim().toLowerCase() || slugifyCatalogName(name);
            const slug = baseSlug.replace(/[^a-z0-9_-]/g, "_").slice(0, 128);
            if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Derived slug is invalid; edit name or slug in a follow-up command.",
              });
            }
            const exists = await getCatalogItemBySlugForTenant(slug, tid);
            if (exists) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `Slug "${slug}" already exists. Use update or a different name.`,
              });
            }
            const id = await createCatalogItemRow({
              tenantId: tid,
              slug,
              name,
              category: cat,
              serviceType: input.serviceType ?? "dry_clean",
              standardPriceCents: input.standardPriceCents,
              expressPriceCents: input.expressPriceCents ?? null,
              costCents: input.costCents ?? null,
              isActive: true,
              isOnline: input.isOnline ?? true,
              iconUrl: null,
            });
            return { ok: true as const, createdId: id };
          }

          if (input.intent === "update_price") {
            if (input.standardPriceCents == null) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "update_price requires standardPriceCents.",
              });
            }
            const row = await resolveActiveCatalogItemBySlugOrName(tid, input.slug, input.name);
            if (!row) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "No single matching catalog item for slug/name.",
              });
            }
            const patch: Parameters<typeof updateCatalogItemRow>[2] = {
              standardPriceCents: input.standardPriceCents,
            };
            if (input.expressPriceCents !== undefined) {
              patch.expressPriceCents = input.expressPriceCents;
            }
            if (input.costCents !== undefined) {
              patch.costCents = input.costCents;
            }
            const ok = await updateCatalogItemRow(row.id, tid, patch);
            if (!ok) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
            }
            return { ok: true as const, updatedId: row.id };
          }

          if (input.intent === "archive") {
            const row = await resolveActiveCatalogItemBySlugOrName(tid, input.slug, input.name);
            if (!row) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "No single matching catalog item for slug/name.",
              });
            }
            const ok = await archiveCatalogItemRow(row.id, tid);
            if (!ok) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Item not found or already archived" });
            }
            return { ok: true as const, archivedId: row.id };
          }

          if (input.intent === "toggle_online") {
            if (input.isOnline == null) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "toggle_online requires isOnline true or false.",
              });
            }
            const row = await resolveActiveCatalogItemBySlugOrName(tid, input.slug, input.name);
            if (!row) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "No single matching catalog item for slug/name.",
              });
            }
            const ok = await updateCatalogItemRow(row.id, tid, { isOnline: input.isOnline });
            if (!ok) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
            }
            return { ok: true as const, updatedId: row.id };
          }

          throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown intent" });
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
