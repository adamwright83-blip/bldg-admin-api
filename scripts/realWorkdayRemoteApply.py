from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


# WHY IS THIS HERE? provenance.
replace(
    "shared/goldlineFuturePressure.ts",
    '''  /** The evidence this traces back to, so it is always auditable. */\n  sourceEvidenceReference: string;\n  weight: PressureWeight;''',
    '''  /** The evidence this traces back to, so it is always auditable. */\n  sourceEvidenceReference: string;\n  /** When the source evidence entered the Chronicle, for player-facing provenance. */\n  sourceOccurredAt: string | null;\n  weight: PressureWeight;''',
)
replace(
    "shared/goldlineFuturePressure.ts",
    '''    sourceEvidenceReference: string;\n  }>;''',
    '''    sourceEvidenceReference: string;\n    sourceOccurredAt?: string | null;\n  }>;''',
)
replace(
    "shared/goldlineFuturePressure.ts",
    '''      sourceEvidenceReference: record.sourceEvidenceReference,\n      weight: weighObligation(record, input.date),''',
    '''      sourceEvidenceReference: record.sourceEvidenceReference,\n      sourceOccurredAt: record.madeAt,\n      weight: weighObligation(record, input.date),''',
)
replace(
    "shared/goldlineFuturePressure.ts",
    '''      sourceEvidenceReference: entry.sourceEvidenceReference,\n      weight: weighClaim(entry.claim),''',
    '''      sourceEvidenceReference: entry.sourceEvidenceReference,\n      sourceOccurredAt: entry.sourceOccurredAt ?? null,\n      weight: weighClaim(entry.claim),''',
)
replace(
    "server/goldlineWorld/futurePressureService.ts",
    '''      sourceEvidenceReference: event.sourceEvidenceReference,\n    }))''',
    '''      sourceEvidenceReference: event.sourceEvidenceReference,\n      sourceOccurredAt: event.occurredAt,\n    }))''',
)
replace(
    "server/goldlineWorld/futurePressureService.ts",
    '''        sourceEvidenceReference: string;\n      } => entry.claim !== null''',
    '''        sourceEvidenceReference: string;\n        sourceOccurredAt: string;\n      } => entry.claim !== null''',
)
replace(
    "server/field/types.ts",
    '''  whySurfaced?: string | null;\n  scheduledAt: string | null;''',
    '''  whySurfaced?: string | null;\n  /** When the evidence that surfaced this item was recorded. */\n  whySourceOccurredAt?: string | null;\n  scheduledAt: string | null;''',
)
replace(
    "server/field/fieldTodayService.ts",
    '''      whySurfaced: item.reason,\n      scheduledAt: null,''',
    '''      whySurfaced: item.reason,\n      whySourceOccurredAt: item.sourceOccurredAt,\n      scheduledAt: null,''',
)
model = "client/src/pages/driver/goldlineDayPlanModel.ts"
replace(
    model,
    '''  explanation: string;\n  sourceEvidenceReference: string;\n};''',
    '''  explanation: string;\n  sourceEvidenceReference: string;\n  sourceOccurredAt: string | null;\n};''',
)
replace(
    model,
    '''  physicalEntityId?: string | null;\n  source: { sourceReference: string };''',
    '''  physicalEntityId?: string | null;\n  whySurfaced?: string | null;\n  whySourceOccurredAt?: string | null;\n  source: { sourceReference: string };''',
)
replace(
    model,
    '''      explanation: item.subtitle,\n      sourceEvidenceReference: item.source.sourceReference,''',
    '''      explanation: item.whySurfaced ?? item.subtitle,\n      sourceEvidenceReference: item.source.sourceReference,\n      sourceOccurredAt: item.whySourceOccurredAt ?? null,''',
)
replace(
    model,
    '''  completedAt: string | null;\n};''',
    '''  completedAt: string | null;\n  /** Human-readable reason/evidence for carried-forward world pressure. */\n  whySurfaced?: string | null;\n  sourceEvidenceReference?: string | null;\n  sourceOccurredAt?: string | null;\n};''',
)
replace(
    model,
    '''      completedAt: objective.status === "completed" ? new Date().toISOString() : null,\n    })),''',
    '''      completedAt: objective.status === "completed" ? new Date().toISOString() : null,\n      whySurfaced: objective.explanation,\n      sourceEvidenceReference: objective.sourceEvidenceReference,\n      sourceOccurredAt: objective.sourceOccurredAt,\n    })),''',
)

