import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  createOrder,
  updateOrderStripe,
  getOrderById,
  getOrdersByStatus,
  getOrdersByDateAndStatus,
  updateOrderStatus,
  updateOrderIntake,
  searchCustomerByPhone,
  hasCustomerPaidBefore,
  findStripeCardByPhone,
  deleteOrder,
} from "./db";
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
      .mutation(async ({ input }) => {
        // Calculate default delivery date (pickup + 1 day)
        const pickupDateObj = new Date(input.pickupDate + "T00:00:00");
        pickupDateObj.setDate(pickupDateObj.getDate() + 1);
        const deliveryDate = pickupDateObj.toISOString().split("T")[0];

        const orderId = await createOrder({
          tenantId: "default",
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

    /** Generate JWT for app.bldg.chat portal handoff */
    generatePortalToken: publicProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input }) => {
        const order = await getOrderById(input.orderId);
        if (!order) throw new Error("Order not found");

        const payload = {
          phone: order.phone,
          firstName: order.firstName,
          orderId: order.id,
          buildingSlug: "opusla",
          exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
        };

        const token = await new jose.SignJWT(payload)
          .setProtectedHeader({ alg: "HS256" })
          .sign(APP_SHARED_SECRET);

        return { token };
      }),
  }),

  /* ===== ADMIN ROUTES (protected — owner only) ===== */
  admin: router({
    /** List orders by status */
    listByStatus: protectedProcedure
      .input(z.object({ status: z.enum(["new", "collected", "processing", "ready", "delivered"]) }))
      .query(async ({ input }) => {
        return getOrdersByStatus(input.status);
      }),

    /** List orders by date + status (for pickups/deliveries view) */
    listByDate: protectedProcedure
      .input(z.object({
        date: z.string(),
        status: z.enum(["new", "collected", "processing", "ready", "delivered"]),
        dateField: z.enum(["pickupDate", "deliveryDate"]).default("pickupDate"),
      }))
      .query(async ({ input }) => {
        return getOrdersByDateAndStatus(input.date, input.status, input.dateField);
      }),

    /** Get single order detail */
    getOrder: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getOrderById(input.id);
      }),

    /** Search customer by phone (for new order prefill) */
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

    /** Create order manually (admin new order tab) */
    createOrder: protectedProcedure
      .input(z.object({
        serviceType: z.enum(["wash_fold", "dry_cleaning"]),
        pickupDate: z.string(),
        pickupTimeWindow: z.string(),
        deliveryDate: z.string().optional(),
        deliveryTimeWindow: z.string().optional(),
        address: z.string().min(1),
        unit: z.string().optional(),
        specialInstructions: z.string().optional(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().min(1),
        email: z.string().optional(),
        stripeCustomerId: z.string().optional(),
        stripePaymentMethodId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const pickupDateObj = new Date(input.pickupDate + "T00:00:00");
        pickupDateObj.setDate(pickupDateObj.getDate() + 1);
        const defaultDeliveryDate = pickupDateObj.toISOString().split("T")[0];

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
          status: "new",
        });

        return { orderId };
      }),

    /** Update order status (generic) */
    updateStatus: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        status: z.enum(["new", "collected", "processing", "ready", "delivered"]),
      }))
      .mutation(async ({ input }) => {
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

    /** Mark ready — includes bag_count and garment_count */
    markReady: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        bagCount: z.number().int().min(1).default(1),
        garmentCount: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateOrderIntake(input.orderId, {
          status: "ready",
          bagCount: input.bagCount,
          garmentCount: input.garmentCount ?? null,
        });

        // SMS: Delivery en route when marking as ready
        const order = await getOrderById(input.orderId);
        if (order) {
          try {
            await notifyDeliveryEnRoute(order.phone);
          } catch (err) {
            console.warn("[SMS] Failed to send delivery notification:", err);
          }
        }

        return { success: true };
      }),

    /** Save intake data (pricing details before charge) */
    saveIntake: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        weightLbs: z.number().optional(),
        subtotal: z.string(),
        discountPercent: z.string(),
        total: z.string(),
        upchargesJson: z.any().optional(),
        drycleanItemsJson: z.any().optional(),
      }))
      .mutation(async ({ input }) => {
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
          const paymentIntent = await stripe.paymentIntents.create({
            customer: customerId,
            payment_method: paymentMethodId,
            amount: input.amountCents,
            currency: "usd",
            confirm: true,
            off_session: true,
          });

          // Generate receipt JWT for app.bldg.chat
          const jwtSigningSecret =
  process.env.JWT_SHARED_SECRET ||
  process.env.JWT_SECRET ||
  process.env.APP_SHARED_API_SECRET;

if (!jwtSigningSecret) {
  throw new Error("Missing JWT signing secret (JWT_SHARED_SECRET / JWT_SECRET / APP_SHARED_API_SECRET)");
}

const sharedSecret = new TextEncoder().encode(jwtSigningSecret);
          const VENDOR_MAP: Record<string, string> = {
            wash_fold: "Laundry Butler",
            dry_cleaning: "Laundry Butler",
          };
          const vendorName = VENDOR_MAP[order.serviceType] || null;
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

    /** Delete order */
    deleteOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteOrder(input.orderId);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
