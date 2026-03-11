if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}
import cors from "cors";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter, validateStripeEnv } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { VENDOR_COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { getVendorBySlug, getVendorUserByVendorIdAndEmail } from "../db";

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

  console.log("[Boot] v8 — REST endpoint for leads, bypasses tRPC/cors entirely");

  // Public form origins that can submit leads
  const PUBLIC_FORM_ORIGINS = [
    "https://buildings.bldg.chat",
    "https://contact.bldg.chat",
  ];

  // All allowed origins for the admin API
  const ADMIN_ALLOWED_ORIGINS = [
    "https://admin.bldg.chat",
    "https://driver.bldg.chat",
    ...PUBLIC_FORM_ORIGINS,
  ];

  // =============================================================================
  // PUBLIC LEADS SUBMISSION - REST endpoint with manual CORS (no middleware)
  // This MUST come before any other middleware to avoid conflicts
  // =============================================================================
  
  // OPTIONS preflight for /api/leads/submit
  app.options("/api/leads/submit", (req, res) => {
    const origin = req.headers.origin as string | undefined;
    console.log(`[Leads v8] OPTIONS preflight from origin: ${origin}`);
    
    if (origin && PUBLIC_FORM_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
      console.log(`[Leads v8] Preflight OK for ${origin}`);
      return res.status(204).end();
    }
    
    console.warn(`[Leads v8] Preflight BLOCKED for ${origin}`);
    return res.status(403).end();
  });

  // POST handler for /api/leads/submit - uses inline body parser
  app.post("/api/leads/submit", express.json(), async (req, res) => {
    const origin = req.headers.origin as string | undefined;
    console.log(`[Leads v8] POST from origin: ${origin}`);

    // Set CORS header for allowed origins
    if (origin && PUBLIC_FORM_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else if (origin) {
      console.warn(`[Leads v8] POST BLOCKED for ${origin}`);
      return res.status(403).json({ error: "Origin not allowed" });
    }

    try {
      const { createLead } = await import("../db");
      const { notifyOwner } = await import("./notification");
      const { name, building_name, role, email, number_of_units, phone, source, source_url } = req.body || {};

      // Validate required fields
      if (!name || !building_name || !email) {
        console.log(`[Leads v8] Validation failed: missing required fields`);
        return res.status(400).json({ error: "Missing required fields: name, building_name, email" });
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

      console.log(`[Leads v8] Lead created: id=${leadId}`);

      // Notify owner (non-blocking)
      try {
        await notifyOwner({
          title: `New Building Lead: ${building_name}`,
          content: [
            `${name} submitted the "Add Your Building" form.`,
            ``,
            `Building: ${building_name}`,
            `Role: ${role || "—"}`,
            `Email: ${email}`,
            `Units: ${number_of_units || "—"}`,
            phone ? `Phone: ${phone}` : "",
          ].filter(Boolean).join("\n"),
        });
      } catch (notifyErr) {
        console.warn("[Leads v8] Notification failed:", notifyErr);
      }

      return res.status(200).json({ success: true, id: leadId.toString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Leads v8] Error:`, err);
      return res.status(500).json({ error: "Internal server error", message: msg });
    }
  });

  // =============================================================================
  // STANDARD CORS for all other endpoints
  // =============================================================================
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ADMIN_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (origin.startsWith("https://") && origin.endsWith(".bldg.chat")) return callback(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
      console.warn(`[CORS v8] Blocked origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-trpc-source"],
  };
  
  // Apply cors middleware to all paths (leads REST endpoint is handled above, before this)
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

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

  // Intake API endpoint for bldg-chat integration (authenticated via shared secret)
  // Resident app must ONLY show "Laundry booked" when response is 200 + { ok: true, orderId }.
  app.post("/api/intake/from-bldg", async (req, res) => {
    const reqId = `intake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[Intake ${reqId}] POST /api/intake/from-bldg received`);

    const sharedSecret = req.headers["x-app-shared-secret"];
    if (!sharedSecret || sharedSecret !== process.env.APP_SHARED_API_SECRET) {
      console.log(`[Intake ${reqId}] Auth failed (401)`);
      return res.status(401).json({
        error: "Unauthorized",
        code: "ADMIN_INTAKE_FAILED",
        message: "Invalid or missing x-app-shared-secret",
      });
    }

    try {
      const { createOrder } = await import("../db");
      const {
        source,
        serviceType,
        firstName,
        lastName,
        phone,
        email,
        unit,
        address,
        pickupDate,
        pickupWindow,
        specialInstructions,
        stripeCustomerId,
        stripePaymentMethodId,
        bldgUserId,
        buildingSlug,
      } = req.body;

      // Validate required fields
      if (!serviceType || !firstName || !lastName || !phone || !address || !pickupDate || !pickupWindow) {
        console.log(`[Intake ${reqId}] Validation failed: missing required fields`);
        return res.status(400).json({
          error: "Missing required fields",
          code: "ADMIN_INTAKE_FAILED",
          message: "serviceType, firstName, lastName, phone, address, pickupDate, pickupWindow are required",
        });
      }

      // Normalize service type from "wash-fold" to "wash_fold"
      const normalizedServiceType = String(serviceType).replace("-", "_");
      if (normalizedServiceType !== "wash_fold" && normalizedServiceType !== "dry_cleaning") {
        console.log(`[Intake ${reqId}] Validation failed: invalid service type "${serviceType}"`);
        return res.status(400).json({
          error: "Invalid service type",
          code: "ADMIN_INTAKE_FAILED",
          message: "serviceType must be wash-fold or dry-cleaning",
        });
      }

      // Calculate default delivery date (next day) - guard against invalid dates
      const parts = String(pickupDate).split("-").map(Number);
      const year = parts[0],
        month = parts[1],
        day = parts[2];
      if (!year || !month || !day || isNaN(year) || isNaN(month) || isNaN(day)) {
        console.log(`[Intake ${reqId}] Validation failed: invalid pickupDate "${pickupDate}"`);
        return res.status(400).json({
          error: "Invalid pickup date",
          code: "ADMIN_INTAKE_FAILED",
          message: "pickupDate must be YYYY-MM-DD",
        });
      }
      const nextDay = new Date(year, month - 1, day + 1);
      if (isNaN(nextDay.getTime())) {
        console.log(`[Intake ${reqId}] Validation failed: invalid date from pickupDate "${pickupDate}"`);
        return res.status(400).json({
          error: "Invalid pickup date",
          code: "ADMIN_INTAKE_FAILED",
          message: "pickupDate could not be parsed",
        });
      }
      const defaultDeliveryDate =
        nextDay.getFullYear() +
        "-" +
        String(nextDay.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(nextDay.getDate()).padStart(2, "0");

      console.log(
        `[Intake ${reqId}] Creating order: ${firstName} ${lastName}, ${normalizedServiceType}, pickup ${pickupDate}`
      );

      const orderId = await createOrder({
        tenantId: "default",
        serviceType: normalizedServiceType,
        pickupDate,
        pickupTimeWindow: pickupWindow,
        deliveryDate: defaultDeliveryDate,
        deliveryTimeWindow: pickupWindow,
        address,
        unit: unit || null,
        specialInstructions: specialInstructions || null,
        firstName,
        lastName,
        phone,
        email: email || null,
        stripeCustomerId: stripeCustomerId || null,
        stripePaymentMethodId: stripePaymentMethodId || null,
        bldgUserId: bldgUserId || null,
        buildingSlug: buildingSlug || null,
        status: "new",
      });

      console.log(`[Intake ${reqId}] Order created: id=${orderId}`);
      res.status(200).json({ ok: true, orderId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Intake ${reqId}] Error:`, err);
      res.status(500).json({
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