dayplan = "client/src/pages/goldline/GoldlineDayPlan.tsx"
replace(
    dayplan,
    '''function shortTime(value: string | null): string | null {\n  if (!value) return null;\n  const parsed = new Date(value);\n  return Number.isNaN(parsed.getTime())\n    ? null\n    : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });\n}\n''',
    '''function shortTime(value: string | null): string | null {\n  if (!value) return null;\n  const parsed = new Date(value);\n  return Number.isNaN(parsed.getTime())\n    ? null\n    : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });\n}\n\nfunction evidenceTime(value: string | null | undefined): string | null {\n  if (!value) return null;\n  const parsed = new Date(value);\n  if (Number.isNaN(parsed.getTime())) return null;\n  return parsed.toLocaleString([], {\n    weekday: "short",\n    month: "short",\n    day: "numeric",\n    hour: "numeric",\n    minute: "2-digit",\n  }).toUpperCase();\n}\n''',
)
replace(
    dayplan,
    '''        <div className="gdp-source">{stop.sourceLabel}</div>\n        {stop.status === "completed" && (''',
    '''        <div className="gdp-source">{stop.sourceLabel}</div>\n        {stop.whySurfaced ? (\n          <details className="gdp-why" data-testid={`why-${stop.id}`}>\n            <summary>WHY IS THIS HERE?</summary>\n            <p>{stop.whySurfaced}</p>\n            <small>\n              {evidenceTime(stop.sourceOccurredAt)\n                ? `${evidenceTime(stop.sourceOccurredAt)} · FIELD EVIDENCE`\n                : "FIELD EVIDENCE"}\n            </small>\n          </details>\n        ) : null}\n        {stop.status === "completed" && (''',
)

# Provenance tests.
future_test = Path("shared/goldlineFuturePressure.test.ts")
text = future_test.read_text()
text = text.replace(
    '''  sourceEvidenceReference: "driver_sales_journals:journal-1",\n};''',
    '''  sourceEvidenceReference: "driver_sales_journals:journal-1",\n  sourceOccurredAt: `${TUESDAY}T15:14:00.000Z`,\n};''',
    1,
)
marker = '''  it("carries the evidence reference on every single item", () => {'''
proof = '''  it("carries the source time so the player can ask why it returned", () => {\n    const items = project(WEDNESDAY).items;\n    expect(items.find(item => item.isObligation)?.sourceOccurredAt).toBe(promise.madeAt);\n    expect(items.find(item => !item.isObligation)?.sourceOccurredAt).toBe(\n      `${TUESDAY}T15:14:00.000Z`\n    );\n  });\n\n'''
if marker not in text:
    raise SystemExit("future pressure test marker missing")
future_test.write_text(text.replace(marker, proof + marker, 1))

