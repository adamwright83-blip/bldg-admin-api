import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { captureProductEvent } from "@/lib/posthog";
import {
  CONNECT_ERRORS,
  connectErrorCode,
  type ConnectionProvider,
  type FirstTenAvailability,
} from "@shared/firstTenMinutes";
import { EXAMPLE_LABEL } from "@shared/firstTenMinutesExample";
import {
  clearFirstTenCredentials,
  readFirstTenCredentials,
  saveFirstTenCredentials,
  type FirstTenCredentials,
} from "./draftStorage";
import { BringYourWorld, ConnectionIncludesSheet, ConnectionsStrip, Invitation } from "./OpeningScenes";
import { UnderstandingScene } from "./UnderstandingScene";
import { FindingsSheet } from "./FindingsSheet";
import { useReading } from "./useReading";
import { CrewScene } from "./crew/CrewScene";
import { buildReveals } from "@shared/firstTenMinutesCrew";
import styles from "./firstTen.module.css";

/**
 * JOYSTICK's first ten minutes (docs/goldline/FIRST_TEN_MINUTES_BUILD.md). Astra's flow, in the presentation Adam
 * asked for: the person's own world is the spectacle, and the crew interrupts from the edges.
 *
 * The server keeps the journey (stage, connections, and later everything the crew finds and the person decides), so
 * a reload, a Google or Slack consent screen, or a Stripe checkout lands back in the same place.
 */
type ReturnNotice = { connected: ConnectionProvider | null; error: string | null };

function readReturn(): ReturnNotice {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  const code = connectErrorCode(params.get("connect_error"));
  if (connected || code) window.history.replaceState(null, "", window.location.pathname);
  return {
    connected: connected === "google" || connected === "slack" ? connected : null,
    error: code ? CONNECT_ERRORS[code] : null,
  };
}

function newRequestId(): string {
  return crypto.randomUUID();
}

/** The server said this draft no longer exists or isn't a first-ten draft (requireJourney's NOT_FOUND / BAD_REQUEST). */
export function draftIsGone(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return code === "NOT_FOUND" || code === "BAD_REQUEST";
}

