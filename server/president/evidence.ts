import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PresidentEvidenceSnapshot } from "../../shared/presidentContracts";

const SOURCES = ["docs/JOYSTICK_SYSTEM_MAP.md", "docs/JOYSTICK-SAAS-LAUNCH-OPS.md", "server/_core/posthogServer.ts"] as const;
export async function inspectPresidentEvidence(input: { repositoryRoot: string; repositorySha: string; githubAvailable: boolean; readSource?: (path: string) => Promise<Buffer | string>; productionEvidenceAvailable?: boolean; posthogLiveEvidenceAvailable?: boolean; railwayEvidenceAvailable?: boolean; stripeEvidenceAvailable?: boolean }): Promise<PresidentEvidenceSnapshot> {
  if (!/^[0-9a-f]{40}$/.test(input.repositorySha)) throw new Error("President requires an exact 40-character repository SHA");
  const sourceDigests: Record<string, string> = {};
  for (const path of SOURCES) {
    const content = input.readSource ? await input.readSource(path) : await readFile(resolve(input.repositoryRoot, path));
    sourceDigests[path] = createHash("sha256").update(content).digest("hex");
  }
  const external = { github_pull_request_metadata: input.githubAvailable, posthog_live_product_data: input.posthogLiveEvidenceAvailable ?? false, production_runtime: input.productionEvidenceAvailable ?? false, railway_production: input.railwayEvidenceAvailable ?? false, stripe_live: input.stripeEvidenceAvailable ?? false };
  const availableSources = ["canonical_repository_documents", "current_repository_source", ...Object.entries(external).filter(([, v]) => v).map(([k]) => k)].sort();
  const unavailableSources = Object.entries(external).filter(([, v]) => !v).map(([k]) => k).sort();
  const body = JSON.stringify({ repositorySha: input.repositorySha, sourceDigests, availableSources, unavailableSources });
  return { id: `evidence-${createHash("sha256").update(body).digest("hex")}`, repositorySha: input.repositorySha, availableSources, unavailableSources, sourceDigests };
}