day_test = Path("client/src/pages/driver/goldlineDayPlanModel.test.ts")
text = day_test.read_text()
text = text.replace(
    '''  physicalEntityId: null,\n  source: { sourceReference: "customer_recovery_interventions:abc" },''',
    '''  physicalEntityId: null,\n  whySurfaced: null,\n  whySourceOccurredAt: null,\n  source: { sourceReference: "customer_recovery_interventions:abc" },''',
    1,
)
marker = '''  it("carries real objectives into the day the driver actually plays", () => {'''
proof = '''  it("preserves why/provenance for carried-forward pressure", () => {\n    const objective = liveObjectivesFromFieldToday([\n      fieldItem({\n        id: "pressure:1",\n        kind: "reported_opportunity",\n        subtitle: "Fallback subtitle",\n        whySurfaced: "Front desk said she should be back Wednesday — not an appointment.",\n        whySourceOccurredAt: "2026-09-01T22:14:00.000Z",\n        source: { sourceReference: "driver_sales_journals:journal-9" },\n      }),\n    ])[0]!;\n    expect(objective.explanation).toMatch(/not an appointment/);\n    expect(objective.sourceOccurredAt).toBe("2026-09-01T22:14:00.000Z");\n    const stop = buildDayPlanProjection({\n      businessDate: "2026-09-02",\n      liveObjectives: [objective],\n    }).stops[0]!;\n    expect(stop.whySurfaced).toBe(objective.explanation);\n    expect(stop.sourceEvidenceReference).toBe("driver_sales_journals:journal-9");\n  });\n\n'''
if marker not in text:
    raise SystemExit("day plan test marker missing")
day_test.write_text(text.replace(marker, proof + marker, 1))


# Conservative driving-state engine.
Path("client/src/game/session/drivingLikelihood.ts").write_text('''export type DrivingLocationSample = {\n  lat: number;\n  lng: number;\n  accuracyMeters: number;\n  timestampMs: number;\n  speedMetersPerSecond: number | null;\n};\n\nexport type DrivingLikelihoodSnapshot = {\n  likely: boolean;\n  speedMetersPerSecond: number | null;\n  goodSamples: number;\n};\n\nconst MAX_ACCURACY_METERS = 80;\nconst ENTER_SPEED_MPS = 8;\nconst EXIT_SPEED_MPS = 2.5;\nconst ENTER_SAMPLES = 3;\nconst EXIT_SAMPLES = 3;\nconst ENTER_SPAN_MS = 6_000;\nconst EXIT_SPAN_MS = 8_000;\n\nfunction radians(value: number) { return (value * Math.PI) / 180; }\nfunction distanceMeters(a: DrivingLocationSample, b: DrivingLocationSample): number {\n  const earth = 6_371_000;\n  const dLat = radians(b.lat - a.lat);\n  const dLng = radians(b.lng - a.lng);\n  const lat1 = radians(a.lat);\n  const lat2 = radians(b.lat);\n  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;\n  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));\n}\n\nexport class DrivingLikelihoodTracker {\n  private likely = false;\n  private high: Array<{ at: number; speed: number }> = [];\n  private low: Array<{ at: number; speed: number }> = [];\n  private previous: DrivingLocationSample | null = null;\n  private speed: number | null = null;\n\n  ingest(sample: DrivingLocationSample): DrivingLikelihoodSnapshot {\n    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng) ||\n        !Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters <= 0 ||\n        sample.accuracyMeters > MAX_ACCURACY_METERS) return this.snapshot();\n    if (this.previous && sample.timestampMs <= this.previous.timestampMs) return this.snapshot();\n\n    let speed = sample.speedMetersPerSecond != null && Number.isFinite(sample.speedMetersPerSecond)\n      ? Math.max(0, sample.speedMetersPerSecond)\n      : null;\n    if (speed == null && this.previous) {\n      const dt = sample.timestampMs - this.previous.timestampMs;\n      if (dt >= 1_000 && dt <= 20_000 && this.previous.accuracyMeters <= MAX_ACCURACY_METERS) {\n        speed = distanceMeters(this.previous, sample) / (dt / 1000);\n      }\n    }\n    this.previous = sample;\n    this.speed = speed;\n    if (speed == null) return this.snapshot();\n\n    if (!this.likely) {\n      if (speed >= ENTER_SPEED_MPS) {\n        this.high.push({ at: sample.timestampMs, speed });\n        this.high = this.high.filter(item => sample.timestampMs - item.at <= 20_000);\n        const span = this.high.length > 1 ? sample.timestampMs - this.high[0]!.at : 0;\n        if (this.high.length >= ENTER_SAMPLES && span >= ENTER_SPAN_MS) {\n          this.likely = true;\n          this.low = [];\n        }\n      } else this.high = [];\n    } else if (speed <= EXIT_SPEED_MPS) {\n      this.low.push({ at: sample.timestampMs, speed });\n      this.low = this.low.filter(item => sample.timestampMs - item.at <= 25_000);\n      const span = this.low.length > 1 ? sample.timestampMs - this.low[0]!.at : 0;\n      if (this.low.length >= EXIT_SAMPLES && span >= EXIT_SPAN_MS) {\n        this.likely = false;\n        this.high = [];\n      }\n    } else this.low = [];\n    return this.snapshot();\n  }\n\n  snapshot(): DrivingLikelihoodSnapshot {\n    return { likely: this.likely, speedMetersPerSecond: this.speed, goodSamples: this.likely ? this.low.length : this.high.length };\n  }\n}\n''')

