import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GUMBALL_FAILED_DIRNAME,
  GUMBALL_INBOX_DIRNAME,
  GUMBALL_PROCESSED_DIRNAME,
  GUMBALL_PROCESSING_DIRNAME,
  parseGumballArtifactFilename,
} from "../shared/jawbreakerArtifact";

const DEFAULT_POLL_MS = 5_000;
const HEARTBEAT_MS = 60_000;
const MAX_BYTES = 4_000_000;

class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

const secret = process.env.JAWBREAKER_SHARED_SECRET?.trim() ?? "";
if (!secret) throw new Error("JAWBREAKER_SHARED_SECRET is required.");

const tenantId = process.env.JAWBREAKER_TENANT_ID?.trim() || "default";
const baseUrl = (process.env.JAWBREAKER_GOLDLINE_URL?.trim() || "https://admin.bldg.chat").replace(/\/$/, "");
const inbox = process.env.JAWBREAKER_INBOX?.trim() || path.join(os.homedir(), "Downloads", GUMBALL_INBOX_DIRNAME);
const processingDir = path.join(inbox, GUMBALL_PROCESSING_DIRNAME);
const processedDir = path.join(inbox, GUMBALL_PROCESSED_DIRNAME);
const failedDir = path.join(inbox, GUMBALL_FAILED_DIRNAME);
const pollMs = Math.max(1_000, Number(process.env.JAWBREAKER_POLL_MS || DEFAULT_POLL_MS));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ensureFolders() {
  await Promise.all([
    mkdir(inbox, { recursive: true }),
    mkdir(processingDir, { recursive: true }),
    mkdir(processedDir, { recursive: true }),
    mkdir(failedDir, { recursive: true }),
  ]);
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function moveArchive(source: string, directory: string, fileName: string, digest: string) {
  let target = path.join(directory, fileName);
  if (await exists(target)) {
    const archived = await readFile(target);
    if ((await sha256(archived)) === digest) {
      await unlink(source);
      return target;
    }
    target = path.join(directory, fileName.replace(/\.csv$/i, `-${digest.slice(0, 12)}.csv`));
  }
  await rename(source, target);
  return target;
}

async function tRPCMutation<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl}/api/trpc/system.jawbreaker.${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
    signal: AbortSignal.timeout(120_000),
  });
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new RemoteError(`Goldline returned HTTP ${response.status} without a JSON response.`, response.status);
  }
  if (!response.ok || payload?.error) {
    const message =
      payload?.error?.json?.message ||
      payload?.error?.message ||
      payload?.message ||
      `Goldline rejected the request (${response.status}).`;
    throw new RemoteError(String(message), response.status);
  }
  const value = payload?.result?.data?.json;
  if (value === undefined) throw new RemoteError("Goldline returned an unexpected Jawbreaker response.", response.status);
  return value as T;
}

