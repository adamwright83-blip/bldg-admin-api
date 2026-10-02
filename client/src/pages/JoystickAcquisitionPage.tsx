/* LEGACY DAYFORGE COMPATIBILITY: retained route literals only; canonical product is JOYSTICK. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { captureProductEvent } from "@/lib/posthog";
import {
  JOYSTICK_PREPAY_QUESTION_KEYS,
  ONBOARDING_QUESTION_KEYS,
  ONBOARDING_QUESTIONS,
  type GoldlineOnboardingQuestionKey,
} from "@shared/goldlineOnboarding";
import type {
  JoystickDraftAnswerMap,
  JoystickDraftPreview,
} from "@shared/joystickAcquisition";
import "./joystick-acquisition.css";

type Credentials = { sessionId: string; resumeToken: string };
const SESSION_KEY = "joystick_acquisition_credentials";

function readCredentials(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Credentials;
    return parsed.sessionId && parsed.resumeToken ? parsed : null;
  } catch {
    return null;
  }
}

function questionText(key: GoldlineOnboardingQuestionKey): string {
  const index = ONBOARDING_QUESTION_KEYS.indexOf(key);
  return index >= 0 ? ONBOARDING_QUESTIONS[index] : "";
}

function requestId(): string {
  return crypto.randomUUID();
}

function apiBase(): string {
  if (
    typeof window !== "undefined" &&
    window.location.hostname.toLowerCase() === "admin.bldg.chat"
  ) {
    return "";
  }
  return import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
}

export default function JoystickAcquisitionPage() {
  const [credentials, setCredentials] = useState<Credentials | null>(() => readCredentials());
  const [answer, setAnswer] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const checkoutSucceeded = useMemo(
    () => new URLSearchParams(window.location.search).get("checkout") === "success",
    []
  );

  const start = trpc.system.saas.startJoystickDraft.useMutation();
  const resume = trpc.system.saas.resume.useQuery(credentials!, {
    enabled: Boolean(credentials),
    retry: false,
    refetchInterval: checkoutSucceeded ? 2_000 : false,
  });
  const saveAnswer = trpc.system.saas.saveJoystickDraftAnswer.useMutation();
  const generatePreview = trpc.system.saas.generateJoystickDraftPreview.useMutation();
  const saveIdentity = trpc.system.saas.saveJoystickIdentity.useMutation();
  const plans = trpc.system.saas.plans.useQuery();
  const checkout = trpc.system.saas.checkout.useMutation();
  const activate = trpc.system.saas.activateOwner.useMutation();

  useEffect(() => {
    if (credentials || started.current) return;
    started.current = true;
    captureProductEvent("onboarding_draft_started", { source: "joystick_landing" });
    start.mutate(
      { requestId: requestId() },
      {
        onSuccess: result => {
          if (!result?.onboarding || !result.resumeToken) {
            setError("Could not establish a resumable JOYSTICK setup.");
            return;
          }
          const next = {
            sessionId: result.onboarding.id,
            resumeToken: result.resumeToken,
          };
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
          setCredentials(next);
        },
        onError: cause => setError(cause.message),
      }
    );
  }, [credentials, start]);

  useEffect(() => {
    const data = resume.data;
    if (!data) return;
    setBusinessName(value => value || data.businessName || "");
    setOwnerEmail(value => value || data.ownerEmail || "");
    const configuration = data.configuration as { contactName?: string } | null;
    setContactName(value => value || configuration?.contactName || "");
  }, [resume.data]);

  const data = resume.data;
  const answers = (data?.draftAnswers ?? {}) as JoystickDraftAnswerMap;
  const preview = (data?.draftPreview ?? null) as JoystickDraftPreview | null;
  const nextQuestion = JOYSTICK_PREPAY_QUESTION_KEYS.find(key => !answers[key]?.trim()) ?? null;
  const busy =
    start.isPending ||
    saveAnswer.isPending ||
    generatePreview.isPending ||
    saveIdentity.isPending ||
    checkout.isPending ||
    activate.isPending;

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!credentials || !data || !nextQuestion || !answer.trim()) return;
    setError(null);
    try {
      await saveAnswer.mutateAsync({
        ...credentials,
        expectedVersion: data.version,
        questionKey: nextQuestion,
        answer,
      });
      captureProductEvent("onboarding_question_answered", {
        question_id: nextQuestion,
        funnel_step: "prepay",
      });
      setAnswer("");
      await resume.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answer.");
    }
  }

  async function buildPreview() {
    if (!credentials || !data) return;
    setError(null);
    try {
      await generatePreview.mutateAsync({
        ...credentials,
        expectedVersion: data.version,
      });
      captureProductEvent("onboarding_preview_generated", { funnel_step: "prepay" });
      captureProductEvent("onboarding_preview_viewed", { funnel_step: "prepay" });
      await resume.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not build your preview.");
    }
  }

  async function submitIdentity(event: FormEvent) {
    event.preventDefault();
    if (!credentials || !data) return;
    setError(null);
    captureProductEvent("onboarding_identity_started", { funnel_step: "prepay" });
    try {
      await saveIdentity.mutateAsync({
        ...credentials,
        expectedVersion: data.version,
        businessName,
        contactName,
        ownerEmail,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      captureProductEvent("onboarding_identity_completed", { funnel_step: "prepay" });
      await resume.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save account identity.");
    }
  }

  async function beginCheckout() {
    if (!credentials) return;
    const plan = plans.data?.[0];
    if (!plan) {
      setError("JOYSTICK billing is not configured yet. Your preview is saved.");
      return;
    }
    setError(null);
    try {
      captureProductEvent("onboarding_checkout_started", { plan_key: plan.planKey });
      const result = await checkout.mutateAsync({
        ...credentials,
        planKey: plan.planKey,
        requestId: requestId(),
      });
      if (!result.url) throw new Error("Stripe did not return a checkout URL.");
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not continue to checkout.");
    }
  }

  async function activateAndEnter(event: FormEvent) {
    event.preventDefault();
    if (!credentials || !data || !ownerEmail || !password) return;
    setError(null);
    try {
      await activate.mutateAsync({
        ...credentials,
        name: contactName,
        password,
      });
      captureProductEvent("onboarding_owner_activated", { funnel_step: "post_checkout" });
      const response = await fetch(`${apiBase()}/api/dayforge/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ownerEmail, password }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Account activated, but sign-in failed.");
      }
      sessionStorage.removeItem(SESSION_KEY);
      captureProductEvent("joystick_first_entry", { destination: "/onboarding" });
      window.location.assign("/onboarding");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not activate your workspace.");
    }
  }

  if (!credentials || resume.isLoading) {
    return (
      <main className="ja-shell">
        <section className="ja-card ja-center">
          <p className="ja-kicker">JOYSTICK</p>
          <h1>Building your starting point…</h1>
        </section>
      </main>
    );
  }

  if (resume.isError) {
    return (
      <main className="ja-shell">
        <section className="ja-card ja-center">
          <p className="ja-error">{resume.error.message}</p>
          <a href="/joystick">Return to JOYSTICK</a>
        </section>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="ja-shell">
      <section className="ja-card">
        <header className="ja-header">
          <span>JOYSTICK</span>
          <small>YOUR BUSINESS. PLAYABLE.</small>
        </header>

        {error ? <p className="ja-error" role="alert">{error}</p> : null}

        {checkoutSucceeded && data.status === "checkout_pending" ? (
          <div className="ja-center">
            <p className="ja-kicker">PAYMENT RECEIVED</p>
            <h1>Building your workspace.</h1>
            <p>Stripe is confirmed. JOYSTICK is waiting for the signed subscription event before creating your business workspace.</p>
          </div>
        ) : data.status === "provisioned" || data.status === "configuring" ? (
          <form className="ja-form" onSubmit={activateAndEnter}>
            <p className="ja-kicker">ONE LAST LOCK</p>
            <h1>Create your password.</h1>
            <p>Your paid workspace exists. This password activates the owner account.</p>
            <label>
              Password
              <input
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="ja-primary" disabled={busy || password.length < 12}>
              ENTER JOYSTICK
            </button>
          </form>
        ) : data.status === "complete" ? (
          <div className="ja-center">
            <p className="ja-kicker">READY</p>
            <h1>Your world is waiting.</h1>
            <a className="ja-primary ja-link-button" href="/dayforge-login?returnTo=/onboarding">
              SIGN IN
            </a>
          </div>
        ) : nextQuestion ? (
          <form className="ja-form" onSubmit={submitAnswer}>
            <p className="ja-kicker">
              {JOYSTICK_PREPAY_QUESTION_KEYS.indexOf(nextQuestion) + 1} OF 3
            </p>
            <h1>{questionText(nextQuestion)}</h1>
            <textarea
              autoFocus
              maxLength={2000}
              value={answer}
              onChange={event => setAnswer(event.target.value)}
              placeholder={
                nextQuestion === "daily_work"
                  ? "Example: I run service calls, quote jobs, manage the crew…"
                  : nextQuestion === "service_area"
                    ? "Example: Pasadena and the east side of Los Angeles"
                    : "Example: following up on estimates after I send them"
              }
              required
            />
            <button className="ja-primary" disabled={busy || !answer.trim()}>
              CONTINUE
            </button>
            <p className="ja-truth">We only know what you tell us. No customers, revenue or results are invented here.</p>
          </form>
        ) : !preview ? (
          <div className="ja-center">
            <p className="ja-kicker">THAT'S ENOUGH TO START</p>
            <h1>See your business as a game.</h1>
            <button className="ja-primary" disabled={busy} onClick={() => void buildPreview()}>
              {generatePreview.isPending ? "BUILDING…" : "BUILD MY FIRST DAY LINE"}
            </button>
          </div>
        ) : !data.businessName || !data.ownerEmail ? (
          <>
            <div className="ja-reveal">
              <p className="ja-kicker">CLAIRE'S OPENING READ</p>
              <h1>{preview.area.canonicalAddress || preview.area.declared}</h1>
              <p>{preview.briefing.text}</p>
              <div className="ja-dayline">
                <span>{preview.recommendedAction.title}</span>
                <strong>{preview.recommendedAction.text}</strong>
              </div>
              <small>Draft preview · based only on your answers{preview.area.provenance === "geocoded_declaration" ? " and the place you declared" : ""}.</small>
            </div>
            <form className="ja-form ja-identity" onSubmit={submitIdentity}>
              <p className="ja-kicker">SAVE THIS WORLD</p>
              <label>
                Business name
                <input value={businessName} onChange={event => setBusinessName(event.target.value)} required />
              </label>
              <label>
                Your name
                <input value={contactName} onChange={event => setContactName(event.target.value)} required />
              </label>
              <label>
                Email
                <input type="email" value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} required />
              </label>
              <button className="ja-primary" disabled={busy}>CONTINUE</button>
            </form>
          </>
        ) : (
          <>
            <div className="ja-reveal ja-reveal--compact">
              <p className="ja-kicker">YOUR STARTING POINT IS SAVED</p>
              <h1>{preview.area.canonicalAddress || preview.area.declared}</h1>
              <div className="ja-dayline">
                <span>{preview.recommendedAction.title}</span>
                <strong>{preview.recommendedAction.text}</strong>
              </div>
            </div>
            <div className="ja-checkout">
              <p className="ja-kicker">START PLAYING</p>
              <h2>7 days, then $49/month.</h2>
              <p>Card required. One plan. Cancel anytime.</p>
              <button className="ja-primary" disabled={busy || !plans.data?.length} onClick={() => void beginCheckout()}>
                {plans.data?.length ? "START MY 7 DAYS" : "BILLING CONNECTION PENDING"}
              </button>
              {!plans.data?.length ? <small>Your setup is saved. No tenant or fake payment is created while billing is unavailable.</small> : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
