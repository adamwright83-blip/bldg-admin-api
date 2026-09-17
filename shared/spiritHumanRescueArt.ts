/**
 * Art slot names for Spirit Human rescue. Components bind real files.
 * Current donor is Level 4 mechanical art and is provisional.
 */
export const SPIRIT_HUMAN_RESCUE_ART = {
  status: "provisional" as const,
  donor: "level4_mechanical",
  slots: ["environment", "threat", "captive", "playerMark"] as const,
} as const;
