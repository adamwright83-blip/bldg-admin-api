import type cors from "cors";

export const PUBLIC_FORM_ORIGINS = [
  "https://buildings.bldg.chat",
  "https://contact.bldg.chat",
  "https://vendorsignup.bldg.chat",
];

export const ADMIN_ALLOWED_ORIGINS = [
  "https://admin.bldg.chat",
  "https://driver.bldg.chat",
  ...PUBLIC_FORM_ORIGINS,
];

export const ADMIN_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-trpc-source",
  "x-agent-shared-secret",
  "x-app-shared-secret",
];

export function isAllowedAdminOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (ADMIN_ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.startsWith("https://") && origin.endsWith(".bldg.chat")) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export function buildAdminCorsOptions(): cors.CorsOptions {
  return {
    origin: (origin, callback) => {
      if (isAllowedAdminOrigin(origin)) return callback(null, true);
      console.warn(`[CORS v8] Blocked origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ADMIN_ALLOWED_HEADERS,
  };
}
