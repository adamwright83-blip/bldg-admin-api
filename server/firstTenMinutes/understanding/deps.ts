import { GoogleGeocoder } from "../../geography/googleGeocoder";
import { providerUrl } from "../providerFetch";
import { connectionSecrets, updateAccessToken, type JourneyRow } from "../store";
import { exampleOf } from "../../../shared/firstTenMinutesExample";
import { exampleCorpus, exampleGeocoder, exampleReaders } from "./exampleReaders";
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
  const example = exampleOf(journey.kind);
  if (example) {
    const corpus = exampleCorpus(example.key);
    return { readers: exampleReaders(corpus), extractor: exampleExtractor(example.key), geocoder: exampleGeocoder(corpus) };
  }
  const slack = await connectionSecrets(journey.id, "slack");
  const access = await googleAccessFor(journey);
  const ownerEmail = access?.ownerEmail ?? "";
  const gmail = access ? gmailReader(access) : null;
  const calendar = access ? calendarReader(access) : null;
  const drive = access ? driveReader(access) : null;
  const slackRead = slack ? slackReader({ accessToken: slack.accessToken, userId: slack.row.accountSubject }) : null;
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
        ? drive.drive(limit, READ_LIMITS.driveDocs, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))
        : nothing,
    slack: async limit => (slackRead ? slackRead(limit) : nothing),
    now: () => new Date(),
  };
  return { readers, extractor: claudeExtractor(journey.id), geocoder: googleGeocoder() };
}
