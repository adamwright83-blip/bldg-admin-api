if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}
import cors from "cors";
import crypto from "crypto";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter, getStripe, validateStripeEnv } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { createOrder, upsertUser, getVendorForOrder } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { VENDOR_COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { getVendorBySlug, getVendorUserByVendorIdAndEmail } from "../db";
import { createAgentS2SRunToolHandler } from "../agents/s2sEndpoint";
import { runAgentTool } from "../agents/agentRuntime";
import { registerVendorOnboardingSessionRoutes } from "../vendorOnboardingSessionApi";
import { registerVendorBookingPublicRoutes } from "../vendorBookingPublicApi";
import { registerCleanCloudImportRoutes } from "../cleancloudImportRoute";
import { registerClearentImportRoutes } from "../clearentImportRoute";
import { registerPaymentReconciliationRoutes } from "../paymentReconciliationRoute";
import { registerLaundryFarmSheetSyncRoutes } from "../laundryFarmSheetSyncRoute";
import { PUBLIC_FORM_ORIGINS, buildAdminCorsOptions } from "./corsConfig";
import { z } from "zod";
import { buildBldgIntakeOrder } from "../residentIntake";
import {
  lookupVerifiedResidentCardByPhone,
  verifyStripePaymentMethodOwnership,
} from "../residentPaymentMethods";

const warnedUnknownTenantHosts = new Set<string>();
const vendorOnboardingRateLimit = new Map<string, { count: number; resetAt: number }>();

function rateLimitKey(req: express.Request, email?: string) {
  const ip = req.ip || req.socket.remoteAddress || "unknown-ip";
  return `${ip}:${email?.toLowerCase().trim() || "unknown-email"}`;
}

function isVendorOnboardingRateLimited(req: express.Request, email?: string, now = Date.now()) {
  const key = rateLimitKey(req, email);
  const existing = vendorOnboardingRateLimit.get(key);
  if (!existing || existing.resetAt <= now) {
    vendorOnboardingRateLimit.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  existing.count += 1;
  return existing.count > 5;
}

function hasValidAppSharedSecret(req: express.Request): boolean {
  const sharedSecret = req.headers["x-app-shared-secret"];
  const value = Array.isArray(sharedSecret) ? sharedSecret[0] : sharedSecret;
  return !!value && value === process.env.APP_SHARED_API_SECRET;
}

function createPublicSessionToken() {
  return `von_${crypto.randomBytes(24).toString("base64url")}`;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateStripeEnv();

  const app = express();
  const server = createServer(app);

  console.log("[Boot] v9 — REST endpoint for leads with robust error handling");

  // =============================================================================
  // PUBLIC LEADS SUBMISSION - REST endpoint with manual CORS (no middleware)
  // This MUST come before any other middleware to avoid conflicts
  // =============================================================================

  // Helper to set CORS headers
  const setLeadsCorsHeaders = (res: express.Response, origin: string) => {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  };

  // Health check for /api/leads/submit (GET)
  app.get("/api/leads/submit", (req, res) => {
    console.log("[Leads v9] GET health check");
    res.json({ status: "ok", endpoint: "/api/leads/submit", version: "v9" });
  });

  // OPTIONS preflight for /api/leads/submit
  app.options("/api/leads/submit", (req, res) => {
    const origin = req.headers.origin as string | undefined;
    console.log(`[Leads v9] OPTIONS from: ${origin}`);
    
    if (origin && PUBLIC_FORM_ORIGINS.includes(origin)) {
      setLeadsCorsHeaders(res, origin);
      res.setHeader("Access-Control-Max-Age", "86400");
      console.log(`[Leads v9] OPTIONS OK`);
      return res.status(204).end();
    }
    
    // For non-matching origins, still send CORS error with proper format
    console.warn(`[Leads v9] OPTIONS BLOCKED: ${origin}`);
    return res.status(403).json({ error: "Origin not allowed" });
  });

  // POST handler for /api/leads/submit
  app.post("/api/leads/submit", (req, res, next) => {
    // Manual body parsing with error handling
    let body = "";
    req.setEncoding("utf8");
    
    req.on("data", (chunk) => {
      body += chunk;
    });
    
    req.on("end", async () => {
      const origin = req.headers.origin as string | undefined;
      console.log(`[Leads v9] POST from: ${origin}, body length: ${body.length}`);

      // Set CORS header first, before any processing
      if (origin && PUBLIC_FORM_ORIGINS.includes(origin)) {
        setLeadsCorsHeaders(res, origin);
      } else if (origin) {
        console.warn(`[Leads v9] POST BLOCKED: ${origin}`);
        return res.status(403).json({ error: "Origin not allowed" });
      }

      // Parse JSON body
      let data: any;
      try {
        data = body ? JSON.parse(body) : {};
      } catch (parseErr) {
        console.error(`[Leads v9] JSON parse error:`, parseErr);
        return res.status(400).json({ error: "Invalid JSON body" });
      }

      console.log(`[Leads v9] Parsed data:`, JSON.stringify(data).slice(0, 200));

      try {
        const { createLead } = await import("../db");
        const { name, building_name, role, email, number_of_units, phone, source, source_url } = data;

        // Validate required fields
        if (!name || !building_name || !email) {
          console.log(`[Leads v9] Validation failed - name: ${!!name}, building: ${!!building_name}, email: ${!!email}`);
          return res.status(400).json({ 
            error: "Missing required fields", 
            required: ["name", "building_name", "email"],
            received: Object.keys(data)
          });
        }

        const leadId = await createLead({
          name,
          buildingName: building_name,
          role: role || null,
          email,
          numberOfUnits: number_of_units?.toString() || null,
          phone: phone || null,
          source: source || "add_your_building_form",
          sourceUrl: source_url || null,
        });

        console.log(`[Leads v9] SUCCESS - Lead created: id=${leadId}`);

        // Notify owner (non-blocking, don't await)
        import("./notification").then(({ notifyOwner }) => {
          notifyOwner({
            title: `New Building Lead: ${building_name}`,
            content: `${name} submitted the form.\nBuilding: ${building_name}\nEmail: ${email}`,
          }).catch(err => console.warn("[Leads v9] Notify failed:", err));
        });

        return res.status(200).json({ success: true, id: leadId.toString() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : "";
        console.error(`[Leads v9] DB Error:`, msg, stack);
        return res.status(500).json({ error: "Internal server error", message: msg });
      }
    });

    req.on("error", (err) => {
      console.error(`[Leads v9] Request error:`, err);
      res.status(500).json({ error: "Request processing error" });
    });
  });

  // =============================================================================
  // STANDARD CORS for all other endpoints
  // =============================================================================
  const corsOptions = buildAdminCorsOptions();
  
  // Apply cors middleware to all paths (leads REST endpoint is handled above, before this)
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  registerCleanCloudImportRoutes(app);
  registerClearentImportRoutes(app);
  registerPaymentReconciliationRoutes(app);
  registerLaundryFarmSheetSyncRoutes(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  app.post("/api/agent/s2s/run-tool", createAgentS2SRunToolHandler());
  registerVendorOnboardingSessionRoutes(app);
  registerVendorBookingPublicRoutes(app);

  const vendorOnboardingStartSchema = z.object({
    businessName: z.string().max(255).optional().nullable(),
    email: z.string().email().max(320),
    phone: z.string().max(30).optional().nullable(),
    websiteOrInstagram: z.string().url().max(512),
    vendorCategory: z.string().max(100).optional().nullable(),
    source: z.string().max(100).default("vendor_signup"),
  });

  app.post("/api/vendor-onboarding/start", async (req, res) => {
    const parsed = vendorOnboardingStartSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid vendor onboarding input",
        code: "VENDOR_ONBOARDING_BAD_REQUEST",
        issues: parsed.error.issues,
      });
    }

    const input = parsed.data;
    if (isVendorOnboardingRateLimited(req, input.email)) {
      return res.status(429).json({
        error: "Too many vendor onboarding attempts. Please try again later.",
        code: "VENDOR_ONBOARDING_RATE_LIMITED",
      });
    }

    const tenantId = resolveTenantIdFromHeaders(req.headers).tenantId;
    const sessionToken = createPublicSessionToken();
    const conversationId = `vendor_signup_${crypto.randomBytes(10).toString("base64url")}`;

    try {
      const output = await runAgentTool("createVendorOnboardingSessionTool", {
        businessName: input.businessName ?? undefined,
        email: input.email,
        phone: input.phone ?? null,
        sourceUrl: input.websiteOrInstagram,
        websiteOrInstagram: input.websiteOrInstagram,
        vendorCategory: input.vendorCategory ?? undefined,
        source: input.source,
        sessionId: sessionToken,
        conversationId,
      }, {
        tenantId,
        sessionId: sessionToken,
        conversationId,
        agentType: "vendor_agent",
        actorType: "system",
        actorId: "public_vendor_signup",
      });

      return res.status(200).json({
        sessionToken,
        onboardingUrl: `https://vendorsignup.bldg.chat/onboarding?session=${encodeURIComponent(sessionToken)}`,
        publicBookingSlug: (output as { publicBookingSlug?: string }).publicBookingSlug ?? null,
        status: "started",
        vendorOnboarding: output,
      });
    } catch (err) {
      console.error("[VendorOnboarding] start failed:", err);
      return res.status(500).json({
        error: "Vendor onboarding could not be started",
        code: "VENDOR_ONBOARDING_START_FAILED",
      });
    }
  });

  // Direct password login — bypasses OAuth portal entirely.
  // Set ADMIN_PASSWORD in Railway env. Falls back to APP_SHARED_API_SECRET.
  app.post("/api/auth/login", async (req, res) => {
    const { password } = req.body || {};
    const validPassword =
      process.env.ADMIN_PASSWORD || process.env.APP_SHARED_API_SECRET || "";

    if (!validPassword) {
      return res.status(503).json({ error: "ADMIN_PASSWORD not configured on server" });
    }
    if (!password || password !== validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    try {
      const ownerOpenId = process.env.OWNER_OPEN_ID || "admin-owner";

      // DB upsert is best-effort — schema mismatch or missing DB must not block login.
      try {
        await upsertUser({
          openId: ownerOpenId,
          name: "Admin",
          loginMethod: "password",
          lastSignedIn: new Date(),
        });
      } catch (dbErr) {
        console.warn("[Auth] upsertUser failed (non-fatal):", (dbErr as Error).message);
      }

      const sessionToken = await sdk.createSessionToken(ownerOpenId, {
        name: "Admin",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ ok: true });
    } catch (err) {
      console.error("[Auth] Login failed:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Vendor portal login — slug + email + password, vendor_users table
  app.post("/api/vendor/login", async (req, res) => {
    const { slug, email, password } = req.body || {};
    if (!slug || !email || !password) {
      return res.status(400).json({ error: "slug, email, and password are required" });
    }

    try {
      const vendor = await getVendorBySlug(String(slug).trim().toLowerCase());
      if (!vendor) {
        return res.status(401).json({ error: "Invalid vendor or password" });
      }
      if (!vendor.isActive) {
        return res.status(403).json({ error: "Vendor account is inactive" });
      }

      const vendorUser = await getVendorUserByVendorIdAndEmail(vendor.id, String(email));
      if (!vendorUser) {
        return res.status(401).json({ error: "Invalid vendor or password" });
      }

      const match = await bcrypt.compare(String(password), vendorUser.passwordHash);
      if (!match) {
        return res.status(401).json({ error: "Invalid vendor or password" });
      }

      const secret = new TextEncoder().encode(
        process.env.JWT_SECRET || process.env.APP_SHARED_API_SECRET || ""
      );
      if (!secret.length) {
        return res.status(503).json({ error: "JWT_SECRET not configured" });
      }

      const token = await new SignJWT({ vendorId: vendor.id })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("30d")
        .sign(secret);

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(VENDOR_COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: THIRTY_DAYS_MS,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[VendorAuth] Login failed:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Receipt API endpoint (authenticated via shared secret)
  app.get("/api/orders/:orderId/receipt", async (req, res) => {
    const { orderId } = req.params;
    const sharedSecret = req.headers["x-app-shared-secret"];

    if (!sharedSecret || sharedSecret !== process.env.APP_SHARED_API_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { getOrderById } = await import("../db");
      const orderIdNum = parseInt(orderId, 10);
      if (isNaN(orderIdNum)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }
      const order = await getOrderById(orderIdNum);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (!order.paid) {
        return res.status(403).json({ error: "Order not paid" });
      }

      // Return receipt data
      res.json({
        orderId: order.id,
        serviceType: order.serviceType,
        lineItems: order.upchargesJson || [],
        drycleanItems: order.drycleanItemsJson || [],
        subtotal: order.subtotal,
        discountPercent: order.discountPercent,
        total: order.total,
        paid: order.paid,
        status: order.status,
        address: order.address,
        unit: order.unit,
        pickupWindow: `${order.pickupDate} | ${order.pickupTimeWindow}`,
        deliveryWindow: order.deliveryDate && order.deliveryTimeWindow
          ? `${order.deliveryDate} | ${order.deliveryTimeWindow}`
          : null,
        createdAt: order.createdAt,
        phone: order.phone,
      });
    } catch (err) {
      console.error("[Receipt API] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Read-only customer identity export for resident backfill (shared secret; no payment fields)
  app.get("/api/export/customer-identities", async (req, res) => {
    const sharedSecret = req.headers["x-app-shared-secret"];
    if (!sharedSecret || sharedSecret !== process.env.APP_SHARED_API_SECRET) {
      return res.status(401).json({
        error: "Unauthorized",
        code: "EXPORT_UNAUTHORIZED",
        message: "Invalid or missing x-app-shared-secret",
      });
    }

    const rawDays = req.query.days;
    let since: Date | undefined;
    let daysRequested: number | undefined;
    if (rawDays !== undefined && rawDays !== "") {
      const s = Array.isArray(rawDays) ? rawDays[0] : rawDays;
      const lower = String(s).toLowerCase();
      if (lower !== "all") {
        const n = parseInt(String(s), 10);
        if (!Number.isFinite(n) || n < 1 || n > 3650) {
          return res.status(400).json({
            error: "Invalid days parameter",
            code: "EXPORT_BAD_REQUEST",
            message: "Use days=all, omit days for full export, or days=1..3650 (UTC window from now)",
          });
        }
        daysRequested = n;
        since = new Date();
        since.setUTCDate(since.getUTCDate() - n);
      }
    }

    try {
      const { listLatestCustomerIdentityForExport } = await import("../db");
      const customers = await listLatestCustomerIdentityForExport(
        since ? { since } : undefined
      );
      res.json({
        generatedAt: new Date().toISOString(),
        filter:
          since != null && daysRequested != null
            ? {
                mode: "since",
                days: daysRequested,
                since: since.toISOString(),
                note: "Orders with createdAt >= since (UTC)",
              }
            : { mode: "all" },
        count: customers.length,
        customers,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Export customer-identities]", err);
      res.status(500).json({
        error: "Internal server error",
        code: "EXPORT_FAILED",
        message: msg,
      });
    }
  });

  // Server-to-server saved card lookup for resident app.
  app.post("/api/resident/payment-method-lookup", async (req, res) => {
    if (!hasValidAppSharedSecret(req)) {
      return res.status(401).json({
        error: "Unauthorized",
        code: "PAYMENT_METHOD_LOOKUP_UNAUTHORIZED",
        message: "Invalid or missing x-app-shared-secret",
      });
    }

    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    if (!phone.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Missing phone",
        code: "PAYMENT_METHOD_LOOKUP_INVALID_REQUEST",
      });
    }

    try {
      const card = await lookupVerifiedResidentCardByPhone(getStripe(), phone);
      if (!card) {
        return res.status(200).json({ ok: true, found: false });
      }
      return res.status(200).json({
        ok: true,
        found: true,
        stripeCustomerId: card.stripeCustomerId,
        stripePaymentMethodId: card.stripePaymentMethodId,
        cardLast4: card.cardLast4,
        brand: card.brand,
        expMonth: card.expMonth,
        expYear: card.expYear,
      });
    } catch (err) {
      console.warn("[ResidentPaymentLookup] Stripe verification failed:", err);
      return res.status(200).json({ ok: true, found: false });
    }
  });

  // Intake API endpoint for bldg-chat integration (authenticated via shared secret)
  // Resident app must ONLY show "Laundry booked" when response is 200 + { ok: true, orderId }.
  app.post("/api/intake/from-bldg", async (req, res) => {
    const reqId = `intake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[Intake ${reqId}] POST /api/intake/from-bldg received`);

    if (!hasValidAppSharedSecret(req)) {
      console.log(`[Intake ${reqId}] Auth failed (401)`);
      return res.status(401).json({
        error: "Unauthorized",
        code: "ADMIN_INTAKE_FAILED",
        message: "Invalid or missing x-app-shared-secret",
      });
    }

    const tenantResolution = resolveTenantIdFromHeaders(
      req.headers as Record<string, string | string[] | undefined>
    );
    if (!tenantResolution.matched) {
      const unknownHost = tenantResolution.host || "(missing-host)";
      if (!warnedUnknownTenantHosts.has(unknownHost)) {
        warnedUnknownTenantHosts.add(unknownHost);
        console.warn(`[TenantResolver] Unknown host "${unknownHost}", falling back to default.`);
      }
    }

    let intake;
    try {
      intake = buildBldgIntakeOrder(req.body, tenantResolution.tenantId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[Intake ${reqId}] Validation failed: ${msg}`);
      return res.status(400).json({
        error: "Invalid intake request",
        code: "ADMIN_INTAKE_FAILED",
        message: msg,
      });
    }

    let paymentReady = false;
    const orderValues = { ...intake.order };
    if (intake.paymentInput.stripeCustomerId && intake.paymentInput.stripePaymentMethodId) {
      try {
        const verified = await verifyStripePaymentMethodOwnership(
          getStripe(),
          intake.paymentInput.stripeCustomerId,
          intake.paymentInput.stripePaymentMethodId
        );
        if (verified) {
          orderValues.stripeCustomerId = verified.stripeCustomerId;
          orderValues.stripePaymentMethodId = verified.stripePaymentMethodId;
          paymentReady = true;
        } else {
          orderValues.stripeCustomerId = null;
          orderValues.stripePaymentMethodId = null;
        }
      } catch (err) {
        console.warn(`[Intake ${reqId}] Stripe IDs were not verified; storing order without card refs.`, err);
        orderValues.stripeCustomerId = null;
        orderValues.stripePaymentMethodId = null;
      }
    } else {
      orderValues.stripeCustomerId = null;
      orderValues.stripePaymentMethodId = null;
    }

    // Route the order to the building's vendor (mirrors the admin order-create
    // routing). Without this, resident orders have vendorId=null and never show
    // in the vendor-scoped driver feed even when status is "new".
    const routeSlug = (orderValues as { buildingSlug?: string | null })
      .buildingSlug;
    if (routeSlug) {
      try {
        const vendor = await getVendorForOrder(
          routeSlug,
          orderValues.serviceType
        );
        if (vendor) {
          (orderValues as { vendorId?: number | null }).vendorId = vendor.id;
          console.log(
            `[Intake ${reqId}] Routed to vendor #${vendor.id} (${vendor.name})`
          );
        } else {
          console.log(
            `[Intake ${reqId}] No vendor routed for building=${routeSlug} service=${orderValues.serviceType}`
          );
        }
      } catch (e) {
        console.warn(`[Intake ${reqId}] Vendor routing failed:`, e);
      }
    }

    try {
      console.log(
        `[Intake ${reqId}] Creating order: ${orderValues.firstName} ${orderValues.lastName}, ${orderValues.serviceType}, status ${orderValues.status}`
      );
      const orderId = await createOrder(orderValues);
      console.log(`[Intake ${reqId}] Order created: id=${orderId}`);
      return res.status(200).json({
        ok: true,
        orderId,
        status: intake.status,
        needsReview: intake.needsReview,
        needsReviewReason: intake.needsReviewReason,
        paymentReady,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Intake ${reqId}] Error:`, err);
      return res.status(500).json({
        error: "Internal server error",
        code: "ADMIN_INTAKE_FAILED",
        message: msg,
      });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
