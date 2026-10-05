const PRESIDENT_PROTECTED_PATH_PATTERNS: RegExp[] = [
  /^server\/mitch\//,
  /^shared\/mitch/i,
  /^server\/commercialPipeline\//,
  /^server\/commercialCampaigns\//,
  /^server\/authority\//,
  /^\.env(?:\.|$)/,
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^scripts\/reconcileCommercialPipelineRevenue/i,
];

export function normalizePresidentRepoPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isPresidentProtectedPath(value: string): boolean {
  const normalized = normalizePresidentRepoPath(value);
  return PRESIDENT_PROTECTED_PATH_PATTERNS.some(pattern =>
    pattern.test(normalized)
  );
}

export function isPresidentMitchPath(value: string): boolean {
  const normalized = normalizePresidentRepoPath(value);
  return (
    /^server\/mitch(?:\/|$)/i.test(normalized) ||
    /^shared\/mitch/i.test(normalized)
  );
}
