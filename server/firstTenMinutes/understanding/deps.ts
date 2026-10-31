import { GoogleGeocoder } from "../../geography/googleGeocoder";
import { intelligenceFor, investigateJourney } from "../../businessKnowledge/onboarding";
import { providerUrl } from "../providerFetch";
import { connectionSecrets, updateAccessToken, type JourneyRow } from "../store";
import { exampleGeocoder, exampleReaders } from "./exampleReaders";
import { claudeExtractor, exampleExtractor } from "./extractors";
import { calendarReader, driveReader, gmailReader, type GoogleAccess } from "./googleReaders";
import type { ReadingDeps } from "./run";
import { slackReader } from "./slackReader";
import { READ_LIMITS, type Geocoder, type SourceReaders } from "./sources";

/** A geocoder for real journeys: Google's, through the same provider seam (a local stand-in outside production). */
function googleGeocoder(): Geocoder {
  const geocoder = new GoogleGeocoder(undefined, (input, init) => fetch(providerUrl(String(input)), init));
  return {
    async geocode(address) {
      const result = await geocoder.geocode(address);
      return result.status === "success"
        ? { lat: result.latitude, lng: result.longitude, formatted: result.canonicalAddress }
        : null;
    },
  };
}

/** The journey's Google access, refreshed in place as it is used. Null when Google isn't connected. */
export async function googleAccessFor(journey: JourneyRow): Promise<GoogleAccess | null> {
  const google = await connectionSecrets(journey.id, "google");
  if (!google) return null;
  return {
    accessToken: google.accessToken,
    refreshToken: google.refreshToken,
    accessExpiresAt: google.accessExpiresAt,
    grantedScopes: google.grantedScopes,
    ownerEmail: google.row.accountLabel ?? "",
    onRefreshed: (accessToken, expiresAt) =>
      updateAccessToken({ journeyId: journey.id, provider: "google", accessToken, accessExpiresAt: expiresAt }),
  };
}

/** Readers for a journey's own connections. A provider that isn't connected reads as nothing, with no error. */
export async function readingDepsFor(journey: JourneyRow): Promise<ReadingDeps> {
  if (journey.kind === "example") {
    return { readers: exampleReaders(), extractor: exampleExtractor(), geocoder: exampleGeocoder() };
  }
  const slack = await connectionSecrets(journey.id, "slack");
  return readingDepsWith(journey, {
    google: await googleAccessFor(journey),
    slack: slack ? { accessToken: slack.accessToken, userId: slack.row.accountSubject } : null,
  });
}

export type ReadingConnections = {
  google: GoogleAccess | null;
  slack: { accessToken: string; userId: string | null } | null;
};

/**
 * The reading for `journey` over the given connections: what `readingDepsFor` builds from the journey's own. The
 * cold-start test harness (businessKnowledge/coldTest.ts) uses it to read a person's connected accounts into a
 * throwaway test journey, with its read-only `fetch`, the investigator model it was asked for (`env`) and, in its own
 * tests, a fixed clock (`now`).
 */
export function readingDepsWith(
  journey: JourneyRow,
  connections: ReadingConnections,
  options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => Date } = {}
): ReadingDeps {
  const { google: access, slack } = connections;
  const now = options.now ?? (() => new Date());
  const ownerEmail = access?.ownerEmail ?? "";
  const gmail = access ? gmailReader(access, { fetch: options.fetch, now: options.now }) : null;
  const calendar = access ? calendarReader(access, { fetch: options.fetch, now: options.now }) : null;
  const drive = access ? driveReader(access, { fetch: options.fetch, now: options.now }) : null;
  const slackRead = slack ? slackReader(slack, { fetch: options.fetch, now: options.now }) : null;
  const nothing = { items: [], unavailable: null };

  const readers: SourceReaders = {
    async owner() {
      return gmail ? gmail.owner() : { name: null, email: ownerEmail };
    },
    sentMail: async limit => (gmail ? gmail.sentMail(limit) : nothing),
    receivedMail: async limit => (gmail ? gmail.receivedMail(limit) : nothing),
    calendar: async window => (calendar ? calendar(window) : nothing),
    drive: async limit =>
      drive
        ? drive.drive(limit, READ_LIMITS.driveDocs, new Date(now().getTime() - 365 * 24 * 60 * 60 * 1000))
        : nothing,
    slack: async limit => (slackRead ? slackRead(limit) : nothing),
    now,
  };
  return {
    readers,
    extractor: claudeExtractor(journey.id),
    geocoder: googleGeocoder(),
    ...(access && intelligenceFor(journey)
      ? {
          investigate: (heartbeat: () => Promise<void>) =>
            investigateJourney(journey, access, heartbeat, { fetch: options.fetch, env: options.env, now: options.now }),
        }
      : {}),
  };
}
