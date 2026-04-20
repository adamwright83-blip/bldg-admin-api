import { FileImage, Upload } from "lucide-react";

type Props = {
  title: string;
  subtitle: string;
  statusLabel: string;
  previewDataUrl: string | null;
  actionLabel: string;
  disabled?: boolean;
  onPick: () => void;
};

export function DriverProofUpload({
  title,
  subtitle,
  statusLabel,
  previewDataUrl,
  actionLabel,
  disabled,
  onPick,
}: Props) {
  return (
    <div className="driver-prep-proofSurface">
      <div className="driver-prep-proofFrame">
        {previewDataUrl ? (
          <img
            src={previewDataUrl}
            alt={title}
            className="driver-prep-proofPreview"
          />
        ) : (
          <div className="driver-prep-proofPlaceholder">
            <FileImage className="driver-prep-proofIcon" />
            <span>{title}</span>
          </div>
        )}
      </div>

      <div className="driver-prep-proofMeta">
        <p className="driver-prep-proofTitle">{title}</p>
        <p className="driver-prep-proofSubtitle">{subtitle}</p>
        <p className="driver-prep-proofStatus">{statusLabel}</p>
      </div>

      <button
        type="button"
        className="driver-prep-actionBar"
        disabled={disabled}
        onClick={onPick}
      >
        <Upload className="driver-prep-actionIcon" />
        {actionLabel}
      </button>
    </div>
  );
}
