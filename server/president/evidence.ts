import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { PresidentEvidenceSnapshot } from "../../shared/presidentContracts";
export const LAUNCH_OPS_SOURCE = "docs/JOYSTICK-SAAS-LAUNCH-OPS.md";
export function fingerprintEvidence(
  snapshot: Omit<PresidentEvidenceSnapshot, "id">
): string {
  return `evidence-${createHash("sha256")
    .update(
      JSON.stringify({
        repositorySha: snapshot.repositorySha,
        sourceDigests: snapshot.sourceDigests,
        availableSources: snapshot.availableSources,
        unavailableSources: snapshot.unavailableSources,
      })
    )
    .digest("hex")}`;
}
export async function inspectPresidentEvidence(input: {
  repositoryRoot: string;
  repositorySha: string;
  readSource?: (path: string) => Promise<Buffer | string>;
}): Promise<PresidentEvidenceSnapshot> {
  if (!/^[0-9a-f]{40}$/.test(input.repositorySha))
    throw new Error("President requires an exact repository SHA");
  const read =
    input.readSource ??
    (async (path: string) =>
      execFileSync("git", ["show", `${input.repositorySha}:${path}`], {
        cwd: input.repositoryRoot,
      }));
  const content = String(await read(LAUNCH_OPS_SOURCE));
  const snapshot = {
    repositorySha: input.repositorySha,
    sourceContents: { [LAUNCH_OPS_SOURCE]: content },
    sourceDigests: {
      [LAUNCH_OPS_SOURCE]: createHash("sha256").update(content).digest("hex"),
    },
    availableSources: [LAUNCH_OPS_SOURCE],
    unavailableSources: [
      "posthog_live_product_data",
      "production_runtime",
      "railway_production",
      "stripe_live",
    ],
  };
  return { ...snapshot, id: fingerprintEvidence(snapshot) };
}
export function assertEvidenceIntegrity(
  snapshot: PresidentEvidenceSnapshot
): void {
  for (const [path, digest] of Object.entries(snapshot.sourceDigests)) {
    if (
      createHash("sha256")
        .update(snapshot.sourceContents[path] ?? "")
        .digest("hex") !== digest
    )
      throw new Error("Consumed evidence differs from fingerprinted evidence");
  }
  if (snapshot.id !== fingerprintEvidence(snapshot))
    throw new Error("Invalid evidence snapshot identity");
}
