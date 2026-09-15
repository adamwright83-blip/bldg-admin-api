export const GUMBALL_INBOX_DIRNAME = "Gumball Inbox";
export const GUMBALL_PROCESSED_DIRNAME = "Processed";
export const GUMBALL_PROCESSING_DIRNAME = "Processing";
export const GUMBALL_FAILED_DIRNAME = "Failed";

export type GumballArtifactIdentity = {
  storeId: string;
  from: string;
  to: string;
  artifactId: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const FILE_RE = new RegExp(
  `^gumball-orders_sales-store-([1-9]\\d*)-(\\d{4}-\\d{2}-\\d{2})-(\\d{4}-\\d{2}-\\d{2})-(${UUID})\\.csv$`,
  "i"
);

export function gumballArtifactFilename(identity: GumballArtifactIdentity): string {
  if (!/^[1-9]\d*$/.test(identity.storeId)) throw new Error("Invalid CleanCloud store id.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(identity.from) || !/^\d{4}-\d{2}-\d{2}$/.test(identity.to)) {
    throw new Error("Invalid artifact date range.");
  }
  if (!new RegExp(`^${UUID}$`, "i").test(identity.artifactId)) throw new Error("Invalid artifact id.");
  return `gumball-orders_sales-store-${identity.storeId}-${identity.from}-${identity.to}-${identity.artifactId.toLowerCase()}.csv`;
}

export function parseGumballArtifactFilename(fileName: string): GumballArtifactIdentity | null {
  const match = FILE_RE.exec(fileName);
  if (!match) return null;
  return {
    storeId: match[1]!,
    from: match[2]!,
    to: match[3]!,
    artifactId: match[4]!.toLowerCase(),
  };
}
