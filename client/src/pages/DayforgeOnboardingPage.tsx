import { trpc } from "@/lib/trpc";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./dayforge-onboarding.css";
import { validateInternalReturnTo } from "@shared/dayforgeContinuation";

type OnboardingCredentials = { sessionId: string; resumeToken: string };
const SESSION_KEY = "dayforge_onboarding_credentials";
const CONTINUATION_KEY = "dayforge_onboarding_continuation";

function readContinuation() {
  const query = new URLSearchParams(window.location.search);
  const preview = query.get("preview") ?? sessionStorage.getItem(`${CONTINUATION_KEY}:preview`);
  const returnTo = validateInternalReturnTo(query.get("returnTo") ?? sessionStorage.getItem(`${CONTINUATION_KEY}:returnTo`));
  if (preview && /^[a-f0-9-]{16,64}$/i.test(preview)) sessionStorage.setItem(`${CONTINUATION_KEY}:preview`, preview);
  if (returnTo) sessionStorage.setItem(`${CONTINUATION_KEY}:returnTo`, returnTo);
  return { preview: preview && /^[a-f0-9-]{16,64}$/i.test(preview) ? preview : null, returnTo };
}

function readCredentials(): OnboardingCredentials | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as OnboardingCredentials;
    return parsed.sessionId && parsed.resumeToken ? parsed : null;
  } catch {
    return null;
  }
}

function requestId(): string {
  return crypto.randomUUID();
}

