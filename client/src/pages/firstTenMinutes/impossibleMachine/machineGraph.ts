import type {
  JunctionPosition,
  MachineDialState,
  MachineGraphConfig,
  MachineNodeId,
  MachinePoint,
  RouteEvaluation,
  RotorOrientation,
} from "./machineTypes";

/**
 * Logical 1280 x 720 coordinate system for THE IMPOSSIBLE MACHINE.
 *
 * Topology:
 *                  UPPER / THEN
 *               [Upper rotor] (640, 180)
 *                /         \
 *               /           \
 *  ROOK --- [WEST] -- X -- [EAST] --- KEY
 *  DOME      |   CENTRAL  |          STATION
 * (154,374) (358,374) (640,374) (922,374) (1126,374)
 *            \            /
 *             \          /
 *              [Lower rotor] (640, 562)
 *                  LOWER / NOW
 */
export const MACHINE_WIDTH = 1280;
export const MACHINE_HEIGHT = 720;

export const MACHINE_NODES: Record<MachineNodeId, MachinePoint> = {
  rook_dome: { x: 154, y: 374 },
  west_junction: { x: 358, y: 374 },
  upper_rotor: { x: 640, y: 180 },
  center_crossing: { x: 640, y: 374 },
  lower_rotor: { x: 640, y: 562 },
  east_junction: { x: 922, y: 374 },
  key_station: { x: 1126, y: 374 },
};

export const JUNCTION_ORDER: readonly JunctionPosition[] = ["upper", "center", "lower"];

export function nextJunctionPosition(current: JunctionPosition): JunctionPosition {
  const index = JUNCTION_ORDER.indexOf(current);
  return JUNCTION_ORDER[(index + 1) % JUNCTION_ORDER.length];
}

export function toggleRotorOrientation(current: RotorOrientation): RotorOrientation {
  return current === "aligned" ? "misaligned" : "aligned";
}

export function toggleDialState(current: MachineDialState): MachineDialState {
  return current === "THEN" ? "NOW" : "THEN";
}

/**
 * Angle in degrees for rendering physical rotating junction tracks.
 * West junction faces right toward the 3 branches; East junction faces left toward the 3 branches.
 */
export function junctionAngleDegrees(side: "west" | "east", position: JunctionPosition): number {
  if (side === "west") {
    switch (position) {
      case "upper":
        return -34;
      case "center":
        return 0;
      case "lower":
        return 34;
    }
  } else {
    switch (position) {
      case "upper":
        return 34;
      case "center":
        return 0;
      case "lower":
        return -34;
    }
  }
}

export function rotorAngleDegrees(orientation: RotorOrientation): number {
  return orientation === "aligned" ? 0 : 90;
}

/**
 * Pure graph connectivity evaluator.
 * Calculates whether a continuous physical path exists from the carriage's starting station
 * to its target station, and if not, the exact node and coordinate where the carriage stops.
 */
export function evaluateMachineRoute(config: MachineGraphConfig): RouteEvaluation {
  const direction = config.keyRetrieved ? "return" : "outbound";

  if (direction === "outbound") {
    return evaluateOutboundRoute(config);
  }
  return evaluateReturnRoute(config);
}

