/**
 * ADD WORK — bringing externally-managed jobs into Goldline.
 *
 * Two first-class paths, not a primary and a fallback:
 *
 *   IMPORT CLEAN CLOUD DAY  — upload driver-app screenshots, review what was
 *                             read, correct it, confirm.
 *   ADD CLEAN CLOUD JOB     — type one in. Customers who text, call, or DM are
 *                             real work that appears in no screenshot.
 *
 * The review step is the whole point of the first path. A vision model reading
 * a competitor's UI will sometimes misread a name or an address, and a
 * confidently wrong address is a driver sent to the wrong building. So nothing
 * extracted is persisted until a human has looked at every row and pressed
 * CONFIRM.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { prepareScreenshotsForExtraction } from "./screenshotTiling";
import { dedupeExtractedJobs } from "./externalJobDedup";
import type {
  ExtractedExternalJob,
  ExternalJobKind,
} from "../../../../shared/externalOperationalOrder";

export type AddExternalWorkSheetProps = {
  open: boolean;
  onClose: () => void;
  onExtract: (images: string[]) => Promise<{
    batchId: string;
    jobs: ExtractedExternalJob[];
    unreadableImageCount: number;
  }>;
  onConfirmImport: (input: {
    batchId: string;
    jobs: ExtractedExternalJob[];
  }) => Promise<unknown>;
  onCreateManual: (job: ExtractedExternalJob) => Promise<unknown>;
};

type Mode = "choose" | "import" | "manual";

const emptyManualJob = (): ExtractedExternalJob => ({
  jobKind: "pickup",
  customerName: "",
  address: null,
  scheduledDate: null,
  windowStart: null,
  windowEnd: null,
  notes: null,
  externalOrderId: null,
});

/** Files must reach the vision path as data URLs. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function AddExternalWorkSheet(props: AddExternalWorkSheetProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import review state
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<ExtractedExternalJob[]>([]);
  const [unreadable, setUnreadable] = useState(0);

  // Manual entry state
  const [manual, setManual] = useState<ExtractedExternalJob>(emptyManualJob);

  if (!props.open) return null;

  const close = () => {
    setMode("choose");
    setBatchId(null);
    setRows([]);
    setUnreadable(0);
    setManual(emptyManualJob());
    setError(null);
    props.onClose();
  };

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const originals = await Promise.all(Array.from(files).map(readAsDataUrl));
      const images = await prepareScreenshotsForExtraction(originals);
      const proposal = await props.onExtract(images);
      const jobs = dedupeExtractedJobs(proposal.jobs);
      setBatchId(proposal.batchId);
      setRows(jobs);
      setUnreadable(proposal.unreadableImageCount);
      if (jobs.length === 0) {
        setError(
          "No jobs could be read from those screenshots. Add one by hand instead."
        );
      }
    } catch {
      setError(
        "Screenshot import failed before review. Try again — Goldline did not classify the screenshot as empty."
      );
    } finally {
      setBusy(false);
    }
  }

  const patch = (index: number, next: Partial<ExtractedExternalJob>) =>
    setRows(current =>
      current.map((row, i) => (i === index ? { ...row, ...next } : row))
    );

  const pickupCount = rows.filter(r => r.jobKind === "pickup").length;
  const dropoffCount = rows.length - pickupCount;

  return createPortal(
    <div
      className="add-external-work"
      role="dialog"
      aria-modal="true"
      aria-label="Add externally managed work"
      data-testid="add-external-work"
      style={{ zIndex: 10000 }}
    >
      <header className="add-external-work__header">
        <span>CLEAN CLOUD</span>
        <button type="button" onClick={close} aria-label="Close">✕</button>
      </header>

      {mode === "choose" ? (
        <div className="add-external-work__choices">
          <button
            type="button"
            data-testid="import-cleancloud-day"
            onClick={() => setMode("import")}
          >
            <b>IMPORT CLEAN CLOUD DAY</b>
            <small>Upload screenshots of today's driver list</small>
          </button>
          <button
            type="button"
            data-testid="add-cleancloud-job"
            onClick={() => setMode("manual")}
          >
            <b>ADD CLEAN CLOUD JOB</b>
            <small>Someone texted, called, or DM'd you</small>
          </button>
        </div>
      ) : null}

      {mode === "import" ? (
        <div className="add-external-work__import">
          {rows.length === 0 ? (
            <label className="add-external-work__upload">
              <span>Upload one or more CleanCloud Driver App screenshots</span>
              <input
                type="file"
                accept="image/*"
                multiple
                data-testid="cleancloud-screenshots"
                disabled={busy}
                onChange={event => void handleFiles(event.target.files)}
              />
              {busy ? <em data-testid="import-reading">READING SCREENSHOTS…</em> : null}
            </label>
          ) : (
            <>
              <p className="add-external-work__summary" data-testid="import-summary">
                {pickupCount} PICKUP{pickupCount === 1 ? "" : "S"} ·{" "}
                {dropoffCount} DELIVER{dropoffCount === 1 ? "Y" : "IES"}
              </p>
              {unreadable > 0 ? (
                <p className="add-external-work__warning" data-testid="import-unreadable">
                  {unreadable} screenshot{unreadable === 1 ? "" : "s"} could not be
                  read. Check nothing is missing before confirming.
                </p>
              ) : null}
              <p className="add-external-work__review-note">
                Check every row. Nothing is saved until you confirm.
              </p>

              <ul className="add-external-work__rows">
                {rows.map((row, index) => (
                  <li key={index} data-testid="extracted-stop">
                    <select
                      aria-label="Job type"
                      value={row.jobKind}
                      onChange={e =>
                        patch(index, {
                          jobKind: e.target.value as ExternalJobKind,
                        })
                      }
                    >
                      <option value="pickup">PICKUP</option>
                      <option value="dropoff">DROPOFF</option>
                    </select>
                    <input
                      aria-label="Customer"
                      value={row.customerName}
                      placeholder="Customer"
                      onChange={e => patch(index, { customerName: e.target.value })}
                    />
                    <input
                      aria-label="Address"
                      value={row.address ?? ""}
                      placeholder="Address or building"
                      onChange={e =>
                        patch(index, { address: e.target.value || null })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${row.customerName || "stop"}`}
                      data-testid="remove-extracted-stop"
                      onClick={() =>
                        setRows(current => current.filter((_, i) => i !== index))
                      }
                    >
                      REMOVE
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="add-external-work__primary"
                data-testid="confirm-stops"
                disabled={
                  busy || rows.length === 0 || rows.some(r => !r.customerName.trim())
                }
                onClick={async () => {
                  if (!batchId) return;
                  setBusy(true);
                  try {
                    await props.onConfirmImport({ batchId, jobs: rows });
                    close();
                  } catch {
                    setError("Could not save those stops.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                CONFIRM STOPS
              </button>
            </>
          )}
        </div>
      ) : null}

      {mode === "manual" ? (
        <div className="add-external-work__manual">
          <select
            aria-label="Job type"
            data-testid="manual-job-kind"
            value={manual.jobKind}
            onChange={e =>
              setManual({ ...manual, jobKind: e.target.value as ExternalJobKind })
            }
          >
            <option value="pickup">PICKUP</option>
            <option value="dropoff">DROPOFF</option>
          </select>
          <input
            aria-label="Customer"
            data-testid="manual-customer"
            placeholder="Customer"
            value={manual.customerName}
            onChange={e => setManual({ ...manual, customerName: e.target.value })}
          />
          <input
            aria-label="Address"
            data-testid="manual-address"
            placeholder="Address or building"
            value={manual.address ?? ""}
            onChange={e =>
              setManual({ ...manual, address: e.target.value || null })
            }
          />
          <input
            aria-label="Date"
            type="date"
            data-testid="manual-date"
            value={manual.scheduledDate ?? ""}
            onChange={e =>
              setManual({ ...manual, scheduledDate: e.target.value || null })
            }
          />
          <div className="add-external-work__window">
            <input
              aria-label="Window start"
              type="time"
              data-testid="manual-window-start"
              value={manual.windowStart ?? ""}
              onChange={e =>
                setManual({ ...manual, windowStart: e.target.value || null })
              }
            />
            <input
              aria-label="Window end"
              type="time"
              data-testid="manual-window-end"
              value={manual.windowEnd ?? ""}
              onChange={e =>
                setManual({ ...manual, windowEnd: e.target.value || null })
              }
            />
          </div>
          <input
            aria-label="Notes"
            data-testid="manual-notes"
            placeholder="Notes"
            value={manual.notes ?? ""}
            onChange={e => setManual({ ...manual, notes: e.target.value || null })}
          />
          <input
            aria-label="CleanCloud reference"
            data-testid="manual-external-ref"
            placeholder="CleanCloud order # (optional)"
            value={manual.externalOrderId ?? ""}
            onChange={e =>
              setManual({ ...manual, externalOrderId: e.target.value || null })
            }
          />
          <button
            type="button"
            className="add-external-work__primary"
            data-testid="save-manual-job"
            disabled={busy || !manual.customerName.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onCreateManual(manual);
                close();
              } catch {
                setError("Could not save that job.");
              } finally {
                setBusy(false);
              }
            }}
          >
            SAVE JOB
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="add-external-work__error" data-testid="add-external-error">
          {error}
        </p>
      ) : null}
    </div>,
    document.body
  );
}
