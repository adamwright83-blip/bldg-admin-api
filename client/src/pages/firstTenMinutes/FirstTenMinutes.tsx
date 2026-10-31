import { useCallback, useEffect, useRef, useState } from "react";
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
import { PortraitPage } from "./portrait/PortraitPage";
import { ClaireQuestion } from "./knowledge/ClaireQuestion";
import { WorkspaceKey } from "./chapter/WorkspaceKey";
import { AskClaire, FirstChapterEntry } from "./chapter/FirstChapterEntry";
import { ChapterThreshold } from "./chapter/ChapterThreshold";
import { chapterGate } from "./chapter/chapterGate";
import { ImpossibleMachine } from "./impossibleMachine/ImpossibleMachine";
import {
  generateSimulatedOpportunity,
  createSimulatedDraft,
} from "./impossibleMachine/simulatedOpportunity";
import { draftStatusLine } from "@shared/firstTenMinutesActivation";
import type { ChapterView, DraftApproach, DraftView } from "@shared/firstTenMinutesChapter";
import type { StoredMachineProgress } from "./impossibleMachine/machinePersistence";
import { buildReveals } from "@shared/firstTenMinutesCrew";
import type { JourneyStage } from "@shared/firstTenMinutes";
import styles from "./firstTen.module.css";
import portraitStyles from "./portrait/portrait.module.css";

/**
 * JOYSTICK's first ten minutes (docs/goldline/FIRST_TEN_MINUTES_BUILD.md). Astra's flow, in the presentation Adam
 * asked for: the person's own world is the spectacle, and the crew interrupts from the edges.
 *
 * The server keeps the journey (stage, connections, and later everything the crew finds and the person decides), so
 * a reload, a Google or Slack consent screen, or a Stripe checkout lands back in the same place.
 */
type ReturnNotice = { connected: ConnectionProvider | null; error: string | null; checkout: "success" | "cancelled" | null };

function readReturn(): ReturnNotice {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  const code = connectErrorCode(params.get("connect_error"));
  const checkout = params.get("checkout");
  if (connected || code || checkout || params.get("session")) window.history.replaceState(null, "", window.location.pathname);
  return {
    connected: connected === "google" || connected === "slack" ? connected : null,
    error: code ? CONNECT_ERRORS[code] : null,
    checkout: checkout === "success" || checkout === "cancelled" ? checkout : null,
  };
}

