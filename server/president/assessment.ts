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

/** Bounded admission rules interpret requirements within their cited section.
 * Completion declarations suppress admission. Unrecognized wording fails closed.
 */
export function extractUnmetSections(
  content: string
): Map<string, { heading: string; text: string }> {
  const result = new Map<string, { heading: string; text: string }>();
  for (const match of content.matchAll(
    /^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm
  )) {
    const heading = match[1],
      text = match[2].trim();
    if (
      /^\s*(?:status|gate status)\s*:\s*(?:complete|completed|passed|satisfied)\b/im.test(
        text
      )
    )
      continue;
    let gate: string | undefined;
    if (
      /recovery gate/i.test(heading) &&
      /(?:backups? (?:are )?not configured|no restore drill has been proven)/i.test(
        text
      ) &&
      /launch is blocked until/i.test(text)
    )
      gate = "recovery";
    if (
      /stripe activation/i.test(heading) &&
      /before putting the public purchase CTA live/i.test(text) &&
      /complete Checkout/i.test(text) &&
      /live Stripe Product\/Price/i.test(text)
    )
      gate = "billing";
    if (
      /retention activation/i.test(heading) &&
      /intentionally inert until/i.test(text) &&
      /dry_run=true/i.test(text) &&
      /bounded non-dry batch/i.test(text)
    )
      gate = "retention";
    if (
      /customer launch canary/i.test(heading) &&
      /Create Customer A/i.test(text) &&
      /Create Customer B independently/i.test(text) &&
      /Verify A cannot/i.test(text)
    )
      gate = "isolation";
    if (
      /production log gate/i.test(heading) &&
      /Inspect production logs for/i.test(text) &&
      /Do not call launch complete while/i.test(text)
    )
      gate = "logs";
    if (gate) result.set(gate, { heading, text });
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
      "Complete the documented live billing configuration and controlled canary, preserving $49 monthly, $468 annual, card required, and the seven-day trial.",
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
      missingCapability: `This snapshot has no current production verification that JOYSTICK can ${pitch.capability}.`,
      currentGap: `The inspected document establishes the "${section.heading}" gate; current completion remains unverified.`,
      proposedBuild: pitch.build,
      resultingCapability: pitch.afterward,
      rankReason: pitch.reason,
      evidence: [
        claim("FACT", section.heading, section.text),
        claim(
          "INFERENCE",
          section.heading,
          "Verifying this documented gate may deserve attention before public launch. The document alone does not prove current production failure."
        ),
        claim(
          "UNKNOWN",
          "production_runtime",
          "Current production completion is unavailable; missing access is not evidence of failure.",
          false
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
    model: "president-stage1-v2",
    candidates: ranked,
    executionCount: 0,
  };
  return {
    assessment: await input.store.saveIfAbsent(assessment),
    reused: false,
  };
}
