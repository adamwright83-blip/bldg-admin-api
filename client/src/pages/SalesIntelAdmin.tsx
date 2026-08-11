import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plus,
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
