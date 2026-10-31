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
  MachineEngineState,
  MachinePoint,
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
 * Model track renderer: draws authentic Victorian miniature model railway tracks
 * featuring weathered dark oak sleepers, brass tie plates, parallel double rails,
 * and molten gold conduction glow when energized.
 */
function ModelTrackSection({
  d,
  active,
  dormant = false,
}: {
  d: string;
  active: boolean;
  dormant?: boolean;
}) {
  return (
    <g fill="none">
      {/* 1. Recessed track bed channel carved into enamel chassis */}
      <path
        d={d}
        stroke="#140d08"
        strokeWidth="28"
        strokeLinecap="round"
        opacity="0.32"
        filter="url(#railShadow)"
      />

      {/* 2. Weathered dark walnut wooden cross-ties (sleepers) */}
      <path
        d={d}
        stroke="#2d2015"
        strokeWidth="24"
        strokeDasharray="6 14"
        strokeLinecap="butt"
      />
      {/* Wood grain highlight on ties */}
      <path
        d={d}
        stroke="#483523"
        strokeWidth="22"
        strokeDasharray="3 17"
        strokeDashoffset="1.5"
        strokeLinecap="butt"
      />
      {/* Brass tie chair-plates holding rails down */}
      <path
        d={d}
        stroke="#805e26"
        strokeWidth="16"
        strokeDasharray="2 18"
        strokeDashoffset="2"
        strokeLinecap="butt"
        opacity="0.8"
      />

      {/* 3. Outer + Inner Twin Brass Rails Base */}
      <path
        d={d}
        stroke="#1a110a"
        strokeWidth="15"
        strokeLinecap="round"
      />

      {/* 4. The Brass Rails (Twin 3.5px rails created by outer brass stroke + dark center groove) */}
      <path
        d={d}
        stroke={active ? "url(#activeGlow)" : dormant ? "url(#mutedRail)" : "url(#brassRail)"}
        strokeWidth="13"
        strokeLinecap="round"
        filter={active ? "url(#conductionGlow)" : "url(#railShadow)"}
      />

      {/* 5. Center gap between the twin rails */}
      <path
        d={d}
        stroke="#23180f"
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* 6. Polished Metallic Crown Gleam on rails */}
      {active ? (
        <path
          d={d}
          stroke="#fffde8"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.9"
        />
      ) : (
        <path
          d={d}
          stroke="url(#railCrownGleam)"
          strokeWidth="1"
          strokeLinecap="round"
          opacity={dormant ? 0.25 : 0.65}
        />
      )}
    </g>
  );
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

  // Track Path Coordinates
  const domeStemPath = `M ${dome.x + 42} ${dome.y} L ${west.x - 52} ${west.y}`;
  const eastStemPath = `M ${east.x + 52} ${east.y} L ${key.x - 42} ${key.y}`;
  const upperWestPath = `M ${west.x + 42} ${west.y - 26} Q 490 205 ${upper.x - 56} ${upper.y}`;
  const upperEastPath = `M ${upper.x + 56} ${upper.y} Q 790 205 ${east.x - 42} ${east.y - 26}`;
  const lowerWestPath = `M ${west.x + 42} ${west.y + 26} Q 490 540 ${lower.x - 56} ${lower.y}`;
  const lowerEastPath = `M ${lower.x + 56} ${lower.y} Q 790 540 ${east.x - 42} ${east.y + 26}`;
  const centerWestPath = `M ${west.x + 52} ${west.y} L ${center.x - 78} ${center.y}`;
  const centerEastPath = `M ${center.x + 78} ${center.y} L ${east.x - 52} ${east.y}`;

  return (
    <div className={styles.railwayLayer} data-testid="machine-railway-layer">
      <svg
        viewBox={`0 0 ${MACHINE_WIDTH} ${MACHINE_HEIGHT}`}
        className={styles.railwaySvg}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="brassRail" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f7dc99" />
            <stop offset="40%" stopColor="#c8963e" />
            <stop offset="100%" stopColor="#7a541c" />
          </linearGradient>
          <linearGradient id="activeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fff3b0" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fff3b0" />
          </linearGradient>
          <linearGradient id="mutedRail" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#5c4e40" />
            <stop offset="100%" stopColor="#322920" />
          </linearGradient>
          <linearGradient id="railCrownGleam" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#c8963e" stopOpacity="0.2" />
          </linearGradient>
          <filter id="railShadow" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#0d0804" floodOpacity="0.6" />
          </filter>
          <filter id="conductionGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#f59e0b" floodOpacity="0.8" />
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#fff5ba" floodOpacity="0.9" />
          </filter>
        </defs>

        {/* 1. Main Physical Railway Tracks (Parallel Double Brass Rails on Dark Oak Sleepers) */}
        <g id="tracks-group">
          {/* Stem from Rook Dome to West Junction */}
          <ModelTrackSection d={domeStemPath} active={routeEval.connected} />

          {/* Stem from East Junction to Key Station */}
          <ModelTrackSection d={eastStemPath} active={routeEval.connected} />

          {/* Upper Route (THEN): West Arc & East Arc */}
          <ModelTrackSection
            d={upperWestPath}
            active={upperActive}
            dormant={state.dial !== "THEN" || state.keyRetrieved}
          />
          <ModelTrackSection
            d={upperEastPath}
            active={upperActive}
            dormant={state.dial !== "THEN" || state.keyRetrieved}
          />

          {/* Lower Route (NOW): West Arc & East Arc */}
          <ModelTrackSection
            d={lowerWestPath}
            active={lowerActive}
            dormant={state.dial !== "NOW"}
          />
          <ModelTrackSection
            d={lowerEastPath}
            active={lowerActive}
            dormant={state.dial !== "NOW"}
          />

          {/* Center Route Stubs */}
          <ModelTrackSection d={centerWestPath} active={centerActive} dormant={!state.centerBridgeRestored} />
          <ModelTrackSection d={centerEastPath} active={centerActive} dormant={!state.centerBridgeRestored} />
        </g>

        {/* 2. Upper Return Gate (closes when keyRetrieved is true) */}
        {state.keyRetrieved ? (
          <g data-testid="upper-return-gate-closed" transform="translate(826, 283) rotate(-28)">
            {/* Cast iron pivot stanchion */}
            <circle cx="-16" cy="0" r="8" fill="#241910" stroke="#8e6c31" strokeWidth="2" filter="url(#railShadow)" />
            <circle cx="-16" cy="0" r="3.5" fill="#ffd97d" />
            {/* Articulated railway stop arm */}
            <rect x="-16" y="-8" width="58" height="16" rx="3" fill="#1e1610" stroke="#d5a045" strokeWidth="1.5" filter="url(#railShadow)" />
            {/* Brass diagonal hazard chevrons */}
            <path d="M -4 -8 L 4 8 M 12 -8 L 20 8 M 28 -8 L 36 8" stroke="#ffd97d" strokeWidth="3" />
            {/* Ruby glass signal lantern with red warning glow */}
            <circle cx="34" cy="0" r="6" fill="#c41e1e" stroke="#ffe0e0" strokeWidth="1.2" filter="url(#conductionGlow)" />
            <circle cx="34" cy="0" r="2.5" fill="#ffffff" opacity="0.8" />
          </g>
        ) : null}

        {/* 3. Center Crossing Bay & Physical Bridge / Folded Dispatch Note */}
        <g transform={`translate(${center.x}, ${center.y})`}>
          {/* Recessed well bed */}
          <rect x="-76" y="-28" width="152" height="56" rx="8" fill="#120c08" stroke="#5a3f1d" strokeWidth="2" filter="url(#railShadow)" />
          {/* Internal machinery gears visible in recessed bay */}
          <circle cx="-50" cy="14" r="10" fill="none" stroke="#3d2c18" strokeWidth="2" strokeDasharray="3 3" />
          <circle cx="50" cy="-14" r="10" fill="none" stroke="#3d2c18" strokeWidth="2" strokeDasharray="3 3" />

          {state.centerBridgeRestored ? (
            /* Restored Victorian Brass Telescoping Bridge */
            <g data-testid="center-crossing-restored-rails">
              {/* Heavy brass side truss girders with rivets */}
              <rect x="-76" y="-22" width="152" height="6" fill="#8c6123" stroke="#ffd97d" strokeWidth="0.8" />
              <rect x="-76" y="16" width="152" height="6" fill="#8c6123" stroke="#ffd97d" strokeWidth="0.8" />
              {/* Cross lattice bracing */}
              <path d="M -60 -16 L -40 16 M -40 -16 L -20 16 M -20 -16 L 0 16 M 0 -16 L 20 16 M 20 -16 L 40 16 M 40 -16 L 60 16" stroke="#c99846" strokeWidth="1.5" />
              {/* Continuous Double Brass Rails */}
              <line x1="-76" y1="-5" x2="76" y2="-5" stroke={centerActive ? "url(#activeGlow)" : "url(#brassRail)"} strokeWidth="3.5" filter={centerActive ? "url(#conductionGlow)" : undefined} />
              <line x1="-76" y1="5" x2="76" y2="5" stroke={centerActive ? "url(#activeGlow)" : "url(#brassRail)"} strokeWidth="3.5" filter={centerActive ? "url(#conductionGlow)" : undefined} />
              {/* Central interlocking brass locking plate */}
              <rect x="-18" y="-14" width="36" height="28" rx="4" fill="#d5a045" stroke="#fff4cf" strokeWidth="1.5" />
              <circle cx="0" cy="0" r="4" fill="#3a2512" />
            </g>
          ) : (
            /* Broken Center Gap with Folded Correspondence Dispatch */
            <g data-testid="center-crossing-broken-gap">
              {/* Sheared brass rail ends with red buffer stops */}
              <rect x="-76" y="-9" width="10" height="18" rx="2" fill="#7a251b" stroke="#e09282" strokeWidth="1" />
              <line x1="-76" y1="-5" x2="-66" y2="-5" stroke="#d5a045" strokeWidth="3.5" />
              <line x1="-76" y1="5" x2="-66" y2="5" stroke="#d5a045" strokeWidth="3.5" />

              <rect x="66" y="-9" width="10" height="18" rx="2" fill="#7a251b" stroke="#e09282" strokeWidth="1" />
              <line x1="66" y1="-5" x2="76" y2="-5" stroke="#d5a045" strokeWidth="3.5" />
              <line x1="66" y1="5" x2="76" y2="5" stroke="#d5a045" strokeWidth="3.5" />

              {/* Folded Parchment Dispatch Note */}
              <g data-testid="center-crossing-note-asset">
                <rect x="-38" y="-18" width="76" height="36" rx="4" fill="#000" opacity="0.45" filter="url(#railShadow)" />
                <rect x="-36" y="-17" width="72" height="34" rx="4" fill="#fcf6eb" stroke="#d4b478" strokeWidth="1.5" />
                {/* Envelope fold diagonal lines */}
                <path d="M -36 -17 L 0 3 L 36 -17" fill="none" stroke="#d4b478" strokeWidth="1.2" />
                {/* Crimson ribbon strap */}
                <rect x="-6" y="-17" width="12" height="34" fill="#8e2318" />
                {/* Crimson Wax Seal with monogram */}
                <circle cx="0" cy="0" r="11" fill="#9e261b" stroke="#5a110a" strokeWidth="1.5" />
                <circle cx="0" cy="0" r="8" fill="none" stroke="#e8a8a0" strokeWidth="0.8" opacity="0.7" />
                <circle cx="0" cy="0" r="3.5" fill="#5a110a" />
              </g>
            </g>
          )}
        </g>

        {/* 4. Socket indicator pips around junctions */}
        <JunctionSockets cx={west.x} cy={west.y} side="west" activePosition={state.westJunction} />
        <JunctionSockets cx={east.x} cy={east.y} side="east" activePosition={state.eastJunction} />

        {/* 5. West Junction Turntable Assembly */}
        <g transform={`translate(${west.x}, ${west.y})`}>
          {/* Base recessed well */}
          <circle r="60" fill="#130e09" stroke="#4a3722" strokeWidth="2" filter="url(#railShadow)" />
          {/* Brass outer compass ring with markings */}
          <image
            href="/assets/first-ten/impossible-machine/switch-details.png"
            x="-62"
            y="-62"
            width="124"
            height="124"
            style={{ pointerEvents: "none" }}
          />
          {/* Alignment guide notches at Upper (-34deg), Center (0deg), Lower (34deg) */}
          <line x1="42" y1="-28" x2="56" y2="-38" stroke="#d5b47a" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="50" y1="0" x2="62" y2="0" stroke="#d5b47a" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="42" y1="28" x2="56" y2="38" stroke="#d5b47a" strokeWidth="2.5" strokeLinecap="round" />
          {/* Active circuit conduction ring */}
          {upperActive || lowerActive || centerActive ? (
            <circle r="48" fill="url(#activeGlow)" opacity="0.35" filter="url(#conductionGlow)" />
          ) : null}
          {/* Rotating Turntable Disc */}
          <motion.g
            animate={{ rotate: westAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 18 }}
          >
            <image
              href="/assets/first-ten/impossible-machine/turntable-junction.png"
              x="-48"
              y="-48"
              width="96"
              height="96"
            />
          </motion.g>
        </g>

        {/* 6. East Junction Turntable Assembly */}
        <g transform={`translate(${east.x}, ${east.y})`}>
          {/* Base recessed well */}
          <circle r="60" fill="#130e09" stroke="#4a3722" strokeWidth="2" filter="url(#railShadow)" />
          {/* Brass outer compass ring with markings */}
          <image
            href="/assets/first-ten/impossible-machine/switch-details.png"
            x="-62"
            y="-62"
            width="124"
            height="124"
            style={{ pointerEvents: "none" }}
          />
          {/* Alignment guide notches at Upper (34deg), Center (0deg), Lower (-34deg) */}
          <line x1="-42" y1="-28" x2="-56" y2="-38" stroke="#d5b47a" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="-50" y1="0" x2="-62" y2="0" stroke="#d5b47a" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="-42" y1="28" x2="-56" y2="38" stroke="#d5b47a" strokeWidth="2.5" strokeLinecap="round" />
          {/* Active circuit conduction ring */}
          {upperActive || lowerActive || centerActive ? (
            <circle r="48" fill="url(#activeGlow)" opacity="0.35" filter="url(#conductionGlow)" />
          ) : null}
          {/* Rotating Turntable Disc */}
          <motion.g
            animate={{ rotate: eastAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 18 }}
          >
            <image
              href="/assets/first-ten/impossible-machine/turntable-junction.png"
              x="-48"
              y="-48"
              width="96"
              height="96"
            />
          </motion.g>
        </g>

        {/* 7. Upper Alignment Rotor */}
        <g transform={`translate(${upper.x}, ${upper.y})`}>
          {/* Recessed clockwork escapement well */}
          <circle r="58" fill="#140e08" stroke={state.dial === "THEN" ? "#c9953b" : "#443424"} strokeWidth="2.5" filter="url(#railShadow)" />
          {/* Horizontal track entry & exit guide collars */}
          <rect x="-62" y="-9" width="12" height="18" rx="2" fill="#3a2a1b" stroke="#9e7538" strokeWidth="1" />
          <rect x="50" y="-9" width="12" height="18" rx="2" fill="#3a2a1b" stroke="#9e7538" strokeWidth="1" />
          {upperActive ? (
            <circle r="52" fill="url(#activeGlow)" opacity="0.35" filter="url(#conductionGlow)" />
          ) : null}
          <motion.g
            animate={{ rotate: upperRotorAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 17 }}
          >
            <image
              href="/assets/first-ten/impossible-machine/rotor-disc.png"
              x="-56"
              y="-56"
              width="112"
              height="112"
            />
          </motion.g>
        </g>

        {/* 8. Lower Alignment Rotor */}
        <g transform={`translate(${lower.x}, ${lower.y})`}>
          {/* Recessed clockwork escapement well */}
          <circle r="58" fill="#140e08" stroke={state.dial === "NOW" ? "#c9953b" : "#443424"} strokeWidth="2.5" filter="url(#railShadow)" />
          {/* Horizontal track entry & exit guide collars */}
          <rect x="-62" y="-9" width="12" height="18" rx="2" fill="#3a2a1b" stroke="#9e7538" strokeWidth="1" />
          <rect x="50" y="-9" width="12" height="18" rx="2" fill="#3a2a1b" stroke="#9e7538" strokeWidth="1" />
          {lowerActive ? (
            <circle r="52" fill="url(#activeGlow)" opacity="0.35" filter="url(#conductionGlow)" />
          ) : null}
          <motion.g
            animate={{ rotate: lowerRotorAngle }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 17 }}
          >
            <image
              href="/assets/first-ten/impossible-machine/rotor-disc.png"
              x="-56"
              y="-56"
              width="112"
              height="112"
            />
          </motion.g>
        </g>
      </svg>

      {/* Interactive Accessible Controls Overlay (Clean Victorian clickable plates, no tacky glowing borders) */}
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
        aria-label={`Upper alignment rotor: ${state.upperRotor}. Activate to toggle orientation.`}
        data-testid="machine-upper-rotor"
        data-orientation={state.upperRotor}
      >
        <span className={styles.junctionBadge}>
          {state.upperRotor === "aligned" ? "THEN ROTOR · ALIGNED" : "THEN ROTOR · OFF"}
        </span>
      </button>

      <button
        type="button"
        className={styles.rotorButton}
        style={{ left: `${(lower.x / MACHINE_WIDTH) * 100}%`, top: `${(lower.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onToggleLowerRotor}
        aria-label={`Lower alignment rotor: ${state.lowerRotor}. Activate to toggle orientation.`}
        data-testid="machine-lower-rotor"
        data-orientation={state.lowerRotor}
      >
        <span className={styles.junctionBadge}>
          {state.lowerRotor === "aligned" ? "NOW ROTOR · ALIGNED" : "NOW ROTOR · OFF"}
        </span>
      </button>

      <button
        type="button"
        className={styles.centerCrossingButton}
        style={{ left: `${(center.x / MACHINE_WIDTH) * 100}%`, top: `${(center.y / MACHINE_HEIGHT) * 100}%` }}
        onClick={onExamineCenter}
        aria-label="Central crossing. Activate to inspect correspondence."
        data-testid="machine-center-crossing"
      >
        {state.centerBridgeRestored ? (
          <span className={styles.centerCrossingLabel}>BRIDGED</span>
        ) : hasOpportunity ? (
          <span className={styles.centerCrossingLabel}>
            {state.keyRetrieved ? "INSPECT NOTE" : "FOLDED NOTE"}
          </span>
        ) : (
          <span className={styles.centerCrossingLabel}>GAP UNCOUPLED</span>
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