export default function DayforgeOnboardingPage() {
  const continuation = useMemo(readContinuation, []);
  const [credentials, setCredentials] = useState<OnboardingCredentials | null>(
    () => readCredentials()
  );
  const [error, setError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState("500");
  const [radius, setRadius] = useState("5");
  const [turnaround, setTurnaround] = useState("24");
  const [price, setPrice] = useState("225");
  const [ownerPassword, setOwnerPassword] = useState("");
  const checkoutSucceeded = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("checkout") === "success",
    []
  );

  const resume = trpc.system.saas.resume.useQuery(credentials!, {
    enabled: Boolean(credentials),
    retry: false,
    refetchInterval: checkoutSucceeded ? 2_000 : false,
  });
  const plans = trpc.system.saas.plans.useQuery();
  const start = trpc.system.saas.start.useMutation();
  const save = trpc.system.saas.saveConfiguration.useMutation();
  const checkout = trpc.system.saas.checkout.useMutation();
  const activate = trpc.system.saas.activateOwner.useMutation();

  useEffect(() => {
    if (!resume.data) return;
    setBusinessName(value => value || resume.data.businessName);
    setSlug(value => value || resume.data.slug);
    setEmail(value => value || resume.data.ownerEmail);
  }, [resume.data]);

  const busy =
    start.isPending ||
    save.isPending ||
    checkout.isPending ||
    activate.isPending;
  const plan = plans.data?.[0] ?? null;

  async function begin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await start.mutateAsync({
        businessName,
        slug,
        ownerEmail: email,
        requestId: requestId(),
      });
      if (!result.onboarding || !result.resumeToken) {
        throw new Error(
          "This retry needs the original onboarding resume token."
        );
      }
      const next = {
        sessionId: result.onboarding.id,
        resumeToken: result.resumeToken,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setCredentials(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start onboarding"
      );
    }
  }

  async function saveAndCheckout(event: FormEvent) {
    event.preventDefault();
    if (!credentials || !resume.data || !plan) return;
    setError(null);
    try {
      await save.mutateAsync({
        ...credentials,
        expectedVersion: resume.data.version,
        currentStep: "checkout",
        configuration: {
          businessName,
          slug,
          contactName,
          contactEmail: email,
          contactPhone: phone || null,
          website: website || null,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          brandName: businessName,
          logoUrl: null,
          primaryColor: "#f05a12",
          proposalTemplateKey: "dayforge-standard",
          locations: [
            {
              label: "Primary store",
              address,
              serviceRadiusMiles: Number(radius),
              maxPoundsPerDay: Number(capacity),
              maxPoundsByWeekday: {
                monday: Number(capacity),
                tuesday: Number(capacity),
                wednesday: Number(capacity),
                thursday: Number(capacity),
                friday: Number(capacity),
                saturday: Number(capacity),
              },
              openCapacityPoundsPerWeek: Number(capacity) * 6,
              pickupDays: [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
              ],
              routeWindows: ["09:00-17:00"],
              turnaroundHours: Number(turnaround),
              deliveryEnabled: true,
            },
          ],
          services: [
            {
              locationKey: "Primary store",
              serviceKey: "commercial-wash-fold",
              name: "Commercial wash and fold",
              enabled: true,
              commercialEnabled: true,
              pricePerPoundCents: Number(price),
              minimumOrderCents: null,
              terms: null,
            },
          ],
          importProviderKey: "cleancloud_csv",
        },
      });
      const result = await checkout.mutateAsync({
        ...credentials,
        planKey: plan.planKey,
        requestId: requestId(),
      });
      if (!result.url) throw new Error("Stripe did not return a checkout URL");
      window.location.assign(result.url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not continue to checkout"
      );
    }
  }

  async function activateOwner(event: FormEvent) {
    event.preventDefault();
    if (!credentials) return;
    setError(null);
    try {
      await activate.mutateAsync({
        ...credentials,
        name: contactName,
        password: ownerPassword,
      });
      sessionStorage.removeItem(SESSION_KEY);
      const query = new URLSearchParams();
      if (continuation.preview) query.set("preview", continuation.preview);
      if (continuation.returnTo) query.set("returnTo", continuation.returnTo);
      sessionStorage.removeItem(`${CONTINUATION_KEY}:preview`);
      sessionStorage.removeItem(`${CONTINUATION_KEY}:returnTo`);
      window.location.assign(`/dayforge-login${query.size ? `?${query}` : ""}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not activate owner"
      );
    }
  }

  const status = resume.data?.status;
  return (
    <main className="df-onboarding">
      <section className="df-onboarding__card">
        <div className="df-onboarding__mark" aria-hidden="true">
          D
        </div>
        <p className="df-onboarding__eyebrow">DAYFORGE OPERATOR SETUP</p>
        <h1>Turn your territory into a revenue system.</h1>
        <p className="df-onboarding__intro">
          Configure the real store capacity, routes, service promise, team, and
          billing truth DayForge will use.
        </p>

        {error ? (
          <p className="df-onboarding__error" role="alert">
            {error}
          </p>
        ) : null}

        {!credentials ? (
          <form onSubmit={begin} className="df-onboarding__form">
            <label>
              Business name
              <input
                value={businessName}
                onChange={event => setBusinessName(event.target.value)}
                required
              />
            </label>
            <label>
              Workspace slug
              <input
                value={slug}
                onChange={event => setSlug(event.target.value)}
                minLength={3}
                required
              />
            </label>
            <label>
              Owner email
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
              />
            </label>
            <button disabled={busy}>Start secure setup</button>
          </form>
        ) : resume.isLoading ? (
          <p className="df-onboarding__status">
            Restoring your server-backed setup…
          </p>
        ) : checkoutSucceeded && status === "checkout_pending" ? (
          <p className="df-onboarding__status">
            Stripe confirmed checkout. Waiting for the signed subscription
            webhook to provision your tenant…
          </p>
        ) : status === "provisioned" || status === "configuring" ? (
          <form onSubmit={activateOwner} className="df-onboarding__form">
            <p className="df-onboarding__success">
              Subscription confirmed. Your tenant is provisioned.
            </p>
            <label>
              Owner name
              <input
                value={contactName}
                onChange={event => setContactName(event.target.value)}
                required
              />
            </label>
            <label>
              Create password
              <input
                type="password"
                minLength={12}
                value={ownerPassword}
                onChange={event => setOwnerPassword(event.target.value)}
                required
              />
            </label>
            <button disabled={busy || ownerPassword.length < 12}>
              Activate my DayForge workspace
            </button>
          </form>
        ) : status === "complete" ? (
          <div className="df-onboarding__status">
            <strong>Your workspace is active.</strong>
            <a href="/dayforge-login">Sign in to DayForge</a>
          </div>
        ) : (
          <form
            onSubmit={saveAndCheckout}
            className="df-onboarding__form df-onboarding__grid"
          >
            <label>
              Owner name
              <input
                value={contactName}
                onChange={event => setContactName(event.target.value)}
                required
              />
            </label>
            <label>
              Phone
              <input
                value={phone}
                onChange={event => setPhone(event.target.value)}
                required
              />
            </label>
            <label>
              Website
              <input
                type="url"
                value={website}
                onChange={event => setWebsite(event.target.value)}
                required
              />
            </label>
            <label className="df-onboarding__wide">
              Primary store address
              <input
                value={address}
                onChange={event => setAddress(event.target.value)}
                required
              />
            </label>
            <label>
              Daily capacity, lb
              <input
                type="number"
                min="1"
                value={capacity}
                onChange={event => setCapacity(event.target.value)}
                required
              />
            </label>
            <label>
              Service radius, mi
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={radius}
                onChange={event => setRadius(event.target.value)}
                required
              />
            </label>
            <label>
              Turnaround, hours
              <input
                type="number"
                min="1"
                value={turnaround}
                onChange={event => setTurnaround(event.target.value)}
                required
              />
            </label>
            <label>
              Commercial price, cents/lb
              <input
                type="number"
                min="1"
                value={price}
                onChange={event => setPrice(event.target.value)}
                required
              />
            </label>
            <div className="df-onboarding__plan df-onboarding__wide">
              {plan ? (
                <>
                  <strong>{plan.displayName}</strong>
                  <span>
                    {plan.trialDays > 0
                      ? `${plan.trialDays}-day trial`
                      : "Subscription begins after checkout"}
                  </span>
                </>
              ) : (
                <span>Billing plan is not configured yet.</span>
              )}
            </div>
            <button className="df-onboarding__wide" disabled={busy || !plan}>
              Save configuration and continue to Stripe
            </button>
          </form>
        )}
        <p className="df-onboarding__fineprint">
          Stripe subscription billing is separate from customer laundry
          payments. Your plan and entitlements are resolved on the server.
        </p>
      </section>
    </main>
  );
}