/** Stages past the crew's introductions: on a reload the crew doesn't introduce itself again. */
const AFTER_CREW: ReadonlySet<JourneyStage> = new Set(["portrait", "chapter", "table", "activation", "first_chapter"]);

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

  // Claire's portrait: once the crew has introduced itself and the reading is complete. Asked again whenever the
  // person's answers change what it rests on, until they keep it.
  const pastCrew = Boolean(view && AFTER_CREW.has(view.stage));
  const crewFinished = crewDone || pastCrew;
  const readingComplete = reading.view?.status === "complete";
  // Claire's questions first, when JOYSTICK_ONBOARDING_INTELLIGENCE is on: what the reading couldn't settle, one at a
  // time. Off, the server answers "settled" and nothing here changes.
  const knowledgeQuestion = trpc.system.firstTenMinutes.knowledgeQuestion.useQuery(credentials!, {
    enabled: Boolean(credentials) && crewFinished && readingComplete,
    retry: false,
  });
  const answerKnowledgeQuestion = trpc.system.firstTenMinutes.answerKnowledgeQuestion.useMutation();
  const [understood, setUnderstood] = useState<string | null>(null);
  const questionsSettled = knowledgeQuestion.isError || Boolean(knowledgeQuestion.data?.settled);
  async function onKnowledgeAnswer(answer: string | null) {
    const question = knowledgeQuestion.data?.question;
    if (!credentials || !question) return;
    const next = await answerKnowledgeQuestion.mutateAsync({ ...credentials, questionId: question.id, answer });
    setUnderstood(next.explanation);
    utils.system.firstTenMinutes.knowledgeQuestion.setData(credentials, next);
  }
  const preparePortrait = trpc.system.firstTenMinutes.preparePortrait.useMutation();
  const answerPortrait = trpc.system.firstTenMinutes.answerPortrait.useMutation();
  const portrait = trpc.system.firstTenMinutes.portrait.useQuery(credentials!, {
    enabled: Boolean(credentials) && crewFinished && readingComplete,
    retry: false,
    refetchInterval: query => (query.state.data?.status === "writing" ? 1200 : false),
  });
  // what the page rests on, content included: a later reading can change a finding under the same id
  const portraitBasis =
    reading.view?.findings
      .map(finding => `${finding.id}:${finding.status}:${finding.correction ?? ""}:${JSON.stringify(finding.payload)}:${finding.sources.map(source => source.ref).join(",")}`)
      .join("|") ?? "";
  const writePortrait = useCallback(() => {
    if (!credentials) return;
    preparePortrait.mutate(credentials, { onSuccess: next => utils.system.firstTenMinutes.portrait.setData(credentials, next) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);
  useEffect(() => {
    if (!crewFinished || !readingComplete || !questionsSettled || portrait.data?.status === "kept") return;
    writePortrait();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewFinished, readingComplete, questionsSettled, portraitBasis, writePortrait]);
  // A correction made while Claire was writing couldn't start a new page then; once she has finished, ask again. The
  // server writes again only if what the page rests on has changed, so this settles after one more page at most.
  const wasWriting = useRef(false);
  useEffect(() => {
    const writing = portrait.data?.status === "writing";
    if (wasWriting.current && !writing && portrait.data?.status === "ready") writePortrait();
    wasWriting.current = writing;
  }, [portrait.data?.status, writePortrait]);
  const page = portrait.data && (portrait.data.status === "ready" || portrait.data.status === "kept") ? portrait.data : null;
  const keptJustNow = useRef(false);

  async function onPortrait(input: { answer: "keep" } | { answer: "change"; key: string; to: string | null } | { answer: "restore"; key: string }) {
    if (!credentials) return;
    const next = await answerPortrait.mutateAsync({ ...credentials, ...input });
    if (input.answer === "keep") keptJustNow.current = true;
    utils.system.firstTenMinutes.portrait.setData(credentials, next);
    if (input.answer === "keep") void journey.refetch();
  }

  // The first chapter, once the person has kept Claire's page: the revelation, Hazel's letter, the real draft.
  const portraitKept = page?.status === "kept";
  const [chapterOpen, setChapterOpen] = useState(false);
  useEffect(() => {
    if (!portraitKept || chapterOpen) return;
    // kept just now, the seal lands first; kept before this visit, the chapter is simply where the person left it
    const timer = window.setTimeout(() => setChapterOpen(true), keptJustNow.current ? 1800 : 0);
    return () => window.clearTimeout(timer);
  }, [portraitKept, chapterOpen]);
  const chapter = trpc.system.firstTenMinutes.chapter.useQuery(credentials!, { enabled: Boolean(credentials) && portraitKept, retry: false });
  const chapterStep = trpc.system.firstTenMinutes.chapterStep.useMutation();
  const prepareDraft = trpc.system.firstTenMinutes.prepareDraft.useMutation();
  const changeDraft = trpc.system.firstTenMinutes.changeDraft.useMutation();
  const declineDraft = trpc.system.firstTenMinutes.declineDraft.useMutation();
  const setChapter = (next: ChapterView) => {
    if (credentials) utils.system.firstTenMinutes.chapter.setData(credentials, next);
  };
  const businessName =
    reading.view?.findings.find(finding => finding.payload.kind === "business" && finding.status !== "dismissed")?.payload.kind === "business"
      ? (reading.view.findings.find(finding => finding.payload.kind === "business")!.payload as { name: string }).name
      : null;
  const opportunity = chapter.data?.opportunity ?? null;
  // "Your first chapter": back on their portrait, unless they went out to the courtyard again
  const [atCourtyard, setAtCourtyard] = useState(false);
  const onFirstChapter = view?.stage === "first_chapter" && !atCourtyard;

  // User B (no opportunity found): player can opt to step into the simulated scenario
  const [simulatedActive, setSimulatedActive] = useState<boolean>(() => {
    if (typeof window === "undefined" || !credentials?.sessionId) return false;
    try {
      return window.localStorage.getItem(`joystick_simulated_machine_${credentials.sessionId}`) === "true";
    } catch {
      return false;
    }
  });

  const enterSimulated = useCallback(() => {
    setSimulatedActive(true);
    if (credentials?.sessionId) {
      try {
        window.localStorage.setItem(`joystick_simulated_machine_${credentials.sessionId}`, "true");
      } catch {}
    }
  }, [credentials?.sessionId]);

  const exitSimulated = useCallback(() => {
    setSimulatedActive(false);
    if (credentials?.sessionId) {
      try {
        window.localStorage.setItem(`joystick_simulated_machine_${credentials.sessionId}`, "false");
      } catch {}
    }
    setAtCourtyard(false);
    window.scrollTo({ top: 0 });
  }, [credentials?.sessionId]);

  // a kept page always leads somewhere visible: the chapter, or a plain word on why not yet (chapter/chapterGate.ts)
  const gate = chapterGate({ portraitKept, chapterOpen, onFirstChapter, data: chapter.data, isError: chapter.isError });
  const isSimulatedChapter = gate === "no_opportunity" && simulatedActive;
  const inChapter = gate === "open" || isSimulatedChapter;

  const [simulatedDraft, setSimulatedDraft] = useState<DraftView | null>(() => {
    if (typeof window === "undefined" || !credentials?.sessionId) return null;
    try {
      const raw = window.localStorage.getItem(`joystick_simulated_draft_${credentials.sessionId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [simulatedProgress, setSimulatedProgress] = useState<Partial<StoredMachineProgress> | null>(() => {
    if (typeof window === "undefined" || !credentials?.sessionId) return null;
    try {
      const raw = window.localStorage.getItem(`joystick_simulated_progress_${credentials.sessionId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const simulatedStatus =
    simulatedProgress?.adventureCompleted || simulatedProgress?.rookRescued
      ? ("completed" as const)
      : simulatedProgress?.keyRetrieved || simulatedDraft !== null
        ? ("in_progress" as const)
        : ("not_started" as const);

  // keeping the crew, and the message leaving the table
  const hasDraft = Boolean(chapter.data?.draft);
  const activation = trpc.system.firstTenMinutes.activation.useQuery(credentials!, {
    enabled: Boolean(credentials) && hasDraft,
    retry: false,
    refetchInterval: query => (query.state.data?.status === "checkout_pending" ? 2000 : false),
  });
  const beginActivation = trpc.system.firstTenMinutes.beginActivation.useMutation();
  const sendDraft = trpc.system.firstTenMinutes.sendDraft.useMutation();
  const verifyDraft = trpc.system.firstTenMinutes.verifyDraft.useMutation();
  const verify = useCallback(async () => {
    if (!credentials) return;
    setChapter(await verifyDraft.mutateAsync(credentials));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  // the person returns to their portrait, where a new entry has appeared, and Claire is there to ask
  const firstChapter = trpc.system.firstTenMinutes.firstChapter.useQuery(credentials!, {
    enabled: Boolean(credentials) && hasDraft && view?.stage === "first_chapter",
    retry: false,
  });
  const openFirstChapter = trpc.system.firstTenMinutes.openFirstChapter.useMutation();
  const askClaire = trpc.system.firstTenMinutes.askClaire.useMutation();

  async function backToPage() {
    if (!credentials) return;
    const next = await openFirstChapter.mutateAsync(credentials);
    if (next) utils.system.firstTenMinutes.firstChapter.setData(credentials, next);
    await journey.refetch();
    setAtCourtyard(false);
    window.scrollTo({ top: 0 });
  }

  function toCourtyard() {
    setAtCourtyard(true);
    window.scrollTo({ top: 0 });
  }

  async function ask() {
    if (!credentials) return;
    const next = await askClaire.mutateAsync({ ...credentials, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (next) utils.system.firstTenMinutes.firstChapter.setData(credentials, next);
    // Claire looks in the Sent folder before she answers, so the message's own line may have changed too
    await chapter.refetch();
  }

  function renderChapter() {
    if (!credentials) return null;
    const data = chapter.data;
    if (!data && !isSimulatedChapter) return null;

    if (isSimulatedChapter) {
      const simulatedOpp = generateSimulatedOpportunity(businessName, reading.view?.findings);
      return (
        <ImpossibleMachine
          initialProgress={simulatedProgress}
          adapter={{
            isSimulated: true,
            example,
            businessName,
            opportunity: simulatedOpp,
            draft: simulatedDraft,
            activation: null,
            checkoutNotice: null,
            connectNotice: null,
            onPrepareDraft: async () => {
              const draft = createSimulatedDraft(simulatedOpp, "still_wanted");
              setSimulatedDraft(draft);
              try {
                window.localStorage.setItem(`joystick_simulated_draft_${credentials.sessionId}`, JSON.stringify(draft));
              } catch {}
            },
            onChangeDraft: async change => {
              setSimulatedDraft(prev => {
                if (!prev) return prev;
                const updated = change.approach
                  ? createSimulatedDraft(simulatedOpp, change.approach)
                  : { ...prev, body: change.body ?? prev.body, edited: true };
                try {
                  window.localStorage.setItem(`joystick_simulated_draft_${credentials.sessionId}`, JSON.stringify(updated));
                } catch {}
                return updated;
              });
            },
            onDeclineDraft: async () => {
              setSimulatedDraft(prev => {
                if (!prev) return null;
                const declined: DraftView = { ...prev, status: "declined" };
                try {
                  window.localStorage.setItem(`joystick_simulated_draft_${credentials.sessionId}`, JSON.stringify(declined));
                } catch {}
                return declined;
              });
            },
            onRecordChoice: async () => {},
            onRecordMilestone: async payload => {
              setSimulatedProgress(prev => {
                const next: Partial<StoredMachineProgress> = {
                  ...prev,
                  keyRetrieved: payload.milestone === "key_retrieved" ? true : prev?.keyRetrieved,
                  centerExamined: payload.milestone === "center_examined" ? true : prev?.centerExamined,
                  returnCompleted: payload.milestone === "return_completed" ? true : prev?.returnCompleted,
                  returnRouteUsed: payload.route ?? prev?.returnRouteUsed,
                  rookRescued: payload.milestone === "rook_rescued" ? true : prev?.rookRescued,
                  adventureCompleted: payload.milestone === "adventure_completed" ? true : prev?.adventureCompleted,
                };
                try {
                  window.localStorage.setItem(`joystick_simulated_progress_${credentials.sessionId}`, JSON.stringify(next));
                } catch {}
                return next;
              });
            },
            onSendDraft: async () => {
              setSimulatedDraft(prev => {
                if (!prev) return prev;
                const sent: DraftView = {
                  ...prev,
                  status: "verified_sent",
                  verifiedSentAt: new Date().toISOString(),
                  sentByJoystick: true,
                };
                try {
                  window.localStorage.setItem(`joystick_simulated_draft_${credentials.sessionId}`, JSON.stringify(sent));
                } catch {}
                return sent;
              });
              return "sent";
            },
            onFinishAdventure: async () => {
              exitSimulated();
            },
          }}
        />
      );
    }

    if (!data) return null;
    const actView = activation.data ?? null;
    return (
      <ImpossibleMachine
        initialProgress={data.machine ?? null}
        adapter={{
          isSimulated: false,
          example,
          businessName,
          opportunity,
          draft: data.draft,
          activation: actView,
          checkoutNotice: returned.checkout,
          connectNotice: notice,
          onPrepareDraft: async () => setChapter(await prepareDraft.mutateAsync(credentials)),
          onChangeDraft: async (change: { approach?: DraftApproach; body?: string }) =>
            setChapter(await changeDraft.mutateAsync({ ...credentials, ...change })),
          onDeclineDraft: async () => setChapter(await declineDraft.mutateAsync(credentials)),
          onRecordChoice: async choice => {
            const stepName =
              choice === "prepare_reply"
                ? "choice_prepare_reply"
                : choice === "keep_for_later"
                  ? "choice_keep_for_later"
                  : "choice_not_for_me";
            setChapter(await chapterStep.mutateAsync({ ...credentials, step: stepName }));
          },
          onRecordMilestone: async payload => {
            setChapter(
              await chapterStep.mutateAsync({
                ...credentials,
                step: payload.milestone,
                route: payload.route,
              })
            );
          },
          onBeginActivation: async identity => {
            const { url } = await beginActivation.mutateAsync({ ...credentials, ...identity });
            window.location.assign(url);
          },
          onBringYourOwn: bringYourOwn,
          onSendDraft: async (approved, options) => {
            const sent = await sendDraft.mutateAsync({ ...credentials, ...approved, ...options });
            setChapter(sent.chapter);
            if (sent.outcome === "needs_permission") void activation.refetch();
            return sent.outcome;
          },
          onAllowSend: async () => {
            const { url } = await beginConnect.mutateAsync({
              ...credentials,
              provider: "google",
              purpose: "send",
            });
            window.location.assign(url);
          },
          onVerifyDraft: verify,
          onFinishAdventure: backToPage,
        }}
      >
        {actView?.owner ? <WorkspaceKey activation={actView} credentials={credentials} /> : null}
      </ImpossibleMachine>
    );
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
          {inChapter ? renderChapter() : null}
          {inChapter ? null : crewReady && reading.view && view ? (
            <div className={page ? portraitStyles.settled : styles.holder} data-testid="first-ten-crew-holder" aria-hidden={page ? true : undefined}>
              <CrewScene
                journeyId={view.id}
                view={reading.view}
                picture={picture.data?.src ?? null}
                introduced={pastCrew}
                onAnswer={answer}
                onFinished={() => setCrewDone(true)}
              />
            </div>
          ) : (
            <UnderstandingScene view={reading.view} onAgain={reading.again} onLookCloser={() => setCloser(true)} />
          )}
          {!page && !inChapter && crewFinished && readingComplete && !questionsSettled && knowledgeQuestion.data?.question ? (
            <ClaireQuestion question={knowledgeQuestion.data.question} understood={understood} onAnswer={onKnowledgeAnswer} />
          ) : null}
          {page && reading.view && !inChapter ? (
            <PortraitPage
              view={page}
              findings={reading.view.findings}
              onKeep={() => onPortrait({ answer: "keep" })}
              onChange={(key, to) => onPortrait({ answer: "change", key, to })}
              onRestore={key => onPortrait({ answer: "restore", key })}
              entry={
                onFirstChapter && firstChapter.data && chapter.data?.draft ? (
                  <FirstChapterEntry entry={firstChapter.data.entry} status={draftStatusLine(chapter.data.draft.status, chapter.data.draft)} />
                ) : undefined
              }
            >
              {onFirstChapter && firstChapter.data ? <AskClaire view={firstChapter.data} onAsk={ask} onCourtyard={toCourtyard} /> : null}
              {onFirstChapter && activation.data?.owner && credentials ? <WorkspaceKey activation={activation.data} credentials={credentials} /> : null}
              {gate === "loading" || gate === "error" || gate === "no_opportunity" ? (
                <ChapterThreshold
                  gate={gate}
                  retrying={chapter.isFetching}
                  onRetry={() => void chapter.refetch()}
                  onLookCloser={() => setCloser(true)}
                  onEnterSimulated={enterSimulated}
                  simulatedStatus={simulatedStatus}
                />
              ) : null}
            </PortraitPage>
          ) : null}
          {crewFinished && portrait.data?.status === "failed" ? (
            <p className={portraitStyles.quietNote} data-testid="first-ten-portrait-failed">
              Claire's page didn't come together just now.
              <button type="button" onClick={writePortrait}>
                Try again
              </button>
            </p>
          ) : null}
          {crewFinished && portrait.data?.status === "unavailable" ? (
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
