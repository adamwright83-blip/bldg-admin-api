type Props = {
  value: number;
  unstable?: boolean;
};

export function DriverVerificationCountdown({
  value,
  unstable = true,
}: Props) {
  return (
    <div className={`driver-prep-countdown ${unstable ? "is-unstable" : ""}`}>
      <div className="driver-prep-countdownRing" aria-hidden="true" />
      <div className="driver-prep-countdownValue">{value}</div>
      <p className="driver-prep-countdownLabel">
        DIFFUSION VERIFICATION INITIATED...
        <br />
        STATUS: UNSTABLE
      </p>
    </div>
  );
}
