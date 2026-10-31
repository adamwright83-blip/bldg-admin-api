/**
 * Places on the island board that open a platform-admin-only destination with a full page navigation:
 * - the Laundry Farm Operations Hub enters /operations/floor, a control-room path;
 * - Silver Lake, Beverly Hills and CHANNEL 382 open walk-in scenes at /growth/lantern-city?cozy=… or ?level=…,
 *   which only the platform admin shell mounts (lanternSceneFor in AdminHostApp).
 *
 * A tenant member's world (JoystickWorld) serves none of them: the hub path is refused or bounced, and the scene
 * links reload the same board. So with `platformScenes` off they are not offered as places to click: the hub is
 * not built, Silver Lake and Beverly Hills open their island card like every other island, and the CHANNEL 382
 * button is absent. The platform admin board keeps all of them.
 */
export type IslandWalkIn = "silverLake3d" | "beverlyHills3d";

export type IslandPlatformPlaces = {
  /** build the Laundry Farm Operations Hub and let a click on it enter Operations Command */
  operationsHub: boolean;
  /** show the CHANNEL 382 button */
  channel382: boolean;
  /** the walk-in scene a click on this island opens, or null when it opens the island card */
  walkIn(islandName: string | undefined): IslandWalkIn | null;
};

export function islandPlatformPlaces(platformScenes: boolean): IslandPlatformPlaces {
  return {
    operationsHub: platformScenes,
    channel382: platformScenes,
    walkIn: islandName => {
      if (!platformScenes) return null;
      if (islandName === "Silver Lake") return "silverLake3d";
      if (islandName === "Beverly Hills") return "beverlyHills3d";
      return null;
    },
  };
}
