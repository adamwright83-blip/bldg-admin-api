import type { RallyEvent, RallyPowerId, RallyState } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

export type RallyMetricName =
  | "variant"
  | "match_start"
  | "match_end"
  | "time_to_first_score"
  | "first_score_serve_index"
  | "regulation_expired"
  | "sudden_death"
  | "rematch"
  | "matches_per_session"
  | "quit_mid_match"
  | "power_selected"
  | "power_used"
  | "avg_rally_tier"
  | "bash_count"
  | "share_offered"
  | "share_accepted"
  | "session_length";

export type RallyMetricEvent = {
  name: RallyMetricName;
  at: number;
  value?: number | string | boolean;
  detail?: Record<string, unknown>;
};

const STORAGE_KEY = "boreslay-rally-metrics-v2";

export class RallyMetrics {
  private events: RallyMetricEvent[] = [];
  private sessionStartedAt: number;
  private matchStartedAt: number | null = null;
  private firstScoreRecorded = false;
  private serveIndex = 0;
  private matches = 0;
  private rallyTiers: number[] = [];
  private storage?: Storage;
  readonly mode: RallyState["scoringMode"];
  readonly source: "default" | "url";

  constructor(
    mode: RallyState["scoringMode"],
    source: "default" | "url",
    storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
    now = Date.now()
  ) {
    this.mode = mode;
    this.source = source;
    this.storage = storage;
    this.sessionStartedAt = now;
    this.track("variant", mode, { source });
  }

  matchStart() {
    this.matches += 1;
    this.matchStartedAt = Date.now();
    this.firstScoreRecorded = false;
    this.serveIndex = 0;
    this.rallyTiers = [];
    this.track("match_start", this.matches);
    this.track("matches_per_session", this.matches);
  }

  matchEnd(outcome: RallyState["status"]) {
    this.track("match_end", outcome);
    if (this.rallyTiers.length > 0) {
      this.track(
        "avg_rally_tier",
        this.rallyTiers.reduce((sum, tier) => sum + tier, 0) / this.rallyTiers.length
      );
    }
    this.matchStartedAt = null;
  }

  rematch() {
    this.track("rematch", this.matches);
  }

  powerSelected(power: RallyPowerId) {
    this.track("power_selected", power);
  }

  shareOffered() {
    this.track("share_offered", true);
  }

  shareAccepted() {
    this.track("share_accepted", true);
  }

  quitIfActive() {
    if (this.matchStartedAt !== null) this.track("quit_mid_match", true);
    this.track("session_length", Date.now() - this.sessionStartedAt);
  }

  handleEvent(event: RallyEvent, state: RallyState) {
    if (event.type === "serve") this.serveIndex += 1;
    if (event.type === "return") this.rallyTiers.push(event.tier ?? 0);
    if (event.type === "power_cast") this.track("power_used", event.power ?? "unknown");
    if (event.type === "regulation_expired") this.track("regulation_expired", true);
    if (event.type === "sudden_death") this.track("sudden_death", true);
    if (
      !this.firstScoreRecorded &&
      (event.type === "gate_score_for" || event.type === "gate_score_against")
    ) {
      this.firstScoreRecorded = true;
      this.track(
        "time_to_first_score",
        this.matchStartedAt === null ? 0 : Date.now() - this.matchStartedAt
      );
      this.track("first_score_serve_index", this.serveIndex, {
        withinTwoServes: this.serveIndex <= 2,
        mode: state.scoringMode,
      });
    }
    if (event.type === "gate_score_for" && event.banked && state.scoringMode === "buttHybrid") {
      this.track("bash_count", 1);
    }
    if (event.type === "victory" || event.type === "defeat") this.matchEnd(event.type);
  }

  track(name: RallyMetricName, value?: RallyMetricEvent["value"], detail?: Record<string, unknown>) {
    this.events.push({ name, at: Date.now(), value, detail });
    if (this.events.length > RALLY_CONFIG.metrics.maxBufferedEvents) this.events.shift();
    this.persist();
  }

  exportData() {
    return {
      schema: "boreslay-rally-metrics-v2",
      generatedAt: new Date().toISOString(),
      session: {
        mode: this.mode,
        source: this.source,
        matches: this.matches,
        sessionLengthMs: Date.now() - this.sessionStartedAt,
      },
      events: [...this.events],
    };
  }

  private persist() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.exportData()));
    } catch {
      // Metrics are best-effort and never affect play.
    }
  }
}
