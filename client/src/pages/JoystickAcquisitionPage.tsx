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
import {
  JOYSTICK_EXPERIENCE_LABELS,
  experienceFromEntrySearch,
  parseJoystickExperience,
  type JoystickExperience,
} from "@shared/joystickSelectedExperience";
import type {
  JoystickDraftAnswerMap,
  JoystickDraftPreview,
} from "@shared/joystickAcquisition";
import { apiBase } from "@/lib/apiBase";
import "./joystick-acquisition.css";
import {
  HELD_LIST_MAX_BYTES,
  heldListPlaceLine,
  holdCustomerList,
  readCustomerListDecision,
  readHeldCustomerList,
  skipCustomerList,
  type CustomerListDecision,
  type HeldCustomerList,
} from "@/lib/joystickHeldCustomerList";

type Credentials = { sessionId: string; resumeToken: string };
const SESSION_KEY = "joystick_acquisition_credentials";
const EXPERIENCE_KEY = "joystick_selected_experience";

/**
 * The world chosen on the homepage arrives as ?world= (or the SPA landing's
 * ?mode=). It is kept for the visit so the Stripe return, which carries only
 * ?session= and ?checkout=, still knows it.
 */
function readSelectedExperience(): JoystickExperience | null {
  if (typeof window === "undefined") return null;
  const fromUrl = experienceFromEntrySearch(window.location.search);
  try {
    if (fromUrl) {
      localStorage.setItem(EXPERIENCE_KEY, fromUrl);
      return fromUrl;
    }
    return parseJoystickExperience(localStorage.getItem(EXPERIENCE_KEY));
  } catch {
    return fromUrl;
  }
}

