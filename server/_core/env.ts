export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Anthropic (catalog AI). Forge is unused for invokeLLM. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
  platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT ?? "5"),
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? "https://admin.bldg.chat",
  /**
   * When true, outbound reminder infrastructure exists; UI still shows "attempted" until log status is
   * `delivered` (webhook-confirmed only). Does not imply messages are sent.
   */
  revenueReminderOutboundConfigured: process.env.REVENUE_REMINDER_OUTBOUND_CONFIGURED === "true",
};