Path("client/src/game/session/drivingLikelihood.test.ts").write_text('''import { describe, expect, it } from "vitest";\nimport { DrivingLikelihoodTracker, type DrivingLocationSample } from "./drivingLikelihood";\n\nconst at = (t: number, speed: number | null, lat = 34): DrivingLocationSample => ({\n  lat, lng: -118.3, accuracyMeters: 12, timestampMs: t, speedMetersPerSecond: speed,\n});\n\ndescribe("conservative driving likelihood", () => {\n  it("does not call walking or one speed spike driving", () => {\n    const tracker = new DrivingLikelihoodTracker();\n    tracker.ingest(at(0, 1.4));\n    tracker.ingest(at(4_000, 14));\n    expect(tracker.ingest(at(8_000, 1.1)).likely).toBe(false);\n  });\n  it("requires sustained vehicle speed", () => {\n    const tracker = new DrivingLikelihoodTracker();\n    tracker.ingest(at(0, 10)); tracker.ingest(at(3_500, 12));\n    expect(tracker.ingest(at(7_000, 11)).likely).toBe(true);\n  });\n  it("does not clear driving from a single stoplight sample", () => {\n    const tracker = new DrivingLikelihoodTracker();\n    tracker.ingest(at(0, 10)); tracker.ingest(at(3_500, 12)); tracker.ingest(at(7_000, 11));\n    expect(tracker.ingest(at(9_000, 0)).likely).toBe(true);\n    expect(tracker.ingest(at(11_000, 10)).likely).toBe(true);\n  });\n  it("returns controls after sustained parked speed", () => {\n    const tracker = new DrivingLikelihoodTracker();\n    tracker.ingest(at(0, 10)); tracker.ingest(at(3_500, 12)); tracker.ingest(at(7_000, 11));\n    tracker.ingest(at(10_000, 0)); tracker.ingest(at(14_500, 0));\n    expect(tracker.ingest(at(19_000, 0)).likely).toBe(false);\n  });\n  it("ignores low-quality samples", () => {\n    const tracker = new DrivingLikelihoodTracker();\n    expect(tracker.ingest({ ...at(0, 20), accuracyMeters: 180 }).likely).toBe(false);\n  });\n});\n''')

