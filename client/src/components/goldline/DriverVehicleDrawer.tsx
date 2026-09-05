import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, Compass, LockKeyhole, X } from "lucide-react";
import { VehicleCargo, type VehicleCargoItem } from "./VehicleCargo";

/** Presentation only: unlocking never changes vehicle custody. */
export function DriverVehicleDrawer({
  completed,
  total,
  cargo,
}: {
  completed: number;
  total: number;
  cargo?: VehicleCargoItem[];
}) {
  const [open, setOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const progress = total ? Math.round((completed / total) * 100) : 0;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="gdp-vehicle-key"
          aria-label="Unlock vehicle drawer"
          style={{ transform: `translateX(${pull}px) rotate(${pull / 8}deg)` }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            gesture.current = { x: event.clientX, y: event.clientY };
            cancelled.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!gesture.current) return;
            if (Math.abs(event.clientY - gesture.current.y) > 25) {
              cancelled.current = true;
              gesture.current = null;
              setPull(0);
              return;
            }
            setPull(
              Math.min(100, Math.max(0, event.clientX - gesture.current.x))
            );
          }}
          onPointerUp={event => {
            if (gesture.current && event.clientX - gesture.current.x >= 48) {
              cancelled.current = true;
              setOpen(true);
            }
            gesture.current = null;
            setPull(0);
          }}
          onPointerCancel={() => {
            cancelled.current = true;
            gesture.current = null;
            setPull(0);
          }}
          onClick={event => {
            if (cancelled.current && event.detail !== 0) event.preventDefault();
            cancelled.current = false;
          }}
        >
          <svg viewBox="0 0 90 120" aria-hidden="true">
            <defs>
              <linearGradient id="key-metal" x2="1" y2="1">
                <stop stopColor="#fff0b4" />
                <stop offset=".5" stopColor="#a77c37" />
                <stop offset="1" stopColor="#efcf83" />
              </linearGradient>
              <linearGradient id="key-body" x2="1" y2="1">
                <stop stopColor="#455658" />
                <stop offset=".5" stopColor="#0c171b" />
                <stop offset="1" stopColor="#23383b" />
              </linearGradient>
            </defs>
            <ellipse
              cx="45"
              cy="17"
              rx="15"
              ry="12"
              fill="none"
              stroke="url(#key-metal)"
              strokeWidth="5"
            />
            <path
              d="M24 27 Q45 17 66 27 L73 88 Q71 104 45 107 Q19 104 17 88Z"
              fill="url(#key-body)"
              stroke="url(#key-metal)"
              strokeWidth="3"
            />
            <path
              d="M26 32 Q45 25 64 32 L67 80 Q45 88 23 80Z"
              fill="#233638"
              stroke="#64706b"
            />
            <path
              d="m29 58 5-13q12-6 22 0l7 13v13h-6v-5H34v5h-6z"
              fill="none"
              stroke="#e7d5a0"
              strokeWidth="2"
            />
            <path
              d="M32 56h27M35 61h3m14 0h4"
              stroke="#e7d5a0"
              strokeWidth="2"
            />
            <text
              x="45"
              y="95"
              textAnchor="middle"
              fill="#e7d5a0"
              fontSize="7"
              letterSpacing="1.5"
            >
              PRIUS
            </text>
          </svg>
          <span>
            UNLOCK <ChevronRight />
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="gdp-garage-overlay" />
        <Dialog.Content className="gdp-garage">
          <header className="gdp-garage-header">
            <div>
              <span>
                <LockKeyhole size={13} /> VEHICLE UNLOCKED
              </span>
              <Dialog.Title>Your mobile base.</Dialog.Title>
            </div>
            <Dialog.Close aria-label="Lock vehicle drawer">
              <X />
            </Dialog.Close>
          </header>
          <Dialog.Description className="gdp-garage-description">
            Your hustle above. Your cargo below.
          </Dialog.Description>
          <section className="gdp-hustler" aria-label="Hustler meter">
            <div className="gdp-hustler-heading">
              <Compass />
              <div>
                <span>TODAY’S MOMENTUM</span>
                <h2>HUSTLER METER</h2>
              </div>
              <strong>
                {progress}
                <small>%</small>
              </strong>
            </div>
            <div
              className="gdp-hustler-track"
              role="progressbar"
              aria-label="Stops completed"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-valuetext={`${completed} of ${total} stops complete`}
            >
              <i style={{ width: `${progress}%` }} />
            </div>
            <p>
              <strong>
                {completed} / {total}
              </strong>{" "}
              stops complete{" "}
              <span>
                {total && completed === total
                  ? "LINE COMPLETE"
                  : completed
                    ? "KEEP IT MOVING"
                    : "YOUR DAY AWAITS"}
              </span>
            </p>
          </section>
          <div className="gdp-garage-vehicle">
            <VehicleCargo mode="hero" fixtureCargo={cargo} />
          </div>
          <p className="gdp-garage-hint">
            Tap the vehicle to inspect cargo & handoffs.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