async function listPending() {
  const names = await readdir(inbox);
  const pending: Array<{ name: string; at: Date }> = [];
  for (const name of names) {
    if (!parseGumballArtifactFilename(name)) continue;
    const file = path.join(inbox, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    pending.push({ name, at: info.mtime });
  }
  return pending.sort((a, b) => a.at.getTime() - b.at.getTime() || a.name.localeCompare(b.name));
}

async function recoverProcessing() {
  const names = await readdir(processingDir);
  for (const name of names) {
    if (!parseGumballArtifactFilename(name)) continue;
    const source = path.join(processingDir, name);
    const target = path.join(inbox, name);
    if (!(await exists(target))) {
      await rename(source, target);
      continue;
    }
    const [a, b] = await Promise.all([readFile(source), readFile(target)]);
    if ((await sha256(a)) === (await sha256(b))) {
      await unlink(source);
      continue;
    }
    const digest = await sha256(a);
    await moveArchive(source, failedDir, name, digest);
    await writeFile(
      path.join(failedDir, `${name}.${digest.slice(0, 12)}.error.txt`),
      "A crash-recovery file had the same artifact identity as a different inbox file. It was quarantined without importing.\n",
      "utf8"
    );
  }
}

function terminalArtifactFailure(error: unknown) {
  if (!(error instanceof RemoteError)) return false;
  if (error.status === 400 || error.status === 409 || error.status === 422) return true;
  // A file whose store can never match this tenant must not block every newer
  // valid artifact in the oldest-first queue. Other authorization/configuration
  // failures remain retryable so a repaired secret/config can recover in place.
  return (
    error.status === 403 &&
    /artifact store does not match (?:this|the) tenant'?s paired cleancloud store/i.test(error.message)
  );
}

async function processOne(name: string) {
  const identity = parseGumballArtifactFilename(name);
  if (!identity) return;
  const source = path.join(inbox, name);
  const claimed = path.join(processingDir, name);
  try {
    await rename(source, claimed);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  let digest = "unknown";
  try {
    const before = await stat(claimed);
    if (!before.isFile() || before.size <= 0 || before.size > MAX_BYTES) {
      throw new RemoteError("Artifact is empty or exceeds the 4 MB Orders (Sales) limit.", 400);
    }
    await sleep(250);
    const after = await stat(claimed);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("Artifact was still changing after it entered the inbox.");
    }

    const bytes = await readFile(claimed);
    digest = await sha256(bytes);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const receipt = await tRPCMutation<Record<string, unknown>>("importArtifact", {
      secret,
      tenantId,
      artifactId: identity.artifactId,
      artifactSha256: digest,
      sourceFileName: name,
      storeId: identity.storeId,
      from: identity.from,
      to: identity.to,
      artifactBase64: bytes.toString("base64"),
    });
    await moveArchive(claimed, processedDir, name, digest);
    console.log(
      `[Jawbreaker] processed ${name}: ${Number(receipt.inserted ?? 0)} new, ${Number(receipt.updated ?? 0)} updated, ${Number(receipt.unchanged ?? 0)} unchanged.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (terminalArtifactFailure(error)) {
      await moveArchive(claimed, failedDir, name, digest === "unknown" ? createHash("sha256").update(name).digest("hex") : digest);
      await writeFile(path.join(failedDir, `${name}.error.txt`), `${message}\n`, "utf8").catch(() => {});
      console.error(`[Jawbreaker] quarantined ${name}: ${message}`);
      return;
    }
    if (await exists(claimed)) await rename(claimed, source).catch(() => {});
    throw error;
  }
}

let lastHeartbeatAt = 0;
let lastHeartbeatSignature = "";
async function heartbeat(pending: Array<{ name: string; at: Date }>) {
  const signature = `${pending.length}:${pending[0]?.name ?? ""}:${pending[0]?.at.toISOString() ?? ""}`;
  const now = Date.now();
  if (signature === lastHeartbeatSignature && now - lastHeartbeatAt < HEARTBEAT_MS) return;
  await tRPCMutation("heartbeat", {
    secret,
    tenantId,
    pendingCount: pending.length,
    oldestPendingName: pending[0]?.name ?? null,
    oldestPendingAt: pending[0]?.at.toISOString() ?? null,
  });
  lastHeartbeatAt = now;
  lastHeartbeatSignature = signature;
}

await ensureFolders();
await recoverProcessing();
console.log(`[Jawbreaker] watching ${inbox}`);

for (;;) {
  try {
    const pending = await listPending();
    await heartbeat(pending).catch(error => {
      console.warn(`[Jawbreaker] heartbeat unavailable: ${error instanceof Error ? error.message : error}`);
    });
    if (!pending.length) {
      await sleep(pollMs);
      continue;
    }
    for (const artifact of pending) {
      try {
        await processOne(artifact.name);
      } catch (error) {
        console.warn(
          `[Jawbreaker] ${artifact.name} remains queued: ${error instanceof Error ? error.message : error}`
        );
        break;
      }
    }
  } catch (error) {
    console.error(`[Jawbreaker] watcher error: ${error instanceof Error ? error.message : error}`);
  }
  await sleep(pollMs);
}
