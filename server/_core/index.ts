import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

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
  const app = express();
  const server = createServer(app);

  // CORS — must be first, before body parsers.
  // Allow any *.bldg.chat origin plus localhost ports for dev.
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server
      const ok =
        origin.endsWith(".bldg.chat") ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (ok) return callback(null, true);
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error(`CORS: blocked origin ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-trpc-source"],
  };
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
      await upsertUser({
        openId: ownerOpenId,
        name: "Admin",
        loginMethod: "password",
        lastSignedIn: new Date(),
      });

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
  app.post("/api/intake/from-bldg", async (req, res) => {
    const sharedSecret = req.headers["x-app-shared-secret"];

    if (!sharedSecret || sharedSecret !== process.env.APP_SHARED_API_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
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
      } = req.body;

      // Validate required fields
      if (!serviceType || !firstName || !lastName || !phone || !address || !pickupDate || !pickupWindow) {
        return res.status(400).json({ error: "Missing required fields" });
      }


      // Normalize service type from "wash-fold" to "wash_fold"
      const normalizedServiceType = serviceType.replace("-", "_");

      if (normalizedServiceType !== "wash_fold" && normalizedServiceType !== "dry_cleaning") {
        return res.status(400).json({ error: "Invalid service type" });
      }

      // Calculate default delivery date (next day) - avoid timezone issues
      const [year, month, day] = pickupDate.split("-").map(Number);
      const nextDay = new Date(year, month - 1, day + 1);
      const defaultDeliveryDate = nextDay.getFullYear() + "-" + String(nextDay.getMonth() + 1).padStart(2, "0") + "-" + String(nextDay.getDate()).padStart(2, "0");

      // Create order with status "scheduled" (same as admin-created orders)
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
        status: "new", // Same as admin form
      });

      res.json({ ok: true, orderId });
    } catch (err) {
      console.error("[Intake API] Error:", err);
      res.status(500).json({ error: "Internal server error" });
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
