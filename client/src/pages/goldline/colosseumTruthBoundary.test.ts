import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cueCategory, type AudioCueId } from "../../game/audio/AudioManager";

/**
 * The Colosseum is fiction layered over a real campaign. These checks read
 * the source itself, because the ways this boundary erodes — a helpful
 * import, a borrowed "victory" sound, a second path into the finale — all
 * compile and pass every behavioural test.
 *
 * See docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md.
 */

const DIR = join(__dirname);
const read = (file: string) => readFileSync(join(DIR, file), "utf8");

/** Pure fiction: none of these may know the business exists. */
const FICTION_MODULES = [
  "ClockheadDuel.tsx",
  "clockheadDuelEngine.ts",
  "colosseumSearchEngine.ts",
  "colosseumAvatar.ts",
  "colosseumCombat.ts",
  "colosseumStage.ts",
  "colosseumFx.ts",
  "ClockheadConstruct.tsx",
  "ColosseumControls.tsx",
  "ColosseumSprites.tsx",
  "ColosseumStageView.tsx",
];

/** Everything that renders the Colosseum, fiction or gate. */
const COLOSSEUM_SURFACES = [...FICTION_MODULES, "ColosseumBossGate.tsx"];

describe("the Colosseum's fiction cannot reach business state", () => {
  it.each(FICTION_MODULES)("%s imports nothing that can read or write the real campaign", file => {
    const source = read(file);
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]!);
    for (const specifier of imports) {
      expect(specifier, `${file} imports ${specifier}`).not.toMatch(
        /lib\/trpc|Day1FieldMission|day1TenDoors|day1Evidence|leadHunt|colosseumCampaign|server\//
      );
    }
    expect(source).not.toMatch(/recordOutcome|recordEvidence|useMutation/);
  });
});

describe("a fictional win never borrows the feel of a real one", () => {
  it.each(COLOSSEUM_SURFACES)("%s never uses the business-victory haptic", file => {
    expect(read(file)).not.toMatch(/businessVictoryFeedback/);
  });

  it.each(COLOSSEUM_SURFACES)("%s plays no cue from the reserved victory category", file => {
    const cues = [...read(file).matchAll(/\.play\(\s*["']([a-z_]+)["']/g)].map(
      match => match[1] as AudioCueId
    );
    for (const cue of cues) expect(cueCategory(cue), `${file} plays ${cue}`).not.toBe("victory");
  });
});

describe("the finale is reachable only through the authoritative campaign", () => {
  it("mounts ClockheadDuel in exactly one place, behind campaign.isComplete", () => {
    const gate = read("ColosseumBossGate.tsx");
    expect(gate.match(/<ClockheadDuel\b/g)).toHaveLength(1);
    expect(gate).toMatch(
      /if\s*\(\s*campaign\.isComplete\s*\)\s*\{\s*return\s*<ClockheadDuel\s+onDefeated=\{onBossDefeated\}\s*\/>;?\s*\}/
    );
    expect(gate).toMatch(/const campaign = useMemo\(\(\) => projectColosseumMission\(mission\), \[mission\]\);/);
  });

  it("hands the finale nothing but a callback, and calls it from one place", () => {
    const duel = read("ClockheadDuel.tsx");
    expect(duel).toMatch(
      /export default function ClockheadDuel\(\{ onDefeated \}: \{ onDefeated: \(\) => void \}\)/
    );
    expect(duel.match(/onDefeated\(\)/g)).toHaveLength(1);
  });

  it("still sends the real hunt through the unmodified field mission", () => {
    const gate = read("ColosseumBossGate.tsx");
    expect(gate).toMatch(/<Day1FieldMission\s+mission=\{campaign\}/);
    expect(gate).toMatch(/onRecordOutcome=\{onRecordOutcome\}/);
  });
});