export default function FirstTenMinutes({ availability }: { availability: FirstTenAvailability }) {
  const [credentials, setCredentials] = useState<FirstTenCredentials | null>(() => readFirstTenCredentials());
  const [returned] = useState<ReturnNotice>(() => readReturn());
  const [opened, setOpened] = useState(false);
  const [includes, setIncludes] = useState<ConnectionProvider | "example" | null>(null);
  const [notice, setNotice] = useState<string | null>(returned.error);
  const tracked = useRef(false);

  const journey = trpc.system.firstTenMinutes.journey.useQuery(credentials!, {
    enabled: Boolean(credentials),
    // a network blip or a server hiccup is retried; only the server saying the draft is gone ends it
    retry: (failures, error) => !draftIsGone(error) && failures < 3,
  });
  const start = trpc.system.firstTenMinutes.start.useMutation();
  const beginConnect = trpc.system.firstTenMinutes.beginConnect.useMutation();
  const disconnect = trpc.system.firstTenMinutes.disconnect.useMutation();
  const busy = start.isPending || beginConnect.isPending || disconnect.isPending;

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    if (returned.connected) captureProductEvent("onboarding_source_connected", { kind: returned.connected, funnel_step: "first_ten" });
  }, [returned.connected]);

  // An expired or foreign draft is forgotten; the visitor starts again from the invitation. Any other failure keeps the
  // credentials, so the journey (and its connections) can still be reached once the network or server is back.
  useEffect(() => {
    if (!journey.isError || !draftIsGone(journey.error)) return;
    clearFirstTenCredentials();
    setCredentials(null);
  }, [journey.isError, journey.error]);

  async function startJourney(kind: "own" | "example"): Promise<FirstTenCredentials> {
    const result = await start.mutateAsync({ requestId: newRequestId(), kind });
    saveFirstTenCredentials(result.credentials);
    setCredentials(result.credentials);
    captureProductEvent("onboarding_draft_started", { source: "first_ten", kind });
    return result.credentials;
  }

  async function connect(provider: ConnectionProvider) {
    setNotice(null);
    try {
      const own = credentials && journey.data?.kind === "own" ? credentials : await startJourney("own");
      captureProductEvent("onboarding_connect_started", { provider, funnel_step: "first_ten" });
      const { url } = await beginConnect.mutateAsync({ ...own, provider });
      window.location.assign(url);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : CONNECT_ERRORS.failed);
    }
  }

  async function exploreExample() {
    setNotice(null);
    try {
      await startJourney("example");
      captureProductEvent("onboarding_source_connected", { kind: "example", funnel_step: "first_ten" });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The example didn't open. Please try again.");
    }
  }

  function bringYourOwn() {
    clearFirstTenCredentials();
    setCredentials(null);
    setOpened(true);
  }

  async function removeConnection(provider: ConnectionProvider) {
    if (!credentials) return;
    await disconnect.mutateAsync({ ...credentials, provider });
    await journey.refetch();
  }

  const view = journey.data ?? null;
  const example = view?.kind === "example";
  const hasConnection = Boolean(view?.connections.length);
  const reading = useReading(credentials, hasConnection);
  const [closer, setCloser] = useState(false);
  const [crewDone, setCrewDone] = useState(false);
  const utils = trpc.useUtils();
  const answerFinding = trpc.system.firstTenMinutes.answerFinding.useMutation();
  const move = trpc.system.firstTenMinutes.move.useMutation();

  // The crew steps in as soon as something worthwhile is ready: once the email reading is done, or the whole reading.
  const crewReady = Boolean(
    reading.view &&
      (reading.view.status === "complete" || reading.view.finished.includes("conversations")) &&
      (reading.view.status === "complete" || buildReveals(reading.view.findings, { final: false }).length > 0)
  );
  useEffect(() => {
    if (!crewReady || !credentials || !view || view.stage !== "understanding") return;
    move.mutate({ ...credentials, stage: "crew" }, { onSuccess: next => utils.system.firstTenMinutes.journey.setData(credentials, next) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewReady, credentials, view?.stage]);

  const imageFinding = reading.view?.findings.find(finding => finding.payload.kind === "image" && finding.status !== "dismissed");
  const picture = trpc.system.firstTenMinutes.findingPicture.useQuery(
    { ...(credentials ?? { sessionId: "", resumeToken: "" }), findingId: imageFinding?.id ?? "" },
    { enabled: Boolean(credentials && imageFinding && crewReady), staleTime: Infinity, retry: false }
  );

  async function answer(findingId: string, choice: "confirm" | "change" | "dismiss", correction?: string) {
    if (!credentials) return;
    const next = await answerFinding.mutateAsync({ ...credentials, findingId, answer: choice, correction });
    utils.system.firstTenMinutes.understanding.setData(credentials, next);
  }

  // Slack added after the reading finished: read again, so the crew sees it too.
  const readingConnections = useRef<number | null>(null);
  useEffect(() => {
    if (!view || reading.view?.status !== "complete") return;
    if (readingConnections.current === null) readingConnections.current = view.connections.length;
    else if (view.connections.length > readingConnections.current) {
      readingConnections.current = view.connections.length;
      reading.again();
    }
  }, [view, reading]);

  function renderScene() {
    if (credentials && journey.isLoading) return null;
    if (view && hasConnection) {
      return (
        <>
          {!example ? (
            <ConnectionsStrip
              connections={view.connections}
              busy={busy}
              googleReady={availability.google}
              slackReady={availability.slack}
              onConnect={provider => void connect(provider)}
              onDisconnect={provider => void removeConnection(provider)}
            />
          ) : null}
          {crewReady && reading.view && view ? (
            <CrewScene
              journeyId={view.id}
              view={reading.view}
              picture={picture.data?.src ?? null}
              onAnswer={answer}
              onFinished={() => setCrewDone(true)}
            />
          ) : (
            <UnderstandingScene view={reading.view} onAgain={reading.again} onLookCloser={() => setCloser(true)} />
          )}
          {crewDone ? (
            <button type="button" className={styles.endLink} onClick={() => setCloser(true)} data-testid="first-ten-look-closer">
              Look closer
            </button>
          ) : null}
          {closer && reading.view ? <FindingsSheet findings={reading.view.findings} onClose={() => setCloser(false)} /> : null}
        </>
      );
    }
    if (!opened && !view) return <Invitation onBegin={() => setOpened(true)} />;
    return (
      <BringYourWorld
        busy={busy}
        googleReady={availability.google}
        slackReady={availability.slack}
        notice={notice}
        onConnect={provider => void connect(provider)}
        onExample={() => void exploreExample()}
        onIncludes={setIncludes}
      />
    );
  }

  return (
    <main className={styles.desk} data-testid="first-ten-minutes" data-stage={view?.stage ?? (opened ? "connect" : "invitation")}>
      <span className={styles.mark} aria-hidden="true">JOYSTICK</span>
      {example ? (
        <div className={styles.exampleTag} data-testid="first-ten-example-label">
          <span>{EXAMPLE_LABEL}</span>
          <button type="button" onClick={bringYourOwn}>
            Bring your own
          </button>
        </div>
      ) : null}
      {renderScene()}
      {includes ? <ConnectionIncludesSheet what={includes} onClose={() => setIncludes(null)} /> : null}
    </main>
  );
}