Path("client/src/game/session/useDrivingLikelihood.ts").write_text('''import { useEffect, useRef, useState } from "react";\nimport { DrivingLikelihoodTracker, type DrivingLikelihoodSnapshot } from "./drivingLikelihood";\n\nexport type DrivingAvailability = "unsupported" | "permission_denied" | "unavailable" | "watching";\n\nexport function useDrivingLikelihood(): { availability: DrivingAvailability; snapshot: DrivingLikelihoodSnapshot } {\n  const trackerRef = useRef(new DrivingLikelihoodTracker());\n  const [availability, setAvailability] = useState<DrivingAvailability>("unavailable");\n  const [snapshot, setSnapshot] = useState(() => trackerRef.current.snapshot());\n  useEffect(() => {\n    if (typeof navigator === "undefined" || !navigator.geolocation) {\n      setAvailability("unsupported");\n      return;\n    }\n    const watchId = navigator.geolocation.watchPosition(\n      position => {\n        setAvailability("watching");\n        setSnapshot(trackerRef.current.ingest({\n          lat: position.coords.latitude, lng: position.coords.longitude,\n          accuracyMeters: position.coords.accuracy, timestampMs: position.timestamp,\n          speedMetersPerSecond: position.coords.speed,\n        }));\n      },\n      error => setAvailability(error.code === error.PERMISSION_DENIED ? "permission_denied" : "unavailable"),\n      { enableHighAccuracy: false, maximumAge: 10_000, timeout: 20_000 }\n    );\n    return () => navigator.geolocation.clearWatch(watchId);\n  }, []);\n  return { availability, snapshot };\n}\n''')

# Driving wiring.
home = "client/src/game/GoldlineGameHome.tsx"
replace(home, '''import { usePhysicalArrival } from "./session/usePhysicalArrival";''', '''import { usePhysicalArrival } from "./session/usePhysicalArrival";\nimport { useDrivingLikelihood } from "./session/useDrivingLikelihood";''')
replace(home, '''  const networkStatus = useNetworkStatus();\n  const sessionIdRef = useRef(getGoldlineSessionId());''', '''  const networkStatus = useNetworkStatus();\n  const driving = useDrivingLikelihood();\n  const drivingLikely = driving.snapshot.likely;\n  const sessionIdRef = useRef(getGoldlineSessionId());''')
replace(home, '''  const enterExpedition = useCallback(() => {\n    if (!preparedObjective) return;''', '''  const enterExpedition = useCallback(() => {\n    if (!preparedObjective || drivingLikely) return;''')
replace(home, '''  }, [preparedObjective, collectedOrderEvidence]);\n\n  const exitExpedition = useCallback(() => {''', '''  }, [preparedObjective, collectedOrderEvidence, drivingLikely]);\n\n  const exitExpedition = useCallback(() => {''')
replace(home, '''  const exitExpedition = useCallback(() => {\n    setActiveExpedition(null);\n    setCargoPhase("idle");\n  }, []);''', '''  const exitExpedition = useCallback(() => {\n    setActiveExpedition(null);\n    setCargoPhase("idle");\n  }, []);\n\n  useEffect(() => {\n    if (!drivingLikely) return;\n    runtimeRef.current?.setInput(0, 0);\n    if (activeExpedition) exitExpedition();\n    setColdCallOpen(false);\n    setScoutOpen(false);\n  }, [drivingLikely, activeExpedition, exitExpedition]);''')
replace(home, '''  function performAction() {\n    // Defense in depth:''', '''  function performAction() {\n    if (drivingLikely) return;\n    // Defense in depth:''')
replace(home, '''      data-expedition-state={''', '''      data-driving-likely={drivingLikely ? "true" : "false"}\n      data-expedition-state={''')
replace(home, '''        <div className="game-atmosphere" aria-hidden="true" />''', '''        <div className="game-atmosphere" aria-hidden="true" />\n        {drivingLikely ? (\n          <div className="driving-safety-shield" role="status" data-testid="driving-safety-shield">\n            <b>TRAVEL IN PROGRESS</b>\n            <span>GOLDLINE IS WATCHING THE ROUTE · CONTROLS RETURN WHEN PARKED</span>\n          </div>\n        ) : null}''')
replace(home, '''              disabled={\n                activeExpedition != null &&\n                expeditionSnapshot.outcome !== "running"\n              }''', '''              disabled={\n                drivingLikely ||\n                (activeExpedition != null &&\n                  expeditionSnapshot.outcome !== "running")\n              }''')
replace(home, '''            runtime={runtimeRef.current}\n            active={activeExpedition != null}\n            onEnter={enterExpedition}''', '''            runtime={runtimeRef.current}\n            active={activeExpedition != null}\n            interactionDisabled={drivingLikely}\n            onEnter={enterExpedition}''')
replace(home, '''              isDriving={false}\n              authoritativeCount''', '''              isDriving={drivingLikely}\n              authoritativeCount''')
replace(home, '''              disabled={\n                !props.coldCallBatch && props.coldCallEligibleCount === 0\n              }''', '''              disabled={\n                drivingLikely ||\n                (!props.coldCallBatch && props.coldCallEligibleCount === 0)\n              }''')

