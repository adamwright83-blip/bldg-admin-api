import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
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

/**
 * Internal Sales Intel ingestion.
 *
 * Admin-only: every procedure behind this screen requires the platform `admin`
 * role, enforced server-side. Drivers consume the resulting intelligence in
 * the game; they never see or reach this surface.
 *
 * One field, one action. Accepted intelligence flows straight to the Armory —
 * there is no publish or send-to-driver step to forget.
 */

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

function StatusPill({ status }: { status: string }) {
  const copy = STATUS_COPY[status] ?? { label: status, tone: "wait" as const };
  const Icon =
    copy.tone === "ok" ? CheckCircle2 : copy.tone === "bad" ? AlertTriangle : Clock;
  return (
    <span className={`sales-intel-pill is-${copy.tone}`}>
      <Icon className="h-3 w-3" />
      {copy.label}
    </span>
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
 * The curated creator/channel watch list — distinct from the ingested-
 * artifact list below. Disabling a source stops future monitoring; it
 * never deletes the artifacts/frameworks that source already produced.
 */
function SourceRegistryPanel() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
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
    <section className="sales-intel-registry">
      <button
        className="sales-intel-registry-toggle"
        onClick={() => setOpen(!open)}
      >
        <Radar className="h-4 w-4" /> SOURCE REGISTRY {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="sales-intel-registry-body">
          <p className="sales-intel-hint">
            Curated creators/channels to monitor. Disabling a source stops
            future checks — it never deletes what it already produced.
          </p>
          <Button variant="secondary" onClick={() => setFormOpen(!formOpen)}>
            <Plus className="mr-1 h-4 w-4" /> ADD SOURCE
          </Button>

          {formOpen ? (
            <div className="sales-intel-registry-form">
              <label>CREATOR NAME</label>
              <Input value={creatorName} onChange={e => setCreatorName(e.target.value)} />
              <label>PLATFORM</label>
              <select
                value={platform}
                onChange={e => setPlatform(e.target.value as SalesIntelSourcePlatform)}
              >
                {SALES_INTEL_SOURCE_PLATFORMS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <label>SOURCE TYPE</label>
              <select
                value={sourceType}
                onChange={e => selectSourceType(e.target.value as SalesIntelSourceRegistryType)}
              >
                {SALES_INTEL_SOURCE_REGISTRY_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label>SOURCE URL</label>
              <Input
                value={sourceUrl}
                placeholder="https://www.youtube.com/channel/UC..."
                onChange={e => setSourceUrl(e.target.value)}
              />
              <label>CHANNEL ID (optional — required for automatic monitoring)</label>
              <Input
                value={externalChannelId}
                placeholder="UC..."
                onChange={e => setExternalChannelId(e.target.value)}
              />
              <label>ACQUISITION MODE</label>
              <select
                value={acquisitionMode}
                onChange={e => setAcquisitionMode(e.target.value as SalesIntelAcquisitionMode)}
              >
                {VALID_ACQUISITION_MODES_BY_TYPE[sourceType].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Button
                onClick={handleCreate}
                disabled={!creatorName.trim() || !sourceUrl.trim() || create.isPending}
              >
                {create.isPending ? "ADDING…" : "ADD"}
              </Button>
            </div>
          ) : null}

          {registry.isLoading ? (
            <p className="sales-intel-empty">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading registry…
            </p>
          ) : null}
          {!registry.isLoading && !registry.data?.length ? (
            <p className="sales-intel-empty">
              No sources registered yet. Add a real, curated creator/channel
              to begin monitoring — nothing is pre-populated.
            </p>
          ) : null}

          {registry.data?.map(source => (
            <article key={source.id} className="sales-intel-registry-entry">
              <div className="sales-intel-source-head">
                <span>
                  <b>{source.creatorName}</b>
                  <small>
                    {source.sourceType} · {source.acquisitionMode}
                    {source.lastCheckedAt
                      ? ` · last checked ${new Date(source.lastCheckedAt).toLocaleString()}`
                      : " · never checked"}
                  </small>
                </span>
                <span className={`sales-intel-pill is-${source.status === "active" ? "ok" : "wait"}`}>
                  {source.status.toUpperCase()}
                </span>
              </div>
              <a
                className="sales-intel-source-url"
                href={source.canonicalSourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {source.canonicalSourceUrl}
              </a>
              <div className="sales-intel-source-actions">
                {source.sourceType === "youtube_channel" ||
                source.sourceType === "youtube_playlist" ? (
                  <Button
                    variant="secondary"
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
                    <RefreshCw className="mr-1 h-4 w-4" /> CHECK NOW
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
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
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Bulk import for a verified-source manifest (Slice 46). Paste a JSON array
 * of manifest entries; PREVIEW classifies every entry (new / already
 * registered / duplicate within this paste / invalid / unsupported) without
 * touching the database, then APPLY inserts only the "new" ones — running
 * the same manifest twice never creates a duplicate registry record.
 */
function SourceImportPanel() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
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
      toast.error("Paste a JSON array of manifest entries.");
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
      toast.success(`Imported ${result.imported.length} source(s); skipped ${result.skipped.length}.`);
      setPreview([]);
      setRaw("");
      await utils.system.salesIntel.sourceRegistry.list.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    }
  }

  const newCount = preview.filter(p => p.classification === "new").length;

  return (
    <section className="sales-intel-import">
      <button className="sales-intel-registry-toggle" onClick={() => setOpen(!open)}>
        IMPORT VERIFIED SOURCES {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="sales-intel-registry-body">
          <p className="sales-intel-hint">
            Paste a JSON array of verified source entries (creatorName,
            platform, canonicalSourceUrl, sourceType, acquisitionMode,
            verifiedAt, verificationMethod). Preview before applying — only
            real, verified, canonicalizable entries are ever imported.
          </p>
          <Textarea
            rows={8}
            value={raw}
            placeholder='[{"creatorName": "...", "platform": "youtube", "canonicalSourceUrl": "https://www.youtube.com/channel/UC...", "sourceType": "youtube_channel", "acquisitionMode": "AUTO_YOUTUBE", "verifiedAt": "2026-08-11T00:00:00.000Z", "verificationMethod": "manual URL check"}]'
            onChange={e => setRaw(e.target.value)}
          />
          <Button variant="secondary" onClick={handlePreview} disabled={previewMutation.isPending}>
            {previewMutation.isPending ? "PREVIEWING…" : "PREVIEW / DRY RUN"}
          </Button>
          {preview.length ? (
            <>
              <ul className="sales-intel-import-preview">
                {preview.map(item => (
                  <li key={item.index} className={`is-${item.classification}`}>
                    <b>{item.entry?.creatorName ?? `entry ${item.index}`}</b>
                    <span>{item.classification.replaceAll("_", " ").toUpperCase()}</span>
                    <small>{item.reason}</small>
                  </li>
                ))}
              </ul>
              <Button onClick={handleApply} disabled={!newCount || applyMutation.isPending}>
                {applyMutation.isPending ? "IMPORTING…" : `IMPORT ${newCount} NEW SOURCE${newCount === 1 ? "" : "S"}`}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Every framework a human hasn't decided on yet, with explainable quality
 * signals — never an opaque "AI score". Accept/reject here never touches
 * the source's original transcript or another framework's history.
 */
function ReviewQueuePanel() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
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
    <section className="sales-intel-review-queue">
      <button className="sales-intel-registry-toggle" onClick={() => setOpen(!open)}>
        <CheckCircle2 className="h-4 w-4" /> REVIEW QUEUE {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="sales-intel-registry-body">
          {queue.isLoading ? (
            <p className="sales-intel-empty">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading review queue…
            </p>
          ) : null}
          {!queue.isLoading && !queue.data?.length ? (
            <p className="sales-intel-empty">
              Nothing awaiting review. High-confidence extractions are
              accepted automatically; everything else lands here.
            </p>
          ) : null}
          {queue.data?.map(entry => (
            <article key={entry.framework.id} className="sales-intel-registry-entry">
              <div className="sales-intel-source-head">
                <span>
                  <b>{entry.framework.frameworkName}</b>
                  <small>
                    {entry.framework.creatorName} · {entry.framework.archetype} ·{" "}
                    {entry.framework.channel}
                  </small>
                </span>
              </div>
              <p className="sales-intel-hint">"{entry.framework.exactObjection}"</p>
              <p className="sales-intel-hint">
                {describeFrameworkQuality(entry.quality as FrameworkQualitySignals)}
              </p>
              <div className="sales-intel-source-actions">
                <Button
                  disabled={review.isPending}
                  onClick={() => decide(entry.framework.id, "accepted")}
                >
                  ACCEPT
                </Button>
                <Button
                  variant="secondary"
                  disabled={review.isPending}
                  onClick={() => decide(entry.framework.id, "rejected")}
                >
                  REJECT
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function SalesIntelAdmin() {
  const utils = trpc.useUtils();
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
    <main className="sales-intel-admin">
      <header>
        <div>
          <small>INTERNAL · SALES INTEL</small>
          <h1>Sales intelligence corpus</h1>
          <p>
            Sourced trainer material becomes Armory intelligence here. Accepted
            frameworks reach the driver game automatically — there is no
            separate publish step.
          </p>
        </div>
        <Button onClick={() => setComposerOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> ADD SALES INTEL
        </Button>
      </header>

      <SourceRegistryPanel />
      <SourceImportPanel />
      <ReviewQueuePanel />

      {composerOpen ? (
        <section className="sales-intel-composer">
          <div className="sales-intel-composer-head">
            <b>ADD SALES INTEL</b>
            <button
              onClick={() => setComposerOpen(false)}
              aria-label="Close composer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <label htmlFor="sales-intel-source">SOURCE</label>
          <Textarea
            id="sales-intel-source"
            rows={5}
            value={sourceInput}
            placeholder="Paste a YouTube URL, an Instagram Reel URL, or a transcript"
            onChange={event => setSourceInput(event.target.value)}
          />
          {inputHint(sourceInput) ? (
            <p className="sales-intel-hint">{inputHint(sourceInput)}</p>
          ) : null}
          <label htmlFor="sales-intel-creator">
            TRAINER / CREATOR (optional)
          </label>
          <Input
            id="sales-intel-creator"
            value={creatorName}
            placeholder="Leave blank if unknown — nothing will be inferred"
            onChange={event => setCreatorName(event.target.value)}
          />
          <Button
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
        </section>
      ) : null}

      <section className="sales-intel-sources">
        {sources.isLoading ? (
          <p className="sales-intel-empty">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sources…
          </p>
        ) : null}
        {!sources.isLoading && !sources.data?.length ? (
          <p className="sales-intel-empty">
            No sources yet. The corpus is empty — nothing is shown to drivers
            that has not been ingested here.
          </p>
        ) : null}

        {sources.data?.map(source => (
          <article key={source.id} className="sales-intel-source">
            <div className="sales-intel-source-head">
              <span>
                <b>
                  {source.title ??
                    source.canonicalUrl ??
                    `${source.sourceType} source`}
                </b>
                <small>
                  {source.creatorName ?? "No creator supplied"}
                  {source.creatorHandle ? ` · ${source.creatorHandle}` : ""}
                </small>
              </span>
              <StatusPill status={source.status} />
            </div>

            {source.canonicalUrl ? (
              <a
                className="sales-intel-source-url"
                href={source.canonicalUrl}
                target="_blank"
                rel="noreferrer"
              >
                {source.canonicalUrl}
              </a>
            ) : null}

            {source.failureMessage ? (
              <p className="sales-intel-failure">{source.failureMessage}</p>
            ) : null}

            <div className="sales-intel-source-actions">
              {source.status === "awaiting_content" ||
              source.status === "failed" ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setContentFor(source);
                    setSupplied("");
                  }}
                >
                  <FileText className="mr-1 h-4 w-4" /> ADD TRANSCRIPT
                </Button>
              ) : null}
              {source.status === "extracted" || source.status === "analyzed" ? (
                <Button
                  variant="secondary"
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
                  <RefreshCw className="mr-1 h-4 w-4" /> RE-EXTRACT
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {contentFor ? (
        <div
          className="sales-intel-backdrop"
          onClick={() => setContentFor(null)}
        >
          <section onClick={event => event.stopPropagation()}>
            <div className="sales-intel-composer-head">
              <b>ADD CONTENT</b>
              <button
                onClick={() => setContentFor(null)}
                aria-label="Close content panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="sales-intel-hint">
              {contentFor.canonicalUrl ?? "This source"} is saved. Paste the
              transcript or authorized media text to extract it.
            </p>
            <Textarea
              rows={10}
              value={supplied}
              placeholder="Paste transcript"
              onChange={event => setSupplied(event.target.value)}
            />
            <Button
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
    </main>
  );
}
