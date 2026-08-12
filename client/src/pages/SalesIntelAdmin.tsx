import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  classifySalesIntelInput,
  type SalesIntelSourceArtifact,
} from "@shared/salesIntel";
import {
  SALES_INTEL_ACQUISITION_MODES,
  SALES_INTEL_SOURCE_PLATFORMS,
  SALES_INTEL_SOURCE_REGISTRY_TYPES,
  VALID_ACQUISITION_MODES_BY_TYPE,
  type SalesIntelAcquisitionMode,
  type SalesIntelSourcePlatform,
  type SalesIntelSourceRegistryType,
} from "@shared/salesIntelSourceRegistry";
import {
  describeFrameworkQuality,
  type FrameworkQualitySignals,
} from "@shared/salesIntelQuality";
import "./sales-intel-admin.css";

/**
 * Internal Sales Intel ingestion.
 *
 * Admin-only: every procedure behind this screen requires the platform `admin`
 * role, enforced server-side. Drivers consume the resulting intelligence in
 * the game; they never see or reach this surface.
 *
 * Four things happen here, each its own panel: register/import sources,
 * add one source at a time, review extracted frameworks, and see what the
 * accepted corpus actually covers. Accepted intelligence flows straight to
 * the Armory — there is no publish or send-to-driver step to forget.
 */

const REAL_MANIFEST_EXAMPLE = `[
  {
    "creatorName": "Example Creator",
    "platform": "youtube",
    "canonicalSourceUrl": "https://www.youtube.com/@example",
    "sourceType": "youtube_channel",
    "acquisitionMode": "AUTO_YOUTUBE",
    "verifiedAt": "2026-08-11T00:00:00.000Z",
    "verificationMethod": "manual URL check"
  }
]`;

const STATUS_COPY: Record<
  string,
  { label: string; tone: "ok" | "wait" | "bad" }
> = {
  received: { label: "RECEIVED", tone: "wait" },
  awaiting_content: { label: "CONTENT REQUIRED", tone: "wait" },
  processing: { label: "ANALYZING…", tone: "wait" },
  analyzed: { label: "ANALYZED", tone: "wait" },
  extracted: { label: "IN ARMORY", tone: "ok" },
  failed: { label: "FAILED", tone: "bad" },
};

/** Small, consistent pill for every status/classification signal on this page. */
function Badge({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  return <span className={`si-badge is-${tone}`}>{children}</span>;
}

function StatusPill({ status }: { status: string }) {
  const copy = STATUS_COPY[status] ?? { label: status, tone: "wait" as const };
  const Icon =
    copy.tone === "ok" ? CheckCircle2 : copy.tone === "bad" ? AlertTriangle : Clock;
  return (
    <Badge tone={copy.tone}>
      <Icon className="h-3 w-3" />
      {copy.label}
    </Badge>
  );
}

function inputHint(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const identity = classifySalesIntelInput(trimmed);
  if (!identity) return "Will be ingested as a transcript.";
  if (identity.sourceType === "youtube") {
    return `YouTube video ${identity.externalContentId} — will be analyzed if a video provider is configured.`;
  }
  if (identity.sourceType === "instagram") {
    return `Instagram Reel ${identity.externalContentId} — saved as a source; a transcript is required to extract it.`;
  }
  return "Will be saved as a source URL; a transcript is required to extract it.";
}

/**
 * Shared shell for every primary panel on this page: a readable card with a
 * title, one-line description, and a clear expand/collapse affordance —
 * never a bare row of text indistinguishable from the next one.
 */
function SectionCard({
  icon,
  title,
  description,
  badge,
  open,
  onToggle,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
          ) : null}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold tracking-wide text-foreground">
                {title}
              </span>
              {badge}
            </span>
            <span className="si-hint mt-0.5 block text-sm">{description}</span>
          </span>
        </div>
        <span className="mt-0.5 shrink-0 text-foreground/50">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-border px-5 py-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/60 px-4 py-6 text-center">
      <p className="text-sm font-bold tracking-wide text-foreground">{title}</p>
      <p className="si-hint mt-1 text-sm">{body}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
      {children}
    </label>
  );
}

