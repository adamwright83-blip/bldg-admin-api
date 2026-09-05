import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Flame, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import operator from "@/assets/goldline/generated/trailblazer-operator.png";
import {
  lanternPosition,
  scoreLanternStrike,
  type LanternStrike,
} from "./lanternRunModel";
import "./driver-chapter.css";

const LAMPS = [
  { x: 80, y: 265 },
  { x: 212, y: 183 },
  { x: 122, y: 91 },
];

export function LanternRun({ onClose }: { onClose: () => void }) {
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null
  );
  const [strikes, setStrikes] = useState<LanternStrike[]>([]);
  const [running, setRunning] = useState(false);
  const [sound, setSound] = useState(false);
  const [ready, setReady] = useState(true);
  const marker = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const round = useRef(0);
  const pending = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const done = strikes.length === 3;
  const score = strikes.reduce((sum, strike) => sum + strike.points, 0);
  useEffect(() => {
    if (!running || done) return;
    let frame = 0;
    clock.current = performance.now();
    const tick = (now: number) => {
      if (marker.current)
        marker.current.style.left = `${lanternPosition(now - clock.current, round.current) * 100}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, done, strikes.length]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    []
  );
  useEffect(() => {
    if (!strikes.length || done) return;
    const timer = setTimeout(() => {
      pending.current = false;
      setReady(true);
      setRunning(true);
    }, 650);
    return () => clearTimeout(timer);
  }, [strikes.length, done]);

  function strike() {
    if (!running || done || pending.current) return;
    pending.current = true;
    setReady(false);
    const result = scoreLanternStrike(
      lanternPosition(performance.now() - clock.current, round.current)
    );
    round.current += 1;
    setStrikes(current => [...current, result]);
    setRunning(false);
    if (sound) {
      try {
        const context = (audio.current ??= new AudioContext());
        void context.resume();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value =
          result.grade === "PERFECT" ? 880 : result.lit ? 660 : 330;
        gain.gain.setValueAtTime(0.08, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          context.currentTime + 0.3
        );
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.3);
      } catch {
        /* Sound is optional; blocked audio never interrupts play. */
      }
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="chapter-shade" />
        <Dialog.Content
          className="lantern-run"
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (returnFocus?.isConnected) returnFocus.focus();
            else
              document
                .querySelector<HTMLButtonElement>(".gdp-next-up button")
                ?.focus();
          }}
          onKeyDown={event => {
            if (
              event.code === "Space" &&
              event.target === event.currentTarget &&
              !event.repeat
            ) {
              event.preventDefault();
              strike();
            }
          }}
        >
          <header>
            <span>
              <Flame size={16} /> THE LANTERN RUN
            </span>
            <div>
              <button
                onClick={() => setSound(value => !value)}
                aria-label={sound ? "Mute game sound" : "Enable game sound"}
              >
                {sound ? <Volume2 /> : <VolumeX />}
              </button>
              <Dialog.Close aria-label="Close Lantern Run">
                <X />
              </Dialog.Close>
            </div>
          </header>
          <p className="chapter-eyebrow">
            THREE LANTERNS. ONE PERFECT CROSSING.
          </p>
          <Dialog.Title>
            {done
              ? score === 300
                ? "A flawless passage."
                : "The path remembers."
              : "Bring the night to life."}
          </Dialog.Title>
          <Dialog.Description>
            {done
              ? `${strikes.filter(item => item.lit).length} lanterns lit · ${score} / 300 skill points`
              : "Tap LIGHT as the spark crosses the gold zone. Each lantern moves a little faster."}
          </Dialog.Description>
          <svg
            className="lantern-run-world"
            viewBox="0 0 320 350"
            role="img"
            aria-label={`${strikes.filter(item => item.lit).length} of 3 practice lanterns lit`}
          >
            <defs>
              <radialGradient id="lantern-night">
                <stop stopColor="#214d4d" />
                <stop offset="1" stopColor="#071b25" />
              </radialGradient>
              <radialGradient id="lantern-light">
                <stop stopColor="#fff7b7" stopOpacity=".8" />
                <stop offset="1" stopColor="#ffbf37" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="320" height="350" fill="url(#lantern-night)" rx="20" />
            {[24, 70, 118, 174, 241, 294].map((x, i) => (
              <circle
                key={x}
                cx={x}
                cy={24 + ((i * 37) % 210)}
                r={(i % 2) + 1}
                fill="#fff4c9"
                opacity=".5"
              />
            ))}
            <path
              d="M42 350 L80 280 L212 198 L122 106 L162 35"
              fill="none"
              stroke="#051016"
              strokeWidth="50"
              strokeLinejoin="round"
            />
            <path
              d="M42 350 L80 280 L212 198 L122 106 L162 35"
              fill="none"
              stroke="#907b4b"
              strokeWidth="39"
              strokeLinejoin="round"
            />
            <path
              d="M42 350 L80 280 L212 198 L122 106 L162 35"
              fill="none"
              stroke="#233c3a"
              strokeWidth="33"
              strokeLinejoin="round"
            />
            <path
              d="M42 350 L80 280 L212 198 L122 106 L162 35"
              fill="none"
              stroke="#b7a16a"
              strokeWidth="25"
              strokeDasharray="2 10"
            />
            {LAMPS.map((lamp, i) => (
              <g key={i} className={strikes[i]?.lit ? "lantern-is-lit" : ""}>
                {strikes[i]?.lit && (
                  <circle
                    cx={lamp.x}
                    cy={lamp.y - 25}
                    r="57"
                    fill="url(#lantern-light)"
                  />
                )}
                <path
                  d={`M${lamp.x} ${lamp.y + 10}v-48`}
                  stroke="#c1a366"
                  strokeWidth="4"
                />
                <path
                  d={`M${lamp.x - 10} ${lamp.y - 36}h20l-3 22h-14z`}
                  fill={strikes[i]?.lit ? "#ffdc75" : "#284e51"}
                  stroke="#e3c87f"
                  strokeWidth="2"
                />
                <text
                  x={lamp.x + 19}
                  y={lamp.y - 21}
                  fill="#f0d28d"
                  fontSize="12"
                >
                  {i + 1}
                </text>
              </g>
            ))}
            <image
              href={operator}
              x={(LAMPS[Math.min(strikes.length, 2)]?.x ?? 80) - 43}
              y={(LAMPS[Math.min(strikes.length, 2)]?.y ?? 265) - 53}
              width="40"
              height="70"
            />
          </svg>
          <div className="lantern-run-score" aria-live="polite">
            <span>
              {strikes.length
                ? strikes[strikes.length - 1].grade
                : "FIND YOUR RHYTHM"}
            </span>
            <strong>
              {score} <small>PTS</small>
            </strong>
          </div>
          {!done && (
            <div className="lantern-timing" aria-hidden="true">
              <span className="lantern-zone" />
              <span className="lantern-perfect" />
              <div className="lantern-spark" ref={marker} />
            </div>
          )}
          {!running && strikes.length === 0 ? (
            <button
              className="chapter-primary"
              onClick={() => setRunning(true)}
            >
              BEGIN RUN <Flame size={18} />
            </button>
          ) : !done ? (
            <button
              className="chapter-primary"
              disabled={!ready || !running}
              onClick={strike}
            >
              {ready ? `LIGHT LANTERN ${strikes.length + 1}` : "SPARK RELEASED"}
            </button>
          ) : (
            <div className="chapter-actions">
              <button className="chapter-primary" onClick={onClose}>
                BACK TO YOUR DAY
              </button>
              <button
                onClick={() => {
                  round.current = 0;
                  pending.current = false;
                  setReady(true);
                  setStrikes([]);
                  setRunning(true);
                }}
              >
                <RotateCcw size={16} /> AGAIN
              </button>
            </div>
          )}
          <small className="chapter-footnote">
            Practice · skill points stay in this run. Your route and city
            records are unaffected.
          </small>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
