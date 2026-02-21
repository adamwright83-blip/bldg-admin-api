import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const buildEndpointUrl = (baseUrl: string): string => {
  const normalizedBase = baseUrl.endsWith("/")
    ? baseUrl
    : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required.",
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required.",
    });
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);

  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
  }

  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    });
  }

  return { title, content };
};

/**
 * Dispatches a project-owner notification through the Manus Notification Service.
 * Returns `true` if the request was accepted, `false` when the upstream service
 * cannot be reached (callers can fall back to email/slack). Validation errors
 * bubble up as TRPC errors so callers can fix the payload.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured.",
    });
  }

  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured.",
    });
  }

  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  const requestPayload = { title, content };

  // Retry logic: attempt once, retry after 2 second delay on failure
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `[OwnerAlert] Sending alert (attempt ${attempt}/${maxAttempts}):`,
        JSON.stringify(requestPayload)
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${ENV.forgeApiKey}`,
          "content-type": "application/json",
          "connect-protocol-version": "1",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const errorMsg = `[Notification] Failed to notify owner (${response.status} ${response.statusText})${
          detail ? `: ${detail}` : ""
        }`;
        console.warn(errorMsg);
        lastError = new Error(errorMsg);

        // Retry on failure (except on last attempt)
        if (attempt < maxAttempts) {
          console.log("[OwnerAlert] Retrying after 2 second delay...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        return false;
      }

      console.log("[OwnerAlert] Alert sent successfully");
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn("[Notification] Error calling notification service:", lastError);

      // Retry on failure (except on last attempt)
      if (attempt < maxAttempts) {
        console.log("[OwnerAlert] Retrying after 2 second delay...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
    }
  }

  // All attempts failed
  console.error(
    "[OwnerAlert] Alert failed after retry:",
    lastError?.message || "Unknown error"
  );
  return false;
}