function readCredentials(): Credentials | null {
  try {
    const raw =
      typeof window !== "undefined"
        ? sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)
        : null;
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

export default function JoystickAcquisitionPage() {
  const [credentials, setCredentials] = useState<Credentials | null>(() => readCredentials());
  const [answer, setAnswer] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedExperience] = useState<JoystickExperience | null>(() => readSelectedExperience());
  const [heldList, setHeldList] = useState<HeldCustomerList | null>(() => readHeldCustomerList());
  const [listDecision, setListDecision] = useState<CustomerListDecision | null>(() => readCustomerListDecision());
  const [pendingList, setPendingList] = useState<HeldCustomerList | null>(null);
  const prefilledArea = useRef(false);
  const started = useRef(false);
  const previewViewed = useRef(false);
  const checkoutReturnedTracked = useRef(false);
  const provisionedTracked = useRef(false);
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
  const readList = trpc.system.goldlineOnboarding.previewDraftCustomerList.useMutation();

  useEffect(() => {
    if (credentials || started.current) return;
    started.current = true;
    captureProductEvent("onboarding_draft_started", {
      source: "joystick_landing",
      selected_experience: selectedExperience,
    });
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
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
          setCredentials(next);
        },
        onError: cause => setError(cause.message),
      }
    );
  }, [credentials, start, selectedExperience]);

  useEffect(() => {
    const data = resume.data;
    if (!data) return;
    setBusinessName(value => value || data.businessName || "");
    setOwnerEmail(value => value || data.ownerEmail || "");
    const configuration = data.configuration as { contactName?: string } | null;
    setContactName(value => value || configuration?.contactName || "");
  }, [resume.data]);

  useEffect(() => {
    const data = resume.data;
    if (!data?.draftPreview || previewViewed.current) return;
    previewViewed.current = true;
    captureProductEvent("onboarding_preview_viewed", { funnel_step: "prepay" });
  }, [resume.data]);

  useEffect(() => {
    if (checkoutReturnedTracked.current) return;
    const result = new URLSearchParams(window.location.search).get("checkout");
    if (!result) return;
    checkoutReturnedTracked.current = true;
    captureProductEvent("onboarding_checkout_returned", { result });
  }, []);

  useEffect(() => {
    const data = resume.data;
    if (
      provisionedTracked.current ||
      !data?.tenantId ||
      (data.status !== "provisioned" && data.status !== "configuring")
    ) return;
    provisionedTracked.current = true;
    captureProductEvent("onboarding_tenant_provisioned", {
      tenant_id: data.tenantId,
    });
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
    activate.isPending ||
    readList.isPending;

  // The list's own localities answer "where do you work" as a suggestion the
  // operator confirms or edits; it is saved as their answer only when they continue.
  useEffect(() => {
    if (nextQuestion !== "service_area" || !heldList || prefilledArea.current) return;
    const place = heldList.summary.localities[0]?.label;
    if (!place) return;
    prefilledArea.current = true;
    setAnswer(value => value || place);
  }, [nextQuestion, heldList]);

  async function chooseList(file: File | undefined) {
    if (!file || !credentials) return;
    setError(null);
    if (file.size > HELD_LIST_MAX_BYTES) {
      setError("Choose a CSV smaller than 500 KB (about 100 customers).");
      return;
    }
    try {
      const payload = await file.text();
      const summary = await readList.mutateAsync({ ...credentials, payload });
      setPendingList({ fileName: file.name, payload, summary, heldAt: new Date().toISOString() });
      captureProductEvent("onboarding_mirror_shown", {
        funnel_step: "prepay",
        customers: summary.rows,
        usable: summary.usable,
        needs_review: summary.needsReview,
        localities: summary.localities.length,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that list.");
    }
  }

  function confirmList() {
    if (!pendingList) return;
    if (!holdCustomerList(pendingList)) {
      setError("This browser would not keep your list. You can add it again after your workspace opens.");
    }
    setHeldList(pendingList);
    setListDecision("held");
    setPendingList(null);
    captureProductEvent("onboarding_source_connected", { kind: "csv", funnel_step: "prepay" });
  }

  function continueWithoutList() {
    skipCustomerList();
    setHeldList(null);
    setPendingList(null);
    setListDecision("skipped");
    captureProductEvent("onboarding_source_connected", { kind: "none", funnel_step: "prepay" });
  }

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
        selectedExperience,
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
      localStorage.removeItem(SESSION_KEY);
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
          <small>
            {selectedExperience
              ? `${JOYSTICK_EXPERIENCE_LABELS[selectedExperience].toUpperCase()} · YOUR BUSINESS, PLAYABLE.`
              : "YOUR BUSINESS. PLAYABLE."}
          </small>
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
        ) : data.status === "draft" && !preview && !listDecision && pendingList ? (
          <div className="ja-mirror" data-testid="customer-list-mirror">
            <p className="ja-kicker">YOUR BUSINESS, FROM YOUR LIST</p>
            <h1>
              {pendingList.summary.usable
                ? `${pendingList.summary.usable} ${pendingList.summary.usable === 1 ? "customer" : "customers"}.`
                : "No one we could place yet."}
            </h1>
            {heldListPlaceLine(pendingList.summary) ? (
              <p>Mostly in {heldListPlaceLine(pendingList.summary)}.</p>
            ) : (
              <p>Your list has no city or ZIP column, so we can't tell where you work from it yet.</p>
            )}
            {pendingList.summary.sampleNames.length ? (
              <ul className="ja-names" aria-label="Customers from your list">
                {pendingList.summary.sampleNames.map(name => <li key={name}>{name}</li>)}
              </ul>
            ) : null}
            <p className="ja-truth">
              From {pendingList.fileName} · {pendingList.summary.rows} rows
              {pendingList.summary.duplicates ? ` · ${pendingList.summary.duplicates} duplicate${pendingList.summary.duplicates === 1 ? "" : "s"}` : ""}
              {pendingList.summary.needsReview ? ` · ${pendingList.summary.needsReview} need a closer look` : ""}.
              {" "}Read in this browser. Nothing is saved until your workspace opens.
            </p>
            <div className="ja-actions">
              <button className="ja-primary" disabled={busy} onClick={confirmList}>THAT'S MY BUSINESS</button>
              <label className="ja-secondary">
                Choose a different file
                <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={event => void chooseList(event.target.files?.[0])} />
              </label>
              <button className="ja-secondary" disabled={busy} onClick={continueWithoutList}>Continue without a list</button>
            </div>
          </div>
        ) : data.status === "draft" && !preview && !listDecision ? (
          <div className="ja-mirror" data-testid="bring-your-business">
            <p className="ja-kicker">STEP ONE</p>
            <h1>Bring your business.</h1>
            <p>
              Drop in your customer list and JOYSTICK reads it back to you. An export from CleanCloud, Square, Jobber,
              QuickBooks or a spreadsheet works: a name and an address for each customer, up to 100.
            </p>
            <div className="ja-actions">
              <label className="ja-primary ja-file">
                {readList.isPending ? "READING YOUR LIST…" : "CHOOSE A CUSTOMER LIST (CSV)"}
                <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={event => void chooseList(event.target.files?.[0])} />
              </label>
              <button className="ja-secondary" disabled={busy} onClick={continueWithoutList}>I don't have a list handy</button>
            </div>
            <p className="ja-truth">Your list stays in this browser until you start your workspace. No customers are invented.</p>
          </div>
        ) : nextQuestion ? (
          <form className="ja-form" onSubmit={submitAnswer}>
            <p className="ja-kicker">
              {JOYSTICK_PREPAY_QUESTION_KEYS.indexOf(nextQuestion) + 1} OF 3
            </p>
            <h1>{questionText(nextQuestion)}</h1>
            {nextQuestion === "service_area" && heldList && heldListPlaceLine(heldList.summary) ? (
              <p className="ja-truth" data-testid="service-area-from-list">
                Your list points to {heldListPlaceLine(heldList.summary)}. Change it if that's not where you work.
              </p>
            ) : null}
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
              <div className="ja-world-preview" aria-label="Draft territory projection">
                <img src="/assets/goldline/procedural-world-v1/02-territory-island-generic.png" alt="" />
                <span>{preview.area.canonicalAddress || preview.area.declared}</span>
              </div>
              <p className="ja-kicker">CLAIRE'S OPENING READ</p>
              <h1>{preview.area.canonicalAddress || preview.area.declared}</h1>
              <p data-testid="draft-preview-briefing">{preview.briefing.text}</p>
              {heldList ? (
                <div className="ja-dayline" data-testid="held-list-receipt">
                  <span>YOUR CUSTOMERS</span>
                  <strong>
                    {heldList.summary.usable} from {heldList.fileName}
                    {heldListPlaceLine(heldList.summary) ? `, mostly ${heldListPlaceLine(heldList.summary)}` : ""}.
                  </strong>
                  <small>They come into your world when your workspace opens. Until then they stay in this browser.</small>
                </div>
              ) : null}
              <div className="ja-dayline">
                <span>{preview.recommendedAction.title}</span>
                <strong>{preview.recommendedAction.text}</strong>
              </div>
              <small data-testid="draft-preview-label">Draft preview · based only on your answers{preview.area.provenance === "geocoded_declaration" ? " and the place you declared" : ""}{heldList ? ", plus your list" : ""}.</small>
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
              <div className="ja-world-preview ja-world-preview--compact" aria-label="Saved draft territory projection">
                <img src="/assets/goldline/procedural-world-v1/02-territory-island-generic.png" alt="" />
                <span>{preview.area.canonicalAddress || preview.area.declared}</span>
              </div>
              <p className="ja-kicker">YOUR STARTING POINT IS SAVED</p>
              <h1>{preview.area.canonicalAddress || preview.area.declared}</h1>
              <div className="ja-dayline">
                <span>{preview.recommendedAction.title}</span>
                <strong>{preview.recommendedAction.text}</strong>
              </div>
              {heldList ? (
                <div className="ja-dayline" data-testid="held-list-receipt">
                  <span>YOUR CUSTOMERS</span>
                  <strong>
                    {heldList.summary.usable} from {heldList.fileName}
                    {heldListPlaceLine(heldList.summary) ? `, mostly ${heldListPlaceLine(heldList.summary)}` : ""}.
                  </strong>
                  <small>They come into your world when your workspace opens. Until then they stay in this browser.</small>
                </div>
              ) : null}
              <small data-testid="draft-preview-label">Draft preview · based only on your answers{heldList ? " and your list" : ""}.</small>
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
