import type { PostHog } from "posthog-js";
import type { FaqId } from "./content";

export type CtaSource = "hero" | "mission" | "sticky" | "pricing" | "final";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY?.trim();
const POSTHOG_HOST =
  import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";

let analyticsPromise: Promise<PostHog | null> | undefined;

export function getFlagshipAnalytics(): Promise<PostHog | null> {
  if (!POSTHOG_KEY || typeof window === "undefined") {
    return Promise.resolve(null);
  }

  analyticsPromise ??= import("posthog-js")
    .then(({ default: posthog }) =>
      posthog.init(
        POSTHOG_KEY,
        {
          api_host: POSTHOG_HOST,
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: false,
          capture_dead_clicks: false,
          capture_exceptions: false,
          capture_performance: false,
          disable_session_recording: true,
          disable_surveys: true,
          disable_product_tours: true,
          disable_conversations: true,
          person_profiles: "never",
        },
        "dayforgeflagship"
      )
    )
    .catch(() => null);

  return analyticsPromise;
}

export function trackCtaClick(source: CtaSource): void {
  void getFlagshipAnalytics().then(client => {
    client?.capture(
      "cta_click",
      { source },
      { send_instantly: true, transport: "sendBeacon" }
    );
  });
}

export function trackFaqOpen(questionId: FaqId): void {
  void getFlagshipAnalytics().then(client => {
    client?.capture("faq_open", { question_id: questionId });
  });
}