function evaluateOutboundRoute(config: MachineGraphConfig): RouteEvaluation {
  const start = MACHINE_NODES.rook_dome;
  const west = MACHINE_NODES.west_junction;
  const upper = MACHINE_NODES.upper_rotor;
  const center = MACHINE_NODES.center_crossing;
  const lower = MACHINE_NODES.lower_rotor;
  const east = MACHINE_NODES.east_junction;
  const key = MACHINE_NODES.key_station;

  // Outbound starts at Rook's dome and reaches West junction
  if (config.westJunction === "upper") {
    if (config.dial !== "THEN") {
      return {
        direction: "outbound",
        connected: false,
        activeRoute: null,
        reachedNodes: ["rook_dome", "west_junction"],
        pathPoints: [start, west, { x: 465, y: 298 }],
        stopReason: "upper_dial_requires_then",
        haltPoint: { x: 465, y: 298 },
      };
    }
    if (config.upperRotor !== "aligned") {
      return {
        direction: "outbound",
        connected: false,
        activeRoute: null,
        reachedNodes: ["rook_dome", "west_junction", "upper_rotor"],
        pathPoints: [start, west, { x: 490, y: 230 }, { x: 580, y: 185 }],
        stopReason: "upper_rotor_misaligned",
        haltPoint: { x: 580, y: 185 },
      };
    }
    if (config.eastJunction !== "upper") {
      return {
        direction: "outbound",
        connected: false,
        activeRoute: null,
        reachedNodes: ["rook_dome", "west_junction", "upper_rotor"],
        pathPoints: [start, west, { x: 490, y: 230 }, upper, { x: 790, y: 230 }, { x: 870, y: 315 }],
        stopReason: "east_junction_mismatch",
        haltPoint: { x: 870, y: 315 },
      };
    }
    return {
      direction: "outbound",
      connected: true,
      activeRoute: "upper",
      reachedNodes: ["rook_dome", "west_junction", "upper_rotor", "east_junction", "key_station"],
      pathPoints: [start, west, { x: 490, y: 230 }, upper, { x: 790, y: 230 }, east, key],
      stopReason: null,
      haltPoint: null,
    };
  }

  if (config.westJunction === "center") {
    if (!config.centerBridgeRestored) {
      return {
        direction: "outbound",
        connected: false,
        activeRoute: null,
        reachedNodes: ["rook_dome", "west_junction"],
        pathPoints: [start, west, { x: 548, y: center.y }],
        stopReason: "center_crossing_broken",
        haltPoint: { x: 548, y: center.y },
      };
    }
    if (config.eastJunction !== "center") {
      return {
        direction: "outbound",
        connected: false,
        activeRoute: null,
        reachedNodes: ["rook_dome", "west_junction", "center_crossing"],
        pathPoints: [start, west, center, { x: 855, y: center.y }],
        stopReason: "east_junction_mismatch",
        haltPoint: { x: 855, y: center.y },
      };
    }
    return {
      direction: "outbound",
      connected: true,
      activeRoute: "center",
      reachedNodes: ["rook_dome", "west_junction", "center_crossing", "east_junction", "key_station"],
      pathPoints: [start, west, center, east, key],
      stopReason: null,
      haltPoint: null,
    };
  }

  // West junction is "lower" on outbound
  if (config.dial !== "NOW") {
    return {
      direction: "outbound",
      connected: false,
      activeRoute: null,
      reachedNodes: ["rook_dome", "west_junction"],
      pathPoints: [start, west, { x: 465, y: 452 }],
      stopReason: "lower_dial_requires_now",
      haltPoint: { x: 465, y: 452 },
    };
  }
  if (config.lowerRotor !== "aligned") {
    return {
      direction: "outbound",
      connected: false,
      activeRoute: null,
      reachedNodes: ["rook_dome", "west_junction", "lower_rotor"],
      pathPoints: [start, west, { x: 490, y: 515 }, { x: 580, y: lower.y - 5 }],
      stopReason: "lower_rotor_misaligned",
      haltPoint: { x: 580, y: lower.y - 5 },
    };
  }
  if (config.eastJunction !== "lower") {
    return {
      direction: "outbound",
      connected: false,
      activeRoute: null,
      reachedNodes: ["rook_dome", "west_junction", "lower_rotor"],
      pathPoints: [start, west, { x: 490, y: 515 }, lower, { x: 790, y: 515 }, { x: 870, y: 430 }],
      stopReason: "east_junction_mismatch",
      haltPoint: { x: 870, y: 430 },
    };
  }
  // Note: Outbound puzzle requires THEN upper route; in State A-C lower route is gated to NOW return phase.
  return {
    direction: "outbound",
    connected: false,
    activeRoute: null,
    reachedNodes: ["rook_dome", "west_junction"],
    pathPoints: [start, west, { x: 465, y: 452 }],
    stopReason: "lower_dial_requires_now",
    haltPoint: { x: 465, y: 452 },
  };
}