hud = "client/src/game/expedition/ExpeditionHud.tsx"
replace(hud, '''  /** True once the player has explicitly entered the Line. */\n  active: boolean;\n  onEnter: () => void;''', '''  /** True once the player has explicitly entered the Line. */\n  active: boolean;\n  /** Attention-demanding input is unavailable while vehicle travel is likely. */\n  interactionDisabled?: boolean;\n  onEnter: () => void;''')
replace(hud, '''    active,\n    onEnter,''', '''    active,\n    interactionDisabled = false,\n    onEnter,''')
replace(hud, '''          onClick={onEnter}\n        >''', '''          onClick={onEnter}\n          disabled={interactionDisabled}\n        >''')
replace(hud, '''      {terminalState === "running" ? (\n        <div''', '''      {terminalState === "running" && interactionDisabled ? (\n        <p className="expedition-hud__driving" data-testid="expedition-driving-locked">TRAVEL IN PROGRESS · PLAY RESUMES WHEN PARKED</p>\n      ) : null}\n      {terminalState === "running" && !interactionDisabled ? (\n        <div''')

css = Path("client/src/game/goldline-game.css")
css.write_text(css.read_text() + '''\n\n/* Real Workday: passive travel shield; no touch target competes with driving. */\n.driving-safety-shield {\n  position: absolute; z-index: 95; inset: 0; display: grid; align-content: end;\n  justify-items: center; gap: 4px; padding: 24px 18px calc(24px + env(safe-area-inset-bottom));\n  text-align: center; pointer-events: auto;\n  background: linear-gradient(180deg, transparent 55%, rgba(3, 12, 17, 0.82));\n}\n.driving-safety-shield b { font-size: 15px; letter-spacing: .14em; }\n.driving-safety-shield span { font-size: 11px; color: rgba(223,254,255,.78); }\n.expedition-hud__driving { position: absolute; left: 50%; bottom: 22%; transform: translateX(-50%); width: min(82%, 320px); text-align: center; font-size: 12px; letter-spacing: .09em; }\n''')

# Lightweight growth telemetry through existing emitter, never a score.
replace(home, '''  const openChannelGap = detectOpenChannelGap({''', '''  const seenPressureRefs = useRef(new Set<string>());\n  useEffect(() => {\n    for (const item of props.today?.timeline ?? []) {\n      if (item.kind !== "field_commitment" && item.kind !== "reported_opportunity") continue;\n      const ref = item.source.sourceReference;\n      if (seenPressureRefs.current.has(ref)) continue;\n      seenPressureRefs.current.add(ref);\n      emit?.({\n        eventName: "future_pressure_presented",\n        sessionId: sessionIdRef.current,\n        missionId: null,\n        properties: { sessionId: sessionIdRef.current, kind: item.kind, hasPhysicalEntity: Boolean(item.physicalEntityId) },\n      });\n    }\n  }, [props.today?.timeline, emit]);\n\n  const openChannelGap = detectOpenChannelGap({''')
replace(home, '''  function handleSelectRouteStop(stop: AuthoritativeVisitRouteStop) {\n    if (stop.evidenced) return;''', '''  function handleSelectRouteStop(stop: AuthoritativeVisitRouteStop) {\n    if (stop.evidenced) return;\n    emit?.({\n      eventName: "growth_action_opened",\n      sessionId: sessionIdRef.current,\n      missionId: stop.missionId,\n      properties: { sessionId: sessionIdRef.current, actionKind: "commercial_visit" },\n    });''')