/**
 * The curated creator/channel watch list — distinct from the ingested-
 * artifact list below. Disabling a source stops future monitoring; it
 * never deletes the artifacts/frameworks that source already produced.
 */
function SourceRegistryPanel({
  open,
  onToggle,
  onJumpToImport,
}: {
  open: boolean;
  onToggle: () => void;
  onJumpToImport: () => void;
}) {
  const utils = trpc.useUtils();
  const [formOpen, setFormOpen] = useState(false);
  const [creatorName, setCreatorName] = useState("");
  const [platform, setPlatform] = useState<SalesIntelSourcePlatform>("youtube");
  const [sourceType, setSourceType] = useState<SalesIntelSourceRegistryType>(
    "youtube_channel"
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [externalChannelId, setExternalChannelId] = useState("");
  const [acquisitionMode, setAcquisitionMode] = useState<SalesIntelAcquisitionMode>(
    "AUTO_YOUTUBE"
  );

  const registry = trpc.system.salesIntel.sourceRegistry.list.useQuery(
    undefined,
    { enabled: open }
  );
  const create = trpc.system.salesIntel.sourceRegistry.create.useMutation();
  const setStatus = trpc.system.salesIntel.sourceRegistry.setStatus.useMutation();
  const checkNow = trpc.system.salesIntel.sourceRegistry.checkNow.useMutation();

  async function refresh() {
    await utils.system.salesIntel.sourceRegistry.list.invalidate();
  }

  function selectSourceType(next: SalesIntelSourceRegistryType) {
    setSourceType(next);
    const allowed = VALID_ACQUISITION_MODES_BY_TYPE[next];
    if (!allowed.includes(acquisitionMode)) setAcquisitionMode(allowed[0]);
  }

  async function handleCreate() {
    if (!creatorName.trim() || !sourceUrl.trim()) return;
    try {
      await create.mutateAsync({
        creatorName: creatorName.trim(),
        platform,
        sourceType,
        sourceUrl: sourceUrl.trim(),
        externalChannelId: externalChannelId.trim() || null,
        acquisitionMode,
      });
      toast.success("Source added to the registry.");
      setCreatorName("");
      setSourceUrl("");
      setExternalChannelId("");
      setFormOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add that source"
      );
    }
  }

  return (
    <SectionCard
      icon={<Radar className="h-4 w-4" />}
      title="A. SOURCE REGISTRY"
      description="The curated creators/channels being monitored — where content comes from, not the content itself."
      badge={
        registry.data?.length ? (
          <span className="si-hint text-xs font-semibold">
            {registry.data.length} source{registry.data.length === 1 ? "" : "s"}
          </span>
        ) : null
      }
      open={open}
      onToggle={onToggle}
    >
      <Button
        variant="secondary"
        className="w-fit"
        onClick={() => setFormOpen(!formOpen)}
      >
        <Plus className="mr-1 h-4 w-4" /> ADD ONE SOURCE MANUALLY
      </Button>

      {formOpen ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4">
          <FieldLabel>Creator name</FieldLabel>
          <Input value={creatorName} onChange={e => setCreatorName(e.target.value)} />
          <FieldLabel>Platform</FieldLabel>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            value={platform}
            onChange={e => setPlatform(e.target.value as SalesIntelSourcePlatform)}
          >
            {SALES_INTEL_SOURCE_PLATFORMS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <FieldLabel>Source type</FieldLabel>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            value={sourceType}
            onChange={e => selectSourceType(e.target.value as SalesIntelSourceRegistryType)}
          >
            {SALES_INTEL_SOURCE_REGISTRY_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <FieldLabel>Source URL</FieldLabel>
          <Input
            value={sourceUrl}
            placeholder="https://www.youtube.com/channel/UC..."
            onChange={e => setSourceUrl(e.target.value)}
          />
          <FieldLabel>Channel ID (optional — required for automatic monitoring)</FieldLabel>
          <Input
            value={externalChannelId}
            placeholder="UC..."
            onChange={e => setExternalChannelId(e.target.value)}
          />
          <FieldLabel>Acquisition mode</FieldLabel>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            value={acquisitionMode}
            onChange={e => setAcquisitionMode(e.target.value as SalesIntelAcquisitionMode)}
          >
            {VALID_ACQUISITION_MODES_BY_TYPE[sourceType].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Button
            className="w-fit"
            onClick={handleCreate}
            disabled={!creatorName.trim() || !sourceUrl.trim() || create.isPending}
          >
            {create.isPending ? "ADDING…" : "ADD"}
          </Button>
        </div>
      ) : null}

      {registry.isLoading ? (
        <p className="si-hint flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading registry…
        </p>
      ) : null}
      {!registry.isLoading && !registry.data?.length ? (
        <EmptyState
          title="NO SOURCES YET"
          body="Import your approved creator list to begin — nothing is pre-populated."
          action={
            <Button size="sm" onClick={onJumpToImport}>
              IMPORT VERIFIED SOURCES
            </Button>
          }
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {registry.data?.map(source => (
          <article
            key={source.id}
            className="rounded-lg border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-sm font-bold text-foreground">
                  {source.creatorName}
                </span>
                <span className="si-hint block text-xs">
                  {source.platform} · {source.sourceType} · {source.acquisitionMode}
                  {source.lastCheckedAt
                    ? ` · last checked ${new Date(source.lastCheckedAt).toLocaleString()}`
                    : " · never checked"}
                </span>
              </span>
              <Badge tone={source.status === "active" ? "ok" : "wait"}>
                {source.status.toUpperCase()}
              </Badge>
            </div>
            <a
              className="mt-2 block truncate text-sm text-primary underline underline-offset-2"
              href={source.canonicalSourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {source.canonicalSourceUrl}
            </a>
            <div className="mt-3 flex flex-wrap gap-2">
              {source.sourceType === "youtube_channel" ||
              source.sourceType === "youtube_playlist" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={checkNow.isPending}
                  onClick={async () => {
                    try {
                      const result = await checkNow.mutateAsync({ id: source.id });
                      toast[result.status === "ok" ? "success" : "error"](result.message);
                      await refresh();
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Check failed"
                      );
                    }
                  }}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> CHECK NOW
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={setStatus.isPending}
                onClick={async () => {
                  await setStatus.mutateAsync({
                    id: source.id,
                    status: source.status === "active" ? "disabled" : "active",
                  });
                  await refresh();
                }}
              >
                {source.status === "active" ? "DISABLE" : "RE-ENABLE"}
              </Button>
            </div>
            <SourceRecentContent sourceId={source.id} />
          </article>
        ))}
      </div>
    </SectionCard>
  );
}

/** Source health observability: what has this source actually produced recently? */
function SourceRecentContent(props: { sourceId: string }) {
  const [open, setOpen] = useState(false);
  const recent = trpc.system.salesIntel.sourceRegistry.recentArtifacts.useQuery(
    { id: props.sourceId },
    { enabled: open }
  );
  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        className="text-xs font-bold uppercase tracking-wider text-primary"
        onClick={() => setOpen(!open)}
      >
        {open ? "HIDE RECENT CONTENT" : "SHOW RECENT CONTENT"}
      </button>
      {open ? (
        recent.data?.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {recent.data.map(artifact => (
              <li key={artifact.id} className="text-sm text-foreground">
                <span className="si-hint mr-1 text-xs font-semibold uppercase">
                  {artifact.status}
                </span>
                {artifact.title ?? artifact.canonicalUrl ?? "Untitled"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="si-hint mt-2 text-sm">Nothing discovered from this source yet.</p>
        )
      ) : null}
    </div>
  );
}

/**
 * Bulk import for a verified-source manifest. Paste a JSON array of manifest
 * entries; PREVIEW classifies every entry (new / already registered /
 * duplicate within this paste / invalid / unsupported) without touching the
 * database, then APPLY inserts only the "new" ones — running the same
 * manifest twice never creates a duplicate registry record.
 */
function SourceImportPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const utils = trpc.useUtils();
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<
    Array<{
      index: number;
      classification: string;
      reason: string;
      entry: { creatorName: string } | null;
    }>
  >([]);
  const previewMutation = trpc.system.salesIntel.sourceRegistry.previewImport.useMutation();
  const applyMutation = trpc.system.salesIntel.sourceRegistry.applyImport.useMutation();

  function parseEntries(): unknown[] | null {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function handlePreview() {
    const entries = parseEntries();
    if (!entries) {
      toast.error("Paste a JSON array of manifest entries — see the format above.");
      return;
    }
    try {
      const result = await previewMutation.mutateAsync({ entries });
      setPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed");
    }
  }

  async function handleApply() {
    const entries = parseEntries();
    if (!entries) return;
    try {
      const result = await applyMutation.mutateAsync({ entries });
      toast.success(
        `${result.imported.length} source${result.imported.length === 1 ? "" : "s"} imported` +
          (result.skipped.length ? `; ${result.skipped.length} skipped.` : ".")
      );
      setPreview([]);
      setRaw("");
      await utils.system.salesIntel.sourceRegistry.list.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    }
  }

  const newCount = preview.filter(p => p.classification === "new").length;
  const grouped = preview.length
    ? (["new", "already_exists", "canonical_duplicate", "invalid", "unsupported"] as const).map(
        classification => ({
          classification,
          items: preview.filter(p => p.classification === classification),
        })
      )
    : [];

  return (
    <SectionCard
      icon={<Download className="h-4 w-4" />}
      title="B. IMPORT VERIFIED SOURCES"
      description="Bulk import approved creator/source records from a verified JSON manifest."
      badge={<span className="si-badge is-ok">BULK · PREVIEW FIRST</span>}
      open={open}
      onToggle={onToggle}
    >
      <p className="si-hint text-sm">
        Use this for a list of approved YouTube channels/videos. Preview first,
        then apply — nothing is written to the registry until you click APPLY.
      </p>

      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">
          FORMAT: JSON MANIFEST
        </p>
        <p className="si-hint mt-1 text-sm">
          A JSON array of entries. Not comma-separated links, not a transcript —
          each entry needs the fields below.
        </p>
        <pre className="si-code mt-3 rounded-md border border-border bg-background p-3 text-foreground">
          {REAL_MANIFEST_EXAMPLE}
        </pre>
      </div>

      <ol className="flex flex-col gap-1 text-sm text-foreground">
        <li><b>STEP 1</b> <span className="si-hint">— Paste your manifest below</span></li>
        <li><b>STEP 2</b> <span className="si-hint">— Click PREVIEW / DRY RUN</span></li>
        <li><b>STEP 3</b> <span className="si-hint">— Review the classification for every entry</span></li>
        <li><b>STEP 4</b> <span className="si-hint">— Click APPLY to import only the NEW entries</span></li>
      </ol>

      <Textarea
        rows={8}
        value={raw}
        placeholder={REAL_MANIFEST_EXAMPLE}
        className="si-code"
        onChange={e => setRaw(e.target.value)}
      />
      <Button
        variant="secondary"
        className="w-fit"
        onClick={handlePreview}
        disabled={previewMutation.isPending}
      >
        {previewMutation.isPending ? "PREVIEWING…" : "STEP 2 — PREVIEW / DRY RUN"}
      </Button>

      {preview.length ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/50 p-4">
          {grouped.map(group =>
            group.items.length ? (
              <div key={group.classification}>
                <Badge tone={group.classification}>
                  {group.classification.replaceAll("_", " ")} · {group.items.length}
                </Badge>
                <ul className="mt-2 flex flex-col gap-1">
                  {group.items.map(item => (
                    <li key={item.index} className="text-sm text-foreground">
                      <b>{item.entry?.creatorName ?? `entry ${item.index}`}</b>
                      <span className="si-hint"> — {item.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
          <Button
            className="w-fit"
            onClick={handleApply}
            disabled={!newCount || applyMutation.isPending}
          >
            {applyMutation.isPending
              ? "IMPORTING…"
              : `STEP 4 — APPLY ${newCount} NEW SOURCE${newCount === 1 ? "" : "S"}`}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}

/**
 * Coverage intelligence — what the accepted corpus actually covers, as
 * counts and factual gaps only. No invented "97% coverage" score anywhere
 * here.
 */
function CoveragePanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const coverage = trpc.system.salesIntel.coverage.useQuery(undefined, { enabled: open });
  const isEmpty = open && coverage.data && coverage.data.totalAcceptedFrameworks === 0;

  return (
    <SectionCard
      title="D. CORPUS COVERAGE"
      description="What the accepted corpus covers today — real counts only, never a percentage."
      open={open}
      onToggle={onToggle}
    >
      {!coverage.data ? (
        <p className="si-hint flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading coverage…
        </p>
      ) : null}
      {isEmpty ? (
        <EmptyState
          title="CORPUS EMPTY"
          body="Accepted frameworks will appear here after review."
        />
      ) : null}
      {coverage.data && !isEmpty ? (
        <>
          <p className="si-hint text-sm">
            {coverage.data.totalAcceptedFrameworks} accepted framework
            {coverage.data.totalAcceptedFrameworks === 1 ? "" : "s"} total.
          </p>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">
              By archetype
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {coverage.data.byArchetype.map(a => (
                <div
                  key={a.archetype}
                  className="rounded-lg border border-border bg-background p-3 text-center"
                >
                  <p className="text-xs font-bold tracking-wide text-foreground">
                    {a.archetype}
                  </p>
                  <p className="mt-1 text-xl font-bold text-foreground">{a.count}</p>
                  <p className="si-hint text-[11px]">
                    {a.armoryReady ? "Armory ready" : "No coverage yet"}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">
              By channel
            </p>
            <ul className="si-hint mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {coverage.data.byChannel.map(c => (
                <li key={c.channel}>
                  <span className="text-foreground">{c.channel}</span>: {c.count}
                </li>
              ))}
            </ul>
          </div>
          {coverage.data.byCreator.length ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                By creator
              </p>
              <ul className="si-hint mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {coverage.data.byCreator.map(c => (
                  <li key={c.creator}>
                    <span className="text-foreground">{c.creator}</span>: {c.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {coverage.data.conflicts.length ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                Preserved disagreement
              </p>
              <ul className="si-hint mt-1 flex flex-col gap-1 text-sm">
                {coverage.data.conflicts.map((c, i) => (
                  <li key={i}>
                    <span className="text-foreground">{c.archetype} · {c.channel}</span>:{" "}
                    {c.responseFamilies
                      .map(rf => `${rf.responseFamily} (${rf.creators.join(", ")})`)
                      .join(" vs. ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  );
}

/**
 * Every framework a human hasn't decided on yet, with explainable quality
 * signals — never an opaque "AI score". Accept/reject here never touches
 * the source's original transcript or another framework's history.
 */
function ReviewQueuePanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const utils = trpc.useUtils();
  const queue = trpc.system.salesIntel.reviewQueue.useQuery(undefined, {
    enabled: open,
  });
  const review = trpc.system.salesIntel.review.useMutation();

  async function decide(frameworkId: string, reviewState: "accepted" | "rejected") {
    try {
      await review.mutateAsync({ frameworkId, reviewState });
      toast.success(reviewState === "accepted" ? "Accepted into the Armory." : "Rejected.");
      await utils.system.salesIntel.reviewQueue.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review action failed");
    }
  }

  return (
    <SectionCard
      icon={<CheckCircle2 className="h-4 w-4" />}
      title="C. REVIEW QUEUE"
      description="Every extracted framework awaiting a human accept/reject decision."
      badge={
        queue.data?.length ? (
          <span className="si-hint text-xs font-semibold">
            {queue.data.length} pending
          </span>
        ) : null
      }
      open={open}
      onToggle={onToggle}
    >
      {queue.isLoading ? (
        <p className="si-hint flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading review queue…
        </p>
      ) : null}
      {!queue.isLoading && !queue.data?.length ? (
        <EmptyState
          title="NO FRAMEWORKS AWAITING REVIEW"
          body="High-confidence extractions are accepted automatically; everything else lands here."
        />
      ) : null}
      <div className="flex flex-col gap-3">
        {queue.data?.map(entry => {
          const hasExactQuote = entry.framework.exampleLanguage.some(
            phrase => phrase.kind === "exact_source_phrase"
          );
          return (
            <article
              key={entry.framework.id}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-foreground">
                    {entry.framework.frameworkName}
                  </span>
                  <span className="si-hint block text-xs">
                    {entry.framework.creatorName} · {entry.framework.archetype} ·{" "}
                    {entry.framework.channel}
                  </span>
                </span>
                <Badge tone={hasExactQuote ? "quote" : "paraphrase"}>
                  {hasExactQuote ? "EXACT QUOTE" : "PARAPHRASE"}
                </Badge>
              </div>
              <p className="mt-2 text-sm italic text-foreground">
                "{entry.framework.exactObjection}"
              </p>
              {entry.source.title || entry.source.canonicalUrl ? (
                <p className="si-hint mt-1 text-sm">
                  {entry.source.title ?? "Source"}
                  {entry.source.publishedAt
                    ? ` · ${new Date(entry.source.publishedAt).toLocaleDateString()}`
                    : ""}
                  {entry.source.canonicalUrl ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        className="text-primary underline underline-offset-2"
                        href={entry.source.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open source
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
              <p className="si-hint mt-1 text-sm">
                {describeFrameworkQuality(entry.quality as FrameworkQualitySignals)}
                {entry.quality.independentSourceSupportCount > 0
                  ? " · related to another accepted framework"
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={review.isPending}
                  onClick={() => decide(entry.framework.id, "accepted")}
                >
                  ACCEPT
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={review.isPending}
                  onClick={() => decide(entry.framework.id, "rejected")}
                >
                  REJECT
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </SectionCard>
  );
}

export default function SalesIntelAdmin() {
  const utils = trpc.useUtils();
  const [openPanel, setOpenPanel] = useState<
    "registry" | "import" | "review" | "coverage" | null
  >(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [contentFor, setContentFor] = useState<SalesIntelSourceArtifact | null>(
    null
  );
  const [supplied, setSupplied] = useState("");

  const sources = trpc.system.salesIntel.sources.useQuery({ limit: 50 });
  const ingest = trpc.system.salesIntel.ingest.useMutation();
  const attach = trpc.system.salesIntel.attachContent.useMutation();
  const reextract = trpc.system.salesIntel.reextract.useMutation();

  function togglePanel(panel: "registry" | "import" | "review" | "coverage") {
    setOpenPanel(current => (current === panel ? null : panel));
  }

  async function refresh() {
    await utils.system.salesIntel.sources.invalidate();
  }

  async function handleAnalyze() {
    if (!sourceInput.trim()) return;
    try {
      const result = await ingest.mutateAsync({
        input: sourceInput.trim(),
        creatorName: creatorName.trim() || null,
      });
      toast[result.outcome === "failed" ? "error" : "success"](result.message);
      setSourceInput("");
      setCreatorName("");
      setComposerOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not ingest that source"
      );
    }
  }

  async function handleAttach() {
    if (!contentFor || !supplied.trim()) return;
    try {
      const result = await attach.mutateAsync({
        sourceArtifactId: contentFor.id,
        transcriptText: supplied.trim(),
        contentKind: "supplied_transcript",
        segments: [],
      });
      toast[result.outcome === "failed" ? "error" : "success"](result.message);
      setContentFor(null);
      setSupplied("");
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not attach that content"
      );
    }
  }

  return (
    <main className="sales-intel-admin min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="si-hint text-xs font-bold uppercase tracking-widest">
              Internal · Sales Intel
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
              Sales Intelligence
            </h1>
            <p className="si-hint mt-2 max-w-2xl text-sm">
              Sourced trainer material becomes Armory intelligence. Import
              sources, analyze content, review frameworks, and track corpus
              coverage. Accepted frameworks reach the driver game
              automatically — there is no separate publish step.
            </p>
          </div>
          <Button className="w-fit shrink-0" onClick={() => setComposerOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> E. ADD SINGLE SOURCE / TRANSCRIPT
          </Button>
        </header>

        <div className="flex flex-col gap-4">
          <SourceRegistryPanel
            open={openPanel === "registry"}
            onToggle={() => togglePanel("registry")}
            onJumpToImport={() => setOpenPanel("import")}
          />
          <SourceImportPanel
            open={openPanel === "import"}
            onToggle={() => togglePanel("import")}
          />
          <ReviewQueuePanel
            open={openPanel === "review"}
            onToggle={() => togglePanel("review")}
          />
          <CoveragePanel
            open={openPanel === "coverage"}
            onToggle={() => togglePanel("coverage")}
          />
        </div>

        {composerOpen ? (
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold tracking-wide text-foreground">
                  ADD SINGLE SOURCE / TRANSCRIPT
                </p>
                <p className="si-hint mt-1 text-sm">
                  Add one URL, transcript, or source artifact for analysis.{" "}
                  <b className="text-foreground">One source per submission</b> —
                  paste a single YouTube URL, a single Instagram Reel URL, or
                  one full transcript. Not a comma-separated list.
                </p>
              </div>
              <button
                onClick={() => setComposerOpen(false)}
                aria-label="Close composer"
                className="text-foreground/50 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <label htmlFor="sales-intel-source">
                <FieldLabel>Source</FieldLabel>
              </label>
              <Textarea
                id="sales-intel-source"
                rows={5}
                value={sourceInput}
                placeholder="Paste ONE YouTube URL, ONE Instagram Reel URL, or ONE transcript"
                onChange={event => setSourceInput(event.target.value)}
              />
              {inputHint(sourceInput) ? (
                <p className="si-hint text-sm">{inputHint(sourceInput)}</p>
              ) : null}
              <label htmlFor="sales-intel-creator" className="mt-2">
                <FieldLabel>Trainer / creator (optional)</FieldLabel>
              </label>
              <Input
                id="sales-intel-creator"
                value={creatorName}
                placeholder="Leave blank if unknown — nothing will be inferred"
                onChange={event => setCreatorName(event.target.value)}
              />
              <Button
                className="mt-1 w-fit"
                onClick={handleAnalyze}
                disabled={!sourceInput.trim() || ingest.isPending}
              >
                {ingest.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> ANALYZING…
                  </>
                ) : (
                  "ANALYZE"
                )}
              </Button>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-foreground/70">
            Ingested source artifacts
          </p>
          {sources.isLoading ? (
            <p className="si-hint flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sources…
            </p>
          ) : null}
          {!sources.isLoading && !sources.data?.length ? (
            <EmptyState
              title="NO SOURCES YET"
              body="The corpus is empty — nothing is shown to drivers that has not been ingested here."
            />
          ) : null}

          {sources.data?.map(source => (
            <article
              key={source.id}
              className="rounded-lg border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-foreground">
                    {source.title ??
                      source.canonicalUrl ??
                      `${source.sourceType} source`}
                  </span>
                  <span className="si-hint block text-xs">
                    {source.creatorName ?? "No creator supplied"}
                    {source.creatorHandle ? ` · ${source.creatorHandle}` : ""}
                  </span>
                </span>
                <StatusPill status={source.status} />
              </div>

              {source.canonicalUrl ? (
                <a
                  className="mt-2 block truncate text-sm text-primary underline underline-offset-2"
                  href={source.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.canonicalUrl}
                </a>
              ) : null}

              {source.failureMessage ? (
                <p className="mt-2 text-sm font-semibold text-destructive">
                  {source.failureMessage}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {source.status === "awaiting_content" ||
                source.status === "failed" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setContentFor(source);
                      setSupplied("");
                    }}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" /> ADD TRANSCRIPT
                  </Button>
                ) : null}
                {source.status === "extracted" || source.status === "analyzed" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={reextract.isPending}
                    onClick={async () => {
                      try {
                        const result = await reextract.mutateAsync({
                          sourceArtifactId: source.id,
                        });
                        toast.success(result.message);
                        await refresh();
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Re-extraction failed"
                        );
                      }
                    }}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> RE-EXTRACT
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </section>

        {contentFor ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setContentFor(null)}
          >
            <section
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={event => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-bold tracking-wide text-foreground">
                  ADD CONTENT
                </p>
                <button
                  onClick={() => setContentFor(null)}
                  aria-label="Close content panel"
                  className="text-foreground/50 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="si-hint mt-2 text-sm">
                {contentFor.canonicalUrl ?? "This source"} is saved. Paste the
                transcript or authorized media text to extract it.
              </p>
              <Textarea
                rows={10}
                value={supplied}
                placeholder="Paste transcript"
                className="mt-3"
                onChange={event => setSupplied(event.target.value)}
              />
              <Button
                className="mt-3 w-fit"
                onClick={handleAttach}
                disabled={!supplied.trim() || attach.isPending}
              >
                {attach.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> EXTRACTING…
                  </>
                ) : (
                  "EXTRACT"
                )}
              </Button>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