function evaluateReturnRoute(config: MachineGraphConfig): RouteEvaluation {
  const key = MACHINE_NODES.key_station;
  const east = MACHINE_NODES.east_junction;
  const center = MACHINE_NODES.center_crossing;
  const lower = MACHINE_NODES.lower_rotor;
  const west = MACHINE_NODES.west_junction;
  const dome = MACHINE_NODES.rook_dome;

  // Return starts at Key station and enters East junction first
  if (config.eastJunction === "upper") {
    // State D: The upper route is no longer usable for the return trip (its mechanical gate closes).
    return {
      direction: "return",
      connected: false,
      activeRoute: null,
      reachedNodes: ["key_station", "east_junction"],
      pathPoints: [key, east, { x: 825, y: 295 }],
      stopReason: "upper_return_gate_closed",
      haltPoint: { x: 825, y: 295 },
    };
  }

  if (config.eastJunction === "center") {
    if (!config.centerBridgeRestored) {
      return {
        direction: "return",
        connected: false,
        activeRoute: null,
        reachedNodes: ["key_station", "east_junction"],
        pathPoints: [key, east, { x: 732, y: center.y }],
        stopReason: "center_crossing_broken",
        haltPoint: { x: 732, y: center.y },
      };
    }
    if (config.westJunction !== "center") {
      return {
        direction: "return",
        connected: false,
        activeRoute: null,
        reachedNodes: ["key_station", "east_junction", "center_crossing"],
        pathPoints: [key, east, center, { x: 425, y: center.y }],
        stopReason: "west_junction_disconnected",
        haltPoint: { x: 425, y: center.y },
      };
    }
    return {
      direction: "return",
      connected: true,
      activeRoute: "center",
      reachedNodes: ["key_station", "east_junction", "center_crossing", "west_junction", "rook_dome"],
      pathPoints: [key, east, center, west, dome],
      stopReason: null,
      haltPoint: null,
    };
  }

  // East junction selects "lower"
  if (config.dial !== "NOW") {
    return {
      direction: "return",
      connected: false,
      activeRoute: null,
      reachedNodes: ["key_station", "east_junction"],
      pathPoints: [key, east, { x: 820, y: 452 }],
      stopReason: "lower_dial_requires_now",
      haltPoint: { x: 820, y: 452 },
    };
  }

  if (config.lowerRotor !== "aligned") {
    return {
      direction: "return",
      connected: false,
      activeRoute: null,
      reachedNodes: ["key_station", "east_junction", "lower_rotor"],
      pathPoints: [key, east, { x: 790, y: 515 }, { x: 700, y: lower.y - 5 }],
      stopReason: "lower_rotor_misaligned",
      haltPoint: { x: 700, y: lower.y - 5 },
    };
  }

  if (config.westJunction !== "lower") {
    return {
      direction: "return",
      connected: false,
      activeRoute: null,
      reachedNodes: ["key_station", "east_junction", "lower_rotor"],
      pathPoints: [key, east, { x: 790, y: 515 }, lower, { x: 490, y: 515 }, { x: 410, y: 430 }],
      stopReason: "west_junction_disconnected",
      haltPoint: { x: 410, y: 430 },
    };
  }

  return {
    direction: "return",
    connected: true,
    activeRoute: "lower",
    reachedNodes: ["key_station", "east_junction", "lower_rotor", "west_junction", "rook_dome"],
    pathPoints: [key, east, { x: 790, y: 515 }, lower, { x: 490, y: 515 }, west, dome],
    stopReason: null,
    haltPoint: null,
  };
}
