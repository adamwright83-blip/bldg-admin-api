import type { SweepState } from "./driverPrepMachine";

type Props = {
  sweep: SweepState;
  disabled?: boolean;
  onSelectCell: (index: number) => void;
};

export function DriverMinesweeper({ sweep, disabled, onSelectCell }: Props) {
  return (
    <div className="driver-prep-boardShell">
      <div className="driver-prep-board">
        {Array.from({ length: 25 }).map((_, index) => {
          const isSelected = sweep.selectedIndex === index;
          const isRevealed = sweep.preRevealed.includes(index);
          const isExplosion = isSelected && sweep.resolution === "explosion";
          const isWinning = isSelected && sweep.resolution === "safe";
          const classes = [
            "driver-prep-boardCell",
            isRevealed ? "is-revealed" : "",
            isWinning ? "is-winning" : "",
            isExplosion ? "is-explosion" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={`${sweep.boardSeed}-${index}`}
              type="button"
              className={classes}
              disabled={disabled || sweep.selectedIndex !== null}
              onClick={() => onSelectCell(index)}
            >
              <span className="driver-prep-boardCellValue">
                {isExplosion ? "X" : index + 1}
              </span>
              {isRevealed ? <span className="driver-prep-boardCheck">✓</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
