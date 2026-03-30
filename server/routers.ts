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
  listCatalogItemsForAdmin,
  listActiveCatalogForPublic,
  createCatalogItemRow,
  updateCatalogItemRow,
  archiveCatalogItemRow,
  reorderCatalogItemsForTenant,
} from "./db";
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
      .input(z.object({ status: z.enum(["new", "collected", "processing", "ready", "delivered"]).optional() }))
      .query(async ({ ctx, input }) => {
        return getOrdersByVendorId(ctx.vendorSession.vendorId, input.status);
      }),
    listByStatus: vendorProcedure
      .input(z.object({ status: z.enum(["new", "collected", "processing", "ready", "delivered"]) }))
      .query(async ({ ctx, input }) => {
        return getOrdersByVendorId(ctx.vendorSession.vendorId, input.status);
      }),
    listByDate: vendorProcedure
      .input(z.object({
        date: z.string(),
        status: z.enum(["new", "collected", "processing", "ready", "delivered"]),
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
      .input(z.object({ status: z.enum(["new", "collected", "processing", "ready", "delivered"]) }))
      .query(async ({ ctx, input }) => {
        const vendorId = ctx.vendorSession?.vendorId;
        return getOrdersByStatus(input.status, vendorId);
      }),

    /** List orders by date + status — platform or vendor */
    listByDate: platformOrVendorProcedure
      .input(z.object({
        date: z.string(),
        status: z.enum(["new", "collected", "processing", "ready", "delivered"]),
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
        let rows = hydrateCustomerAggregates(aggregateRows);
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

        return { customers: rows, buildingSummary };
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
        status: z.enum(["new", "collected", "processing", "ready", "delivered"]),
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

          await updateOrderIntake(input.orderId, {
            paid: true,
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
            standardPriceCents: z.number().int().min(0),
            expressPriceCents: z.number().int().min(0).nullable().optional(),
            costCents: z.number().int().min(0),
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
              standardPriceCents: input.standardPriceCents,
              expressPriceCents: input.expressPriceCents ?? null,
              costCents: input.costCents,
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
            standardPriceCents: z.number().int().min(0).optional(),
            expressPriceCents: z.number().int().min(0).nullable().optional(),
            costCents: z.number().int().min(0).optional(),
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
    }),
  }),
});

export type AppRouter = typeof appRouter;
