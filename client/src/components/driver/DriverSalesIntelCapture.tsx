import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { canonicalizeInstagramUrl } from "@shared/salesIntel";
import "./driver-sales-intel-capture.css";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export function DriverSalesIntelCapture({
  initialUrl = "",
  shareLaunch = false,
  onClose,
}: {
  initialUrl?: string;
  shareLaunch?: boolean;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const capture = trpc.system.salesIntelCapture.captureInstagram.useMutation();
  const retry = trpc.system.salesIntelCapture.retry.useMutation();
  const status = trpc.system.salesIntelCapture.status.useQuery(
    { sourceArtifactId: artifactId ?? EMPTY_UUID },
    {
      enabled: Boolean(artifactId),
      refetchInterval: artifactId ? 3_000 : false,
      retry: false,
    }
  );

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  const canonical = useMemo(() => canonicalizeInstagramUrl(url), [url]);
  const isBusy = capture.isPending || retry.isPending;
  const state = status.data;

  async function handleCapture() {
    if (!canonical || isBusy) return;
    setReceiptMessage(null);
    try {
      // Send the canonical /reel/<shortcode>/ URL, not Instagram's tracking or
      // /share/reel variant. This also prevents a path segment like "share"
      // from being mis-recorded as a creator handle.
      const result = await capture.mutateAsync({
        reelUrl: canonical.canonicalUrl,
      });
      setArtifactId(result.artifactId);
      setReceiptMessage(result.message);
      // A Web Share Target launch should not remain in browser history with a
      // stale share payload that would reopen the sheet on every refresh.
      window.history.replaceState({}, "", "/driver");
    } catch (error) {
      setReceiptMessage(
        error instanceof Error ? error.message : "Could not capture this Reel."
      );
    }
  }

  async function handleRetry() {
    if (!artifactId || isBusy) return;
    await retry.mutateAsync({ sourceArtifactId: artifactId });
    void status.refetch();
  }

  const statusCopy = (() => {
    if (!state) return null;
    if (state.status === "processing") return "Analyzing the Reel in the background…";
    if (state.transcriptReady && state.teachingCount > 0) {
      return `${state.teachingCount} teaching candidate${state.teachingCount === 1 ? "" : "s"} ready for human review.`;
    }
    if (state.transcriptReady) {
      return "Reel analyzed. No general teaching candidate has been extracted yet.";
    }
    if (state.status === "awaiting_content") {
      return state.failureMessage ?? "Captured. Waiting for media processing.";
    }
    if (state.status === "failed") {
      return state.failureMessage ?? "Processing failed. The source is still saved.";
    }
    return "Captured. Processing continues from the saved source.";
  })();

  return (
    <div className="driver-intel-backdrop" role="presentation" onClick={onClose}>
      <section
        className="driver-intel-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Capture Sales Intel"
        onClick={event => event.stopPropagation()}
      >
        <header>
          <div>
            <small>GOLDLINE · FIELD INTEL</small>
            <h2>Capture Sales Intel</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close capture">
            <X />
          </button>
        </header>

        <p className="driver-intel-lead">
          Share a public Instagram Reel to Goldline or paste its link here. The
          source is saved first; transcription and extraction happen after that.
        </p>

        {shareLaunch && !initialUrl ? (
          <p className="driver-intel-warning">
            Instagram opened Goldline but did not pass a usable Reel URL. Paste
            the Reel link below.
          </p>
        ) : null}

        <label className="driver-intel-input">
          <span>INSTAGRAM REEL URL</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder="https://www.instagram.com/reel/.../"
            autoFocus
          />
        </label>

        {url.trim() && !canonical ? (
          <p className="driver-intel-error">Enter a valid Instagram Reel URL.</p>
        ) : null}

        <button
          type="button"
          className="driver-intel-primary"
          disabled={!canonical || isBusy}
          onClick={() => void handleCapture()}
        >
          {capture.isPending ? <Loader2 className="is-spinning" /> : <ExternalLink />}
          {capture.isPending ? "CAPTURING…" : "CAPTURE REEL"}
        </button>

        {receiptMessage ? (
          <div className="driver-intel-receipt" role="status" aria-live="polite">
            <Check />
            <div>
              <strong>{receiptMessage}</strong>
              {statusCopy ? <span>{statusCopy}</span> : null}
            </div>
          </div>
        ) : null}

        {state?.failureRetryable && artifactId ? (
          <button
            type="button"
            className="driver-intel-retry"
            disabled={retry.isPending}
            onClick={() => void handleRetry()}
          >
            {retry.isPending ? <Loader2 className="is-spinning" /> : <RotateCcw />}
            RETRY PROCESSING
          </button>
        ) : null}

        <p className="driver-intel-footnote">
          Nothing is auto-accepted into the corpus. Extracted teaching stays in
          human review until an admin accepts it.
        </p>
      </section>
    </div>
  );
}
