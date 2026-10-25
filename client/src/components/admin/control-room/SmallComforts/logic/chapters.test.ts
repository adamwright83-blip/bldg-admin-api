import { describe, expect, it } from "vitest";
import {
  CHAPTER_CARDS,
  PLAYABLE_CHAPTER_COUNT,
  SCRAP_COURSES,
  completeChapter4Finale,
  createInitialStoryState,
  dismissChapterCard,
  getChapterCard,
  selectChapter,
  stepChapter1,
  stepChapter2,
  stepChapter3,
  stepChapter4,
} from "./chapters";

describe("Small Comforts canonical Chapters 1-4 logic", () => {
  it("exposes all four canonical chapters with their exact titles and premises", () => {
    expect(PLAYABLE_CHAPTER_COUNT).toBe(4);
    expect(CHAPTER_CARDS.map(c => c.title)).toEqual([
      "Breakfast in Bed",
      "This Is a Sign",
      "Leftovers",
      "The Heimlich",
    ]);
    expect(getChapterCard(1).premises).toEqual([
      "His lunch is on top of the tin.",
      "Pip’s bed is up on the shelf.",
      "Nobody can reach either.",
    ]);
    expect(getChapterCard(2).premises).toEqual([
      "He’s asleep.",
      "His beard is in the way.",
      "Somebody has a trimmer.",
    ]);
    expect(getChapterCard(3).premises[0]).toBe("The mice owe him dinner.");
    expect(getChapterCard(4).premises[2]).toBe("The broken glass is finally free.");
  });

  it("plays Chapter 1 (Breakfast in Bed) through both comic wrong branches and the full egg/stairs/whoopee/toaster solution", () => {
    let s = dismissChapterCard(createInitialStoryState(1));
    expect(s.showingChapterCard).toBe(false);

    // Wrong branch 1: Pip tries to lift the heavy bottle cap solo (>= 3s pratfall, no fail screen)
    s = stepChapter1(s, { type: "wrong_pip_lifts_cap" });
    expect(s.pratfall?.id).toBe("pip_under_cap");
    expect(s.pratfall?.durationSec).toBeGreaterThanOrEqual(3.0);

    // Free Biscuit from 5 zipper teeth with rising musical notes
    for (let i = 0; i < 5; i++) {
      s = stepChapter1(s, { type: "pull_zipper_tooth" });
    }
    expect(s.ch1.zipperTeethFreed).toBe(5);
    expect(s.ch1.step).toBe("place_bottle_cap");

    // Place bottle cap
    s = stepChapter1(s, { type: "place_bottle_cap" });
    expect(s.ch1.bottleCapPlaced).toBe(true);
    expect(s.ch1.step).toBe("aim_shoelace_sling");

    // Wrong tension on shoelace sling -> slapstick pratfall
    s = stepChapter1(s, { type: "fire_shoelace_sling", tension: 0.35 });
    expect(s.pratfall?.id).toBe("sling_under_pull");
    expect(s.ch1.eggCrackedInCap).toBe(false);

    // Sweet-spot tension -> backflip kick, zipper xylophone run-down, egg lands in cap
    s = stepChapter1(s, { type: "fire_shoelace_sling", tension: 0.82 });
    expect(s.ch1.eggCrackedInCap).toBe(true);
    expect(s.ch1.step).toBe("stack_eggshell_stairs");

    // Stack 3 eggshell halves -> Pip's crutch crunches through the top shell!
    for (let i = 0; i < 3; i++) {
      s = stepChapter1(s, { type: "stack_eggshell" });
    }
    expect(s.ch1.pipCrutchCrunched).toBe(true);
    expect(s.ch1.step).toBe("whoopee_launchpad");

    // Place whoopee cushion and launch Pip + omelette into his shelf bed via Biscuit cannonball
    s = stepChapter1(s, { type: "place_whoopee_cushion" });
    s = stepChapter1(s, { type: "biscuit_cannonball" });
    expect(s.ch1.pipInShelfBed).toBe(true);
    expect(s.ch1.step).toBe("toaster_finale");

    // Pull toaster lever -> smoke alarm, man runs out and meets cast-armed neighbour
    s = stepChapter1(s, { type: "pull_toaster_lever" });
    expect(s.ch1.step).toBe("complete");
    expect(s.ch1.neighbourMetInHall).toBe(true);
    expect(s.completedChapters).toContain(1);
  });

  it("plays Chapter 2 (This Is a Sign) with procedural beard shaving, stir freeze, and phone pinball", () => {
    let s = dismissChapterCard(selectChapter(createInitialStoryState(1), 2));
    expect(s.activeChapter).toBe(2);

    // Wrong branch: Biscuit rides runaway clippers into a dust bunny
    s = stepChapter2(s, { type: "wrong_biscuit_dust_bunny" });
    expect(s.pratfall?.id).toBe("biscuit_dust_rodeo");

    // Advance sleep timer into stirring and verify buzzing triggers the Play Dead gag
    s = stepChapter2(s, { type: "advance_sleep_timer", dtSec: 6.4 });
    expect(s.ch2.sleepPhase).toBe("stirring");
    s = stepChapter2(s, { type: "shave_stroke", x: 0.5, y: 0.5 });
    expect(s.pratfall?.id).toBe("caught_buzzing_on_stir");
    expect(s.ch2.micePlayingDead).toBe(true);

    // Now in deep_sleep: carve strokes across the beard mask until >= 45% shaved
    const path = [
      [0.15, 0.25],
      [0.35, 0.25],
      [0.55, 0.25],
      [0.75, 0.25],
      [0.25, 0.65],
      [0.5, 0.65],
      [0.75, 0.65],
    ] as const;
    for (const [x, y] of path) {
      s = stepChapter2(s, { type: "shave_stroke", x, y });
    }
    expect(s.ch2.shavedRatio).toBeGreaterThanOrEqual(0.45);
    expect(s.ch2.step).toBe("this_is_a_sign_wake");

    // He wakes with the exact shaved mask and says "…this is a sign."
    s = stepChapter2(s, { type: "speak_this_is_a_sign" });
    expect(s.ch2.wokeLineSpoken).toBe(true);
    expect(s.ch2.step).toBe("phone_pinball");

    // Hit all 3 phone notification bumpers -> daughter FaceTime
    s = stepChapter2(s, { type: "hit_pinball_bumper", target: "accept" });
    s = stepChapter2(s, { type: "hit_pinball_bumper", target: "voicemail" });
    s = stepChapter2(s, { type: "hit_pinball_bumper", target: "speaker" });
    expect(s.ch2.daughterCalled).toBe(true);
    expect(s.ch2.step).toBe("complete");
    expect(s.completedChapters).toContain(2);
  });

  it("plays Chapter 3 (Leftovers) with exhale blowback slapstick and in-breath feeding that triggers choking", () => {
    let s = dismissChapterCard(selectChapter(createInitialStoryState(1), 3));
    expect(s.activeChapter).toBe(3);

    // Load spoon and fire on EXHALE -> scraps blow back into Biscuit's hat and mustache!
    s = stepChapter3(s, { type: "load_scrap_spoon" });
    s = stepChapter3(s, { type: "advance_breath", dtSec: 0, forcePhase: "exhale_snore" });
    s = stepChapter3(s, { type: "launch_spoon" });
    expect(s.pratfall?.id).toBe("exhale_scrap_blowback");
    expect(s.ch3.mustacheScraps).toBe(1);
    expect(s.ch3.coursesFed).toHaveLength(0);

    // Feed all 3 scrap courses on the IN-BREATH
    for (let i = 0; i < SCRAP_COURSES.length; i++) {
      s = stepChapter3(s, { type: "load_scrap_spoon" });
      s = stepChapter3(s, { type: "advance_breath", dtSec: 0, forcePhase: "inhale_open" });
      s = stepChapter3(s, { type: "launch_spoon" });
    }
    expect(s.ch3.coursesFed).toHaveLength(3);
    expect(s.ch3.chokingTriggered).toBe(true);
    expect(s.ch3.step).toBe("choking_onset");

    // Transition directly into Chapter 4
    s = stepChapter3(s, { type: "transition_to_chapter_4" });
    expect(s.activeChapter).toBe(4);
    expect(s.completedChapters).toContain(3);
  });

  it("plays Chapter 4 (The Heimlich) through all required beats with free glass shards singing a cappella on every mouse jump", () => {
    let s = dismissChapterCard(selectChapter(createInitialStoryState(1), 4));
    expect(s.ch4.beat).toBe("1_fed_and_choking");

    // Beat 1 -> 2: Stands and backs up clutching throat
    s = stepChapter4(s, { type: "advance_intro_beat" });
    expect(s.ch4.beat).toBe("2_stands_and_backs_up");

    // Beat 2 -> 3: Breaks bedroom window -> glass shards are immediately FREE and sing!
    s = stepChapter4(s, { type: "advance_intro_beat" });
    expect(s.ch4.beat).toBe("3_breaks_bedroom_window");
    expect(s.ch4.windowShattered).toBe(true);
    expect(s.ch4.lastShardChorusSyllable).toContain("FREE");

    // Beat 3 -> 4: Falls backward outside onto his ass
    s = stepChapter4(s, { type: "advance_intro_beat" });
    expect(s.ch4.beat).toBe("4_falls_outside_on_ass");
    expect(s.ch4.manOutsideOnAss).toBe(true);

    // Beat 4 -> 5: Neighbour rushes in with broken arm in a cast
    s = stepChapter4(s, { type: "advance_intro_beat" });
    expect(s.ch4.beat).toBe("5_neighbor_rushes_in");
    expect(s.ch4.neighborPresent).toBe(true);
    expect(s.ch4.neighborBrokenArmCastVisible).toBe(true);

    // Beat 5 -> 6: One-armed Heimlich sync sequence begins
    s = stepChapter4(s, { type: "advance_intro_beat" });
    expect(s.ch4.beat).toBe("6_one_armed_heimlich_sync");

    // Off-beat jump: still triggers the celebratory glass-shard a cappella chorus, plus comic bounce pratfall
    s = stepChapter4(s, { type: "tick_compression", dtSec: 0, forceCompression: 0.1 });
    s.soundQueue = [];
    s = stepChapter4(s, { type: "mouse_jump", mouse: "pip" });
    expect(s.ch4.totalMouseJumps).toBe(1);
    expect(s.soundQueue.some(q => q.kind === "glass_shard_chorus")).toBe(true);
    expect(s.pratfall?.id).toBe("heimlich_early_bounce");
    expect(s.ch4.syncedMice).toHaveLength(0);

    // Three synchronized jumps (Pip, Biscuit, Conductor) inside the compression window (0.30..0.78)
    for (const mouse of ["pip", "biscuit", "conductor"] as const) {
      s = stepChapter4(s, { type: "tick_compression", dtSec: 0, forceCompression: 0.52 });
      s.soundQueue = [];
      s = stepChapter4(s, { type: "mouse_jump", mouse });
      expect(s.soundQueue.some(q => q.kind === "glass_shard_chorus")).toBe(true);
    }

    expect(s.ch4.syncedMice).toEqual(["pip", "biscuit", "conductor"]);
    expect(s.ch4.beat).toBe("7_triumphant_expulsion");
    expect(s.ch4.foodExpelled).toBe(true);
    expect(s.ch4.caughtInConductorHat).toBe(true);
    expect(s.ch4.hatsOnWindowsill).toBe(true);

    s = completeChapter4Finale(s);
    expect(s.ch4.beat).toBe("complete");
    expect(s.completedChapters).toContain(4);
  });
});
