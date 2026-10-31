import { motion, useReducedMotion } from "framer-motion";
import {
  evaluateMachineRoute,
  junctionAngleDegrees,
  MACHINE_HEIGHT,
  MACHINE_NODES,
  MACHINE_WIDTH,
  rotorAngleDegrees,
} from "./machineGraph";
import type {
  JunctionPosition,
  MachineDialState,
  MachineEngineState,
  MachinePoint,
  RotorOrientation,
} from "./machineTypes";
import styles from "./impossibleMachine.module.css";

interface MachineRailwayProps {
  state: MachineEngineState;
  carriagePos: MachinePoint;
  carriageCarryingKey: boolean;
  carriageBumped: boolean;
  onRotateWest: () => void;
  onRotateEast: () => void;
  onToggleUpperRotor: () => void;
  onToggleLowerRotor: () => void;
  onExamineCenter: () => void;
  hasOpportunity: boolean;
}

/**
 * Authored SVG + layered sprite railway track system in the 1280x720 coordinate space.
 * Tracks physically rotate, align, connect, and disconnect.
 * Never bakes working railway tracks into the static background.
 */
export function MachineRailway({
  state,
  carriagePos,
  carriageCarryingKey,
  carriageBumped,
  onRotateWest,
  onRotateEast,
  onToggleUpperRotor,
  onToggleLowerRotor,
  onExamineCenter,
  hasOpportunity,
}: MachineRailwayProps) {
  const reduce = useReducedMotion();
  const routeEval = evaluateMachineRoute(state);

  const westAngle = junctionAngleDegrees("west", state.westJunction);
  const eastAngle = junctionAngleDegrees("east", state.eastJunction);
  const upperRotorAngle = rotorAngleDegrees(state.upperRotor);
  const lowerRotorAngle = rotorAngleDegrees(state.lowerRotor);

  // Determine which branches are currently energized / continuous
  const upperActive =
    state.dial === "THEN" &&
    !state.keyRetrieved &&
    state.westJunction === "upper" &&
    state.upperRotor === "aligned" &&
    state.eastJunction === "upper";

  const lowerActive =
    state.dial === "NOW" &&
    state.westJunction === "lower" &&
    state.lowerRotor === "aligned" &&
    state.eastJunction === "lower";

  const centerActive =
    state.centerBridgeRestored &&
    state.westJunction === "center" &&
    state.eastJunction === "center";

  const dome = MACHINE_NODES.rook_dome;
  const west = MACHINE_NODES.west_junction;
  const upper = MACHINE_NODES.upper_rotor;
  const center = MACHINE_NODES.center_crossing;
  const lower = MACHINE_NODES.lower_rotor;
  const east = MACHINE_NODES.east_junction;
  const key = MACHINE_NODES.key_station;

  return (
    <div className={styles.railwayLayer} data-testid="machine-railway-layer">
      <svg
        viewBox={`0 0 ${MACHINE_WIDTH} ${MACHINE_HEIGHT}`}
        className={styles.railwaySvg}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="brassRail" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e5c178" />
            <stop offset="50%" stopColor="#b8883b" />
            <stop offset="100%" stopColor="#7c561f" />
          </linearGradient>
          <linearGradient id="activeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffd97d" />
            <stop offset="50%" stopColor="#f7a731" />
            <stop offset="100%" stopColor="#ffd97d" />
          </linearGradient>
          <linearGradient id="mutedRail" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#7a6d5d" />
            <stop offset="100%" stopColor="#4c4237" />
          </linearGradient>
          <filter id="railShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#18110b" floodOpacity="0.55" />
          </filter>
        </defs>

        {/* Sleepers / ties base paths */}
        <g stroke="#4a3828" strokeWidth="18" strokeDasharray="5 13" fill="none" opacity="0.65">
          {/* Dome to West Junction */}
          <path d={`M ${dome.x + 42} ${dome.y} L ${west.x - 52} ${west.y}`} />
          {/* East Junction to Key Station */}
          <path d={`M ${east.x + 52} ${east.y} L ${key.x - 42} ${key.y}`} />
          {/* Upper THEN route */}
          <path
            d={`M ${west.x + 42} ${west.y - 26} Q 490 205 ${upper.x - 56} ${upper.y}`}
            opacity={state.dial === "THEN" && !state.keyRetrieved ? 0.85 : 0.35}
          />
          <path
            d={`M ${upper.x + 56} ${upper.y} Q 790 205 ${east.x - 42} ${east.y - 26}`}
            opacity={state.dial === "THEN" && !state.keyRetrieved ? 0.85 : 0.35}
          />
          {/* Lower NOW route */}
          <path
            d={`M ${west.x + 42} ${west.y + 26} Q 490 540 ${lower.x - 56} ${lower.y}`}
            opacity={state.dial === "NOW" ? 0.85 : 0.35}
          />
          <path
            d={`M ${lower.x + 56} ${lower.y} Q 790 540 ${east.x - 42} ${east.y + 26}`}
            opacity={state.dial === "NOW" ? 0.85 : 0.35}
          />
          {/* Center route left and right stubs */}
          <path d={`M ${west.x + 52} ${west.y} L ${center.x - 78} ${center.y}`} />
          <path d={`M ${center.x + 78} ${center.y} L ${east.x - 52} ${east.y}`} />
        </g>

        {/* Main Fixed Rails */}
        <g filter="url(#railShadow)" fill="none" strokeLinecap="round">
          {/* West Stem: Rook Dome to West Junction */}
          <path
            d={`M ${dome.x + 42} ${dome.y} L ${west.x - 52} ${west.y}`}
            stroke={routeEval.connected ? "url(#activeGlow)" : "url(#brassRail)"}
            strokeWidth="10"
          />
          {/* East Stem: East Junction to Key Station */}
          <path
            d={`M ${east.x + 52} ${east.y} L ${key.x - 42} ${key.y}`}
            stroke={routeEval.connected ? "url(#activeGlow)" : "url(#brassRail)"}
            strokeWidth="10"
          />

          {/* Upper Route (THEN) */}
          <path
            d={`M ${west.x + 42} ${west.y - 26} Q 490 205 ${upper.x - 56} ${upper.y}`}
            stroke={
              upperActive
                ? "url(#activeGlow)"
                : state.dial === "THEN" && !state.keyRetrieved
                  ? "url(#brassRail)"
                  : "url(#mutedRail)"
            }
            strokeWidth="10"
            opacity={state.dial === "THEN" && !state.keyRetrieved ? 1 : 0.45}
          />
          <path
            d={`M ${upper.x + 56} ${upper.y} Q 790 205 ${east.x - 42} ${east.y - 26}`}
            stroke={
              upperActive
                ? "url(#activeGlow)"
                : state.dial === "THEN" && !state.keyRetrieved
                  ? "url(#brassRail)"
                  : "url(#mutedRail)"
            }
            strokeWidth="10"
            opacity={state.dial === "THEN" && !state.keyRetrieved ? 1 : 0.45}
          />

          {/* Upper Return Gate (closes when keyRetrieved is true) */}
          {state.keyRetrieved ? (
            <g data-testid="upper-return-gate-closed">
              <rect
                x={812}
                y={262}
                width="28"
                height="42"
                rx="4"
                fill="#8e2f22"
                stroke="#e5c178"
                strokeWidth="3"
                transform="rotate(-28 826 283)"
              />
              <line
                x1="816"
                y1="273"
                x2="836"
                y2="293"
                stroke="#fbf5e8"
                strokeWidth="3"
              />
            </g>
          ) : null}

          {/* Lower Route (NOW) */}
          <path
            d={`M ${west.x + 42} ${west.y + 26} Q 490 540 ${lower.x - 56} ${lower.y}`}
            stroke={
              lowerActive
                ? "url(#activeGlow)"
                : state.dial === "NOW"
                  ? "url(#brassRail)"
                  : "url(#mutedRail)"
            }
            strokeWidth="10"
            opacity={state.dial === "NOW" ? 1 : 0.45}
          />
          <path
            d={`M ${lower.x + 56} ${lower.y} Q 790 540 ${east.x - 42} ${east.y + 26}`}
            stroke={
              lowerActive
                ? "url(#activeGlow)"
                : state.dial === "NOW"
                  ? "url(#brassRail)"
                  : "url(#mutedRail)"
            }
            strokeWidth="10"
            opacity={state.dial === "NOW" ? 1 : 0.45}
          />

          {/* Center Route Stubs */}
          <path
            d={`M ${west.x + 52} ${west.y} L ${center.x - 78} ${center.y}`}
            stroke={centerActive ? "url(#activeGlow)" : "url(#brassRail)"}
            strokeWidth="10"
          />
          <path
            d={`M ${center.x + 78} ${center.y} L ${east.x - 52} ${east.y}`}
            stroke={centerActive ? "url(#activeGlow)" : "url(#brassRail)"}
            strokeWidth="10"
          />

          {/* Center Crossing Bridge: Broken vs Restored */}
          {state.centerBridgeRestored ? (
            <g data-testid="center-crossing-restored-rails">
              <line
                x1={center.x - 78}
                y1={center.y}
                x2={center.x + 78}
                y2={center.y}
                stroke={centerActive ? "url(#activeGlow)" : "url(#brassRail)"}
                strokeWidth="12"
              />
              <rect
                x={center.x - 46}
                y={center.y - 14}
                width="92"
                height="28"
                rx="6"
                fill="#c98a35"
                stroke="#fff3d1"
                strokeWidth="2.5"
              />
            </g>
          ) : (
            <g data-testid="center-crossing-broken-gap">
              {/* Visibly separated rail ends with physical gap */}
              <line
                x1={center.x - 78}
                y1={center.y - 6}
                x2={center.x - 46}
                y2={center.y - 16}
                stroke="#8e2f22"
                strokeWidth="6"
              />
              <line
                x1={center.x + 78}
                y1={center.y + 6}
                x2={center.x + 46}
                y2={center.y + 16}
                stroke="#8e2f22"
                strokeWidth="6"
              />
            </g>
          )}
        </g>

        {/* Socket indicator pips around junctions */}
        <JunctionSockets cx={west.x} cy={west.y} side="west" activePosition={state.westJunction} />
        <JunctionSockets cx={east.x} cy={east.y} side="east" activePosition={state.eastJunction} />

        {/* Rotating Turntable Disks */}
        {/* West Junction Turntable */}
        <g transform={`translate(${west.x}, ${west.y})`}>
          <circle r="50" fill="#2a2119" stroke="#b8883b" strokeWidth="5" />
          <motion.g
            animate={{ rotate: westAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 18 }}
          >
            <line x1="-46" y1="0" x2="46" y2="0" stroke="url(#brassRail)" strokeWidth="11" strokeLinecap="round" />
            <circle r="11" fill="#c98a35" stroke="#2a2119" strokeWidth="3" />
          </motion.g>
        </g>

        {/* East Junction Turntable */}
        <g transform={`translate(${east.x}, ${east.y})`}>
          <circle r="50" fill="#2a2119" stroke="#b8883b" strokeWidth="5" />
          <motion.g
            animate={{ rotate: eastAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 18 }}
          >
            <line x1="-46" y1="0" x2="46" y2="0" stroke="url(#brassRail)" strokeWidth="11" strokeLinecap="round" />
            <circle r="11" fill="#c98a35" stroke="#2a2119" strokeWidth="3" />
          </motion.g>
        </g>

        {/* Upper Alignment Rotor */}
        <g transform={`translate(${upper.x}, ${upper.y})`}>
          <circle r="52" fill="#231c15" stroke={state.dial === "THEN" ? "#d59b3f" : "#6a5a48"} strokeWidth="5" />
          <motion.g
            animate={{ rotate: upperRotorAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 17 }}
          >
            <line
              x1="-46"
              y1="0"
              x2="46"
              y2="0"
              stroke={upperActive ? "url(#activeGlow)" : "url(#brassRail)"}
              strokeWidth="11"
              strokeLinecap="round"
            />
            <rect x="-12" y="-12" width="24" height="24" rx="5" fill="#b8883b" stroke="#2a2119" strokeWidth="2.5" />
          </motion.g>
        </g>

        {/* Lower Alignment Rotor */}
        <g transform={`translate(${lower.x}, ${lower.y})`}>
          <circle r="52" fill="#231c15" stroke={state.dial === "NOW" ? "#d59b3f" : "#6a5a48"} strokeWidth="5" />
          <motion.g
            animate={{ rotate: lowerRotorAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 17 }}
          >
            <line
              x1="-46"
              y1="0"
              x2="46"
              y2="0"
              stroke={lowerActive ? "url(#activeGlow)" : "url(#brassRail)"}
              strokeWidth="11"
              strokeLinecap="round"
            />
            <polygon points="0,-14 14,0 0,14 -14,0" fill="#c98a35" stroke="#2a2119" strokeWidth="2.5" />
          </motion.g>
        </g>
      </svg>

      {/* Interactive Accessible Controls Overlay (aligned to exact 1280x720 percentage coordinates) */}
      <button
        type="button"
        className={styles.junctionButton}
        style={{ left: `${(west.x / MACHINE_WIDTH) * 100}%`, top: `${(west.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onRotateWest}
        aria-label={`West junction: pointing ${state.westJunction}. Activate to rotate.`}
        data-testid="machine-west-junction"
        data-position={state.westJunction}
      >
        <span className={styles.junctionBadge}>WEST · {state.westJunction.toUpperCase()}</span>
      </button>

      <button
        type="button"
        className={styles.junctionButton}
        style={{ left: `${(east.x / MACHINE_WIDTH) * 100}%`, top: `${(east.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onRotateEast}
        aria-label={`East junction: pointing ${state.eastJunction}. Activate to rotate.`}
        data-testid="machine-east-junction"
        data-position={state.eastJunction}
      >
        <span className={styles.junctionBadge}>EAST · {state.eastJunction.toUpperCase()}</span>
      </button>

      <button
        type="button"
        className={styles.rotorButton}
        style={{ left: `${(upper.x / MACHINE_WIDTH) * 100}%`, top: `${(upper.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onToggleUpperRotor}
        aria-label={`Upper rotor (THEN): ${state.upperRotor}. Activate to align or misalign.`}
        data-testid="machine-upper-rotor"
        data-orientation={state.upperRotor}
      >
        <span className={styles.junctionBadge}>
          THEN ROTOR · {state.upperRotor === "aligned" ? "ALIGNED" : "OFF"}
        </span>
      </button>

      <button
        type="button"
        className={styles.rotorButton}
        style={{ left: `${(lower.x / MACHINE_WIDTH) * 100}%`, top: `${(lower.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onToggleLowerRotor}
        aria-label={`Lower rotor (NOW): ${state.lowerRotor}. Activate to align or misalign.`}
        data-testid="machine-lower-rotor"
        data-orientation={state.lowerRotor}
      >
        <span className={styles.junctionBadge}>
          NOW ROTOR · {state.lowerRotor === "aligned" ? "ALIGNED" : "OFF"}
        </span>
      </button>

      {/* Center Crossing Apparatus / Correspondence Trigger */}
      <button
        type="button"
        className={`${styles.centerCrossingButton} ${state.centerBridgeRestored ? styles.centerCrossingRestored : styles.centerCrossingBroken}`}
        style={{ left: `${(center.x / MACHINE_WIDTH) * 100}%`, top: `${(center.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onExamineCenter}
        aria-label={
          state.centerBridgeRestored
            ? "Central crossing: coupled and restored"
            : hasOpportunity
              ? "Broken central crossing: inspect historical correspondence card"
              : "Broken central crossing: uncoupled mechanical gap"
        }
        data-testid="machine-center-crossing"
        data-restored={state.centerBridgeRestored ? "yes" : "no"}
      >
        {state.centerBridgeRestored ? (
          <img
            src="/assets/first-ten/impossible-machine/effects/brass-coupling.png"
            alt=""
            className={styles.couplingSprite}
            draggable={false}
          />
        ) : hasOpportunity ? (
          <span className={styles.correspondenceCardIcon} data-testid="machine-center-note-icon">
            <span className={styles.correspondenceWaxSeal} />
            <span className={styles.correspondenceLabel}>
              {state.keyRetrieved ? "Inspect Note" : "Folded Note"}
            </span>
          </span>
        ) : (
          <span className={styles.brokenGapBadge}>GAP UNCOUPLED</span>
        )}
      </button>

      {/* Key Station on the Right */}
      <div
        className={styles.keyStation}
        style={{ left: `${(key.x / MACHINE_WIDTH) * 100}%`, top: `${(key.y / MACHINE_HEIGHT) * 100}%` }}
        data-testid="machine-key-station"
        data-has-key={!state.keyRetrieved && !carriageCarryingKey ? "yes" : "no"}
      >
        <div className={styles.keyPedestal} />
        {!state.keyRetrieved && !carriageCarryingKey ? (
          <motion.img
            src="/assets/first-ten/impossible-machine/key.png"
            alt="Small mechanical brass key"
            className={styles.keySprite}
            data-testid="machine-station-key"
            animate={reduce ? {} : { y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
            draggable={false}
          />
        ) : null}
      </div>

      {/* Physical Railway Carriage following exact calculated spline/path coordinates */}
      <motion.div
        className={`${styles.carriageContainer} ${carriageBumped ? styles.carriageBumped : ""}`}
        style={{
          left: `${(carriagePos.x / MACHINE_WIDTH) * 100}%`,
          top: `${(carriagePos.y / MACHINE_HEIGHT) * 100}%`,
        }}
        data-testid="machine-carriage"
        data-carrying-key={carriageCarryingKey ? "yes" : "no"}
      >
        <img
          src="/assets/first-ten/impossible-machine/carriage.png"
          alt="Clockwork railway carriage"
          className={`${styles.carriageSprite} ${state.keyRetrieved ? styles.carriageReturning : ""}`}
          draggable={false}
        />
        {carriageCarryingKey && !state.domeUnlocked ? (
          <img
            src="/assets/first-ten/impossible-machine/key.png"
            alt="Key held by carriage claw"
            className={styles.carriageHeldKey}
            data-testid="machine-carriage-key"
            draggable={false}
          />
        ) : null}
      </motion.div>
    </div>
  );
}

function JunctionSockets({
  cx,
  cy,
  side,
  activePosition,
}: {
  cx: number;
  cy: number;
  side: "west" | "east";
  activePosition: JunctionPosition;
}) {
  const dir = side === "west" ? 1 : -1;
  const sockets: Array<{ pos: JunctionPosition; x: number; y: number }> = [
    { pos: "upper", x: cx + dir * 48, y: cy - 30 },
    { pos: "center", x: cx + dir * 56, y: cy },
    { pos: "lower", x: cx + dir * 48, y: cy + 30 },
  ];
  return (
    <g>
      {sockets.map(s => (
        <circle
          key={s.pos}
          cx={s.x}
          cy={s.y}
          r={activePosition === s.pos ? 6 : 4}
          fill={activePosition === s.pos ? "#ffd97d" : "#5c4b3b"}
          stroke="#1e1712"
          strokeWidth="1.5"
        />
      ))}
    </g>
  );
}
