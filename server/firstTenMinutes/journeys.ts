import { TRPCError } from "@trpc/server";
import { requireOnboardingSession, startJoystickOnboardingDraft } from "../saas/saasStore";
import {
  FIRST_TEN_ONBOARDING_MODE,
  type ConnectionProvider,
  type FirstTenJourneyView,
  type JourneyKind,
  type JourneyStage,
} from "../../shared/firstTenMinutes";
import { EXAMPLE_CONNECTION } from "../../shared/firstTenMinutesExample";
import {
  connectionRows,
  connectionSecrets,
  connectionView,
  createJourney,
  forgetConnection,
  journeyBySession,
  setJourneyStage,
  type JourneyRow,
} from "./store";
import { revokeGoogleToken } from "./google";
import { revokeSlackToken } from "./slack";

export type DraftCredentials = { sessionId: string; resumeToken: string };

/** A new signup draft in the first-ten mode, and its journey. `example` is Nina's labelled example. */
export async function startJourney(input: { requestId: string; kind: JourneyKind }) {
  const { session, resumeToken } = await startJoystickOnboardingDraft({
    requestId: input.requestId,
    onboardingMode: FIRST_TEN_ONBOARDING_MODE,
  });
  if (!resumeToken) {
    // The same click arrived twice; the first response holds the only copy of the token.
    throw new TRPCError({ code: "CONFLICT", message: "That start was already used. Reload to begin again." });
  }
  const journey = await createJourney({ acquisitionSessionId: session.id, kind: input.kind });
  return { credentials: { sessionId: session.id, resumeToken }, journey, session };
}

/** The draft behind these credentials, which must be a first-ten draft, and its journey. */
export async function requireJourney(credentials: DraftCredentials) {
  let session: Awaited<ReturnType<typeof requireOnboardingSession>>;
  try {
    session = await requireOnboardingSession(credentials);
  } catch {
    throw new TRPCError({ code: "NOT_FOUND", message: "This draft has expired. Start again from the beginning." });
  }
  if (session.onboardingMode !== FIRST_TEN_ONBOARDING_MODE) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This draft belongs to a different signup." });
  }
  const journey = await journeyBySession(session.id);
  if (!journey) throw new TRPCError({ code: "NOT_FOUND", message: "This draft has no journey." });
  return { session, journey };
}

export async function journeyView(
  journey: JourneyRow,
  session: { expiresAt: Date }
): Promise<FirstTenJourneyView> {
  const connections =
    journey.kind === "example"
      ? [EXAMPLE_CONNECTION]
      : (await connectionRows(journey.id)).filter(row => row.status === "connected").map(connectionView);
  return {
    id: journey.id,
    kind: journey.kind,
    stage: journey.stage,
    connections,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function moveJourney(journey: JourneyRow, stage: JourneyStage): Promise<void> {
  await setJourneyStage(journey.id, stage);
}

/** Revoke at the provider (best effort), then delete JOYSTICK's copy of the access either way. */
export async function disconnectProvider(journey: JourneyRow, provider: ConnectionProvider): Promise<void> {
  const secrets = await connectionSecrets(journey.id, provider);
  if (secrets) {
    const token = secrets.refreshToken ?? secrets.accessToken;
    if (provider === "google") await revokeGoogleToken(token);
    else await revokeSlackToken(secrets.accessToken);
  }
  await forgetConnection(journey.id, provider);
}
