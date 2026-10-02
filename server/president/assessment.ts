import { createHash } from "node:crypto";
import {
  PRESIDENT_SEAT,
  PRESIDENT_STAGE_1_RESULT,
  type PresidentAssessment,
  type PresidentCandidateProject,
  type PresidentEvidenceClaim,
  type PresidentEvidenceSnapshot,
} from "../../shared/presidentContracts";
import type { PresidentAssessmentStore } from "./store";
import { assertEvidenceIntegrity, LAUNCH_OPS_SOURCE } from "./evidence";

const doc = "docs/JOYSTICK-SAAS-LAUNCH-OPS.md";

const claim = (
  kind: PresidentEvidenceClaim["kind"],
  location: string,
  statement: string,
  verified = true
): PresidentEvidenceClaim => ({
  kind,
  sourceId: kind === "UNKNOWN" ? location : doc,
  sourceLocation: kind === "UNKNOWN" ? "unavailable" : location,
  statement,
  verified,
});

const id = (prefix: string, value: string) =>
  `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

export type PresidentGateEvidenceState = "UNMET" | "COMPLETE" | "UNKNOWN";

export type PresidentGateEvidence = {
  heading: string;
  text: string;
  state: PresidentGateEvidenceState;
  unmetStatement?: string;
};

function gateForHeading(heading: string): string | null {
  if (/recovery gate/i.test(heading)) return "recovery";
  if (/stripe activation/i.test(heading)) return "billing";
  if (/retention activation/i.test(heading)) return "retention";
  if (/customer launch canary/i.test(heading)) return "isolation";
  if (/production log gate/i.test(heading)) return "logs";
  return null;
}

function classifyGate(
  gate: string,
  heading: string,
  text: string
): PresidentGateEvidence {
  const explicitComplete =
    /^\s*(?:status|gate status)\s*:\s*(?:complete|completed|passed|satisfied)\b/im.test(
      text
    );
  if (explicitComplete) return { heading, text, state: "COMPLETE" };

  const explicitUnmet =
    /^\s*(?:status|gate status)\s*:\s*(?:unmet|incomplete|blocked|not complete|not completed)\b/im.test(
      text
    );
  if (explicitUnmet) {
    return {
      heading,
      text,
      state: "UNMET",
      unmetStatement: `The inspected "${heading}" section explicitly marks this gate as unmet.`,
    };
  }

  if (gate === "recovery" && /launch is blocked until/i.test(text)) {
    const unmet: string[] = [];
    if (/scheduled volume backups? (?:are )?not configured/i.test(text))
      unmet.push("scheduled volume backups are not configured");
    if (/no restore drill has been proven/i.test(text))
      unmet.push("no restore drill has been proven");
    if (unmet.length) {
      return {
        heading,
        text,
        state: "UNMET",
        unmetStatement: `The inspected launch-operations document states that ${unmet.join(
          " and "
        )}.`,
      };
    }
  }

  if (
    gate === "retention" &&
    /intentionally inert until production configuration is supplied/i.test(text)
  ) {
    return {
      heading,
      text,
      state: "UNMET",
      unmetStatement:
        "The inspected launch-operations document states that the scheduled retention workflow is intentionally inert until production configuration is supplied.",
    };
  }

  return { heading, text, state: "UNKNOWN" };
}

/**
 * Classifies only recognized launch gates. A documented procedure is not proof
 * that the procedure remains incomplete. UNKNOWN therefore fails closed.
 */
export function extractGateStates(
  content: string
): Map<string, PresidentGateEvidence> {
  const result = new Map<string, PresidentGateEvidence>();
  for (const match of content.matchAll(
    /^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm
  )) {
    const heading = match[1];
    const text = match[2].trim();
    const gate = gateForHeading(heading);
    if (!gate) continue;
    result.set(gate, classifyGate(gate, heading, text));
  }
  return result;
}

/**
 * Stage 1 admits a project only from affirmative evidence that a recognized
 * gate is currently unmet. COMPLETE and UNKNOWN both produce no candidate.
 */
export function extractUnmetSections(
  content: string
): Map<string, PresidentGateEvidence & { state: "UNMET"; unmetStatement: string }> {
  const result = new Map<
    string,
    PresidentGateEvidence & { state: "UNMET"; unmetStatement: string }
  >();
  for (const [gate, section] of extractGateStates(content)) {
    if (section.state !== "UNMET" || !section.unmetStatement) continue;
    result.set(gate, {
      ...section,
      state: "UNMET",
      unmetStatement: section.unmetStatement,
    });
  }
  return result;
}

const priorityOrder = [
  "recovery",
  "commercial",
  "privacy",
  "isolation",
  "verification",
];

type Seed = Omit<
  PresidentCandidateProject,
  "id" | "assessmentId" | "rank" | "status"
> & { priority: string };

const pitches: Record<
  string,
  {
    priority: string;
    title: string;
    capability: string;
    build: string;
    afterward: string;
    reason: string;
  }
> = {
  recovery: {
    priority: "recovery",
    title: "Prove production database recovery",
    capability: "restore customer data safely after database loss",
    build:
      "Configure daily backups and record a restore drill on an isolated copy, under Adam's authorization.",
    afterward: "JOYSTICK can demonstrate a tested recovery procedure.",
    reason: "Recovery proof reduces irreversible data-loss risk.",
  },
  billing: {
    priority: "commercial",
    title: "Prove live billing with a controlled canary",
    capability:
      "verify paid signup, provisioning, entitlements, and webhook retry behavior",
    build:
      "Configure the documented live billing path using the currently authorized plan and pricing policy. President does not choose or alter pricing or trial terms.",
    afterward: "JOYSTICK can demonstrate the real paid onboarding path.",
    reason: "Billing proof directly gates commercial operation.",
  },
  retention: {
    priority: "privacy",
    title: "Activate and verify retention safely",
    capability:
      "demonstrate bounded production retention of eligible expired data",
    build:
      "Configure the existing workflow, verify a dry run, then record one human-authorized bounded live run.",
    afterward: "JOYSTICK can demonstrate retention policy enforcement.",
    reason:
      "Retention proof protects privacy through bounded operational activation.",
  },
  isolation: {
    priority: "isolation",
    title: "Run the two-customer isolation launch canary",
    capability:
      "demonstrate reciprocal isolation for independently paid businesses",
    build:
      "Perform the documented Customer A and Customer B access-denial, entitlement, cost-attribution, and log-privacy checks.",
    afterward:
      "JOYSTICK can demonstrate tenant isolation through real paid onboarding.",
    reason:
      "The two-customer canary verifies broad tenant safety after operational prerequisites.",
  },
  logs: {
    priority: "verification",
    title: "Establish production log clearance",
    capability:
      "certify launch logs against schema errors, transcript leakage, and cross-tenant contamination",
    build:
      "Record a bounded read-only log review against the documented failure classes after an authorized launch deployment.",
    afterward:
      "JOYSTICK can support a production readiness claim with log evidence.",
    reason: "Log clearance verifies the deployed launch candidate.",
  },
};

function candidates(snapshot: PresidentEvidenceSnapshot): Seed[] {
  return [
    ...extractUnmetSections(snapshot.sourceContents[LAUNCH_OPS_SOURCE]),
  ].map(([gate, section]) => {
    const pitch = pitches[gate];
    return {
      priority: pitch.priority,
      title: pitch.title,
      missingCapability: `The inspected evidence states JOYSTICK has not yet satisfied the requirement to ${pitch.capability}.`,
      currentGap: section.unmetStatement,
      proposedBuild: pitch.build,
      resultingCapability: pitch.afterward,
      rankReason: pitch.reason,
      evidence: [
        claim("FACT", section.heading, section.unmetStatement),
        claim(
          "INFERENCE",
          section.heading,
          "Verifying this affirmatively unmet documented gate may deserve attention before public launch."
        ),
      ],
      blockers: [
        "Requires Adam's authorization and the documented operational prerequisites.",
      ],
      humanDecisionDependency:
        "Adam controls production operations and the launch decision.",
      status: "PROPOSED_AWAITING_HUMAN_SELECTION",
    };
  });
}

export async function assessPresidentStage1(input: {
  snapshot: PresidentEvidenceSnapshot;
  store: PresidentAssessmentStore;
  now?: () => Date;
}) {
  assertEvidenceIntegrity(input.snapshot);
  const prior = await input.store.findByEvidence(
    input.snapshot.repositorySha,
    input.snapshot.id
  );
  if (prior) return { assessment: prior, reused: true };

  const assessmentId = id(
    "president-assessment",
    `${input.snapshot.repositorySha}:${input.snapshot.id}`
  );
  const at = (input.now ?? (() => new Date()))().toISOString();
  const ranked = candidates(input.snapshot)
    .sort(
      (a, b) =>
        priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
    )
    .map(({ priority: _priority, ...seed }, i) => ({
      ...seed,
      rankReason: `Rank ${i + 1} of the supported menu. ${seed.rankReason}`,
      id: id("president-candidate", `${assessmentId}:${seed.title}`),
      assessmentId,
      rank: i + 1,
      status: "PROPOSED_AWAITING_HUMAN_SELECTION" as const,
    }));

  const assessment: PresidentAssessment = {
    id: assessmentId,
    seat: PRESIDENT_SEAT,
    inspectedRepositorySha: input.snapshot.repositorySha,
    evidenceSnapshotId: input.snapshot.id,
    status: "COMPLETED",
    resultState: PRESIDENT_STAGE_1_RESULT,
    evidenceSourcesAvailable: input.snapshot.availableSources,
    evidenceSourcesUnavailable: input.snapshot.unavailableSources,
    startedAt: at,
    completedAt: at,
    provider: "deterministic-policy",
    model: "president-stage1-v3",
    candidates: ranked,
    executionCount: 0,
  };

  return {
    assessment: await input.store.saveIfAbsent(assessment),
    reused: false,
  };
}
