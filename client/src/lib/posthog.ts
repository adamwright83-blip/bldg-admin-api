import type { PostHog } from "posthog-js";
import { decidePosthogIdentity, type AnalyticsIdentity } from "./posthogIdentity";

const SECRET_PROPERTY = /password|authorization|cookie|secret|api[_-]?key|bearer/i;

let clientPromise: Promise<PostHog | null> | null = null;
let identifiedOpenId: string | null = null;
let identityGeneration = 0;

type RuntimePosthogConfig = {
  enabled?: boolean;
  key?: string | null;
  host?: string | null;
};

async function resolvePosthogConfig(): Promise<{ key: string; host: string } | null> {
  const buildKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
  const buildHost =
    import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  if (buildKey) return { key: buildKey, host: buildHost };

  try {
    const response = await fetch("/api/analytics-config", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const config = (await response.json()) as RuntimePosthogConfig;
    const key = config.key?.trim() || "";
    if (!config.enabled || !key) return null;
    return {
      key,
      host: config.host?.trim() || "https://us.i.posthog.com",
    };
  } catch {
    return null;
  }
}

function scrubProperties(properties: Record<string, unknown> | undefined): void {
  if (!properties) return;
  for (const key of Object.keys(properties)) {
    if (SECRET_PROPERTY.test(key)) delete properties[key];
  }
}

/**
 * One default PostHog client for the Vite app.
 * Wouter navigates with history.pushState / replaceState, which it patches,
 * and posthog-js `capture_pageview: "history_change"` listens to those methods.
 * Feature flags and experiments load with this client. This file does not create flags.
 * Returns null when the key is missing, in SSR, or in the visual-test bypass.
 */
export function initProductAnalytics(): Promise<PostHog | null> {
  if (clientPromise) return clientPromise;
  clientPromise = loadProductAnalytics();
  return clientPromise;
}

async function loadProductAnalytics(): Promise<PostHog | null> {
  if (typeof window === "undefined") return null;
  if (import.meta.env.DEV && import.meta.env.VITE_ADMIN_VISUAL_TEST === "1") return null;
  const config = await resolvePosthogConfig();
  if (!config) return null;
  const { key, host } = config;
  try {
    const { default: posthog } = await import("posthog-js");
    if (!posthog.__loaded) {
      posthog.init(key, {
        api_host: host.replace(/\/$/, ""),
        defaults: "2026-05-30",
        capture_pageview: "history_change",
        capture_pageleave: "if_capture_pageview",
        capture_exceptions: true,
        person_profiles: "identified_only",
        disable_session_recording: false,
        session_recording: {
          maskAllInputs: true,
          maskInputOptions: { password: true },
          recordHeaders: false,
          recordBody: false,
          streamNetworkBody: false,
        },
        before_send: event => {
          if (!event) return event;
          scrubProperties(event.properties as Record<string, unknown> | undefined);
          scrubProperties(event.$set as Record<string, unknown> | undefined);
          return event;
        },
      });
    }
    return posthog;
  } catch {
    return null;
  }
}

export function syncPosthogIdentity(input: {
  loading: boolean;
  visualTest: boolean;
  user: AnalyticsIdentity | null;
}): void {
  const decision = decidePosthogIdentity({ ...input, identifiedOpenId });
  if (decision.type === "noop") return;
  const generation = ++identityGeneration;
  void initProductAnalytics().then(client => {
    if (generation !== identityGeneration || !client) return;
    try {
      if (decision.type === "reset" || decision.type === "reset-then-identify") {
        client.reset();
        identifiedOpenId = null;
      }
      if (decision.type === "identify" || decision.type === "reset-then-identify") {
        client.identify(decision.openId, decision.properties);
        if (decision.tenantId) client.group("tenant", decision.tenantId);
        identifiedOpenId = decision.openId;
      }
    } catch {
      // Telemetry must not affect auth.
    }
  });
}

export function captureProductEvent(
  name: string,
  properties?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const safe = properties ? { ...properties } : undefined;
  scrubProperties(safe);
  void initProductAnalytics().then(client => {
    try {
      client?.capture(name, safe);
    } catch {
      // Telemetry must never block product flow.
    }
  });
}

export function recordClaireInteraction(properties?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const storageKey = "joystick_claire_interacted";
  const hasInteracted = window.localStorage.getItem(storageKey);
  if (!hasInteracted) {
    window.localStorage.setItem(storageKey, "true");
    captureProductEvent("first_claire_interaction", properties);
  }
  captureProductEvent("claire_interaction", properties);
}

export function captureClientException(
  error: unknown,
  properties?: Record<string, string>
): void {
  if (typeof window === "undefined") return;
  void initProductAnalytics().then(client => {
    try {
      client?.captureException(error, properties);
    } catch {
      // The existing fatal report still runs.
    }
  });
}

export function resetProductAnalyticsForTests(): void {
  clientPromise = null;
  identifiedOpenId = null;
  identityGeneration = 0;
}
