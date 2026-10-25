/**
 * Small Comforts — Canonical Four-Chapter Story & Gameplay Simulation
 *
 * Pure, deterministic, renderer-independent state machine and physical-comedy
 * simulation for the warm suitcase/tin interior version of Small Comforts.
 *
 * Canonical Chapters:
 *   1. Chapter One — "Breakfast in Bed"
 *      - His lunch is on top of the tin. Pip's bed is up on the shelf. Nobody can reach either.
 *      - Free Biscuit from the zipper teeth -> place bottle cap -> Conductor shoelace sling swing ->
 *        egg rolls down zipper teeth -> eggshell stairs (crutch crunch!) -> whoopee cushion cannonball ->
 *        toaster slot & Neighbour with broken arm in cast.
 *   2. Chapter Two — "This Is a Sign"
 *      - He's asleep. His beard is in the way. Somebody has a trimmer.
 *      - Pip on his nose as lookout calling stirs (nostril flare / eyebrow twitch) ->
 *        Biscuit riding bucking clippers -> Conductor pulling cord to steer procedural beard/scalp mask ->
 *        he wakes with whatever cut you drove and says "…this is a sign." -> Phone pinball & daughter FaceTime.
 *   3. Chapter Three — "Leftovers"
 *      - The mice owe him dinner. They try to feed him the week's scraps on the in-breath.
 *      - Load the week's scraps into the spoon catapult -> time the release to his deep inhale window ->
 *        exhale blows scraps back into mustache (wrong timing gag!) -> final bite goes down on the inhale ->
 *        he gulps and starts to choke, escalating directly into Chapter 4.
 *   4. Chapter Four — "The Heimlich"
 *      - After being fed food, the man chokes -> stands, backs up holding his throat -> breaks the bedroom window ->
 *        falls backward outside onto his ass -> Neighbour runs in to help -> her broken arm in a cast limits her ->
 *        one-armed Heimlich attempts aren't enough alone -> the three mice jump in sync with her compressions ->
 *        MEANWHILE the broken glass shards are FREE from the window and sing a cappella celebration notes/syllables
 *        every time a mouse jumps! -> combined 3-sync impact expels the food into Conductor's hovering hat.
 */

export type ChapterId = 1 | 2 | 3 | 4;

export type MouseActorId = "pip" | "biscuit" | "conductor";

export interface ChapterCardMeta {
  id: ChapterId;
  roman: "I" | "II" | "III" | "IV";
  label: string;
  title: string;
  premises: readonly [string, string, string];
  subtitle: string;
}

export const CHAPTER_CARDS: readonly ChapterCardMeta[] = [
  {
    id: 1,
    roman: "I",
    label: "Chapter One",
    title: "Breakfast in Bed",
    premises: [
      "His lunch is on top of the tin.",
      "Pip’s bed is up on the shelf.",
      "Nobody can reach either.",
    ],
    subtitle: "A hard-boiled egg, a stuck zipper, and a whoopee cushion.",
  },
  {
    id: 2,
    roman: "II",
    label: "Chapter Two",
    title: "This Is a Sign",
    premises: [
      "He’s asleep.",
      "His beard is in the way.",
      "Somebody has a trimmer.",
    ],
    subtitle: "Lookout on the nose. Hold the cord. Freeze when he stirs.",
  },
  {
    id: 3,
    roman: "III",
    label: "Chapter Three",
    title: "Leftovers",
    premises: [
      "The mice owe him dinner.",
      "They saved the week’s scraps.",
      "Wait for the in-breath.",
    ],
    subtitle: "Three courses by spoon catapult. Do not fire on the snore.",
  },
  {
    id: 4,
    roman: "IV",
    label: "Chapter Four",
    title: "The Heimlich",
    premises: [
      "He backed through the bedroom window.",
      "Her good arm isn’t enough.",
      "The broken glass is finally free.",
    ],
    subtitle: "Jump on her one-armed thrust. Every jump gets an a cappella chord.",
  },
] as const;

export const PLAYABLE_CHAPTER_COUNT = 4;

// ---------------------------------------------------------------------------
// Sound cue events emitted by pure logic so both WebAudio & tests can verify
// ---------------------------------------------------------------------------
export type SoundCue =
  | { kind: "zipper_tooth"; index: number; total: number; freqHz: number }
  | { kind: "zipper_run_down"; notesHz: readonly number[] }
  | { kind: "cap_clink" }
  | { kind: "sling_stretch"; tension: number }
  | { kind: "egg_crack" }
  | { kind: "shell_crunch" }
  | { kind: "whoopee_toot"; pitchHz: number; durationSec: number }
  | { kind: "toaster_lever" }
  | { kind: "smoke_alarm" }
  | { kind: "pratfall_boing"; branch: string }
  | { kind: "trimmer_buzz"; load: number }
  | { kind: "man_stir_snort" }
  | { kind: "this_is_a_sign" }
  | { kind: "pinball_bumper"; target: string }
  | { kind: "inhale_swell" }
  | { kind: "exhale_blast" }
  | { kind: "spoon_twang" }
  | { kind: "gulp_choke" }
  | { kind: "window_shatter" }
  | { kind: "ass_thud" }
  | { kind: "heimlich_grunt"; synced: boolean }
  | {
      kind: "glass_shard_chorus";
      jumpIndex: number;
      syllable: string;
      notesHz: readonly [number, number, number, number];
    }
  | { kind: "cork_pop_triumph" }
  | { kind: "chapter_chime"; chapter: ChapterId };

// ---------------------------------------------------------------------------
// Comic Wrong-Branch Pratfall State (minimum 3.0s animated slapstick, never a fail screen)
// ---------------------------------------------------------------------------
export interface PratfallEvent {
  id: string;
  chapter: ChapterId;
  actor: MouseActorId | "all" | "man";
  headline: string;
  caption: string;
  durationSec: number;
  elapsedSec: number;
}

// ---------------------------------------------------------------------------
// Chapter 1: Breakfast in Bed
// ---------------------------------------------------------------------------
export type Chapter1Step =
  | "free_biscuit"
  | "place_bottle_cap"
  | "aim_shoelace_sling"
  | "stack_eggshell_stairs"
  | "whoopee_launchpad"
  | "toaster_finale"
  | "complete";

export interface Chapter1State {
  step: Chapter1Step;
  /** 0..5 zipper teeth freed for Biscuit */
  zipperTeethFreed: number;
  bottleCapPlaced: boolean;
  /** 0..1 pull tension on Conductor's shoelace sling; sweet spot is 0.68..0.92 */
  slingTension: number;
  eggCrackedInCap: boolean;
  /** 0..3 eggshell halves stacked toward the high shelf */
  shellStairsStacked: number;
  pipCrutchCrunched: boolean;
  whoopeePlaced: boolean;
  pipInShelfBed: boolean;
  toasterLaunched: boolean;
  neighbourMetInHall: boolean;
}

// ---------------------------------------------------------------------------
// Chapter 2: This Is a Sign
// ---------------------------------------------------------------------------
export type Chapter2Step =
  | "beard_shave"
  | "this_is_a_sign_wake"
  | "phone_pinball"
  | "complete";

export interface BeardStroke {
  /** Normalized 0..1 across the man's beard/scalp canvas */
  x: number;
  y: number;
  radius: number;
}

export interface Chapter2State {
  step: Chapter2Step;
  /** 16x8 grid (128 cells) of beard/hair coverage: true = hair present, false = shaved by player */
  beardMask: boolean[];
  strokes: BeardStroke[];
  trimmerActive: boolean;
  /** Man's sleep stir cycle: "deep_sleep" -> "twitch_warning" -> "stirring" */
  sleepPhase: "deep_sleep" | "twitch_warning" | "stirring";
  phaseTimerSec: number;
  /** Mice freeze and play dead when trimmerActive is false during stirring */
  micePlayingDead: boolean;
  shavedRatio: number;
  wokeLineSpoken: boolean;
  /** Phone screen pinball bumpers hit: "accept" | "voicemail" | "speaker" */
  pinballHits: string[];
  daughterCalled: boolean;
}

// ---------------------------------------------------------------------------
// Chapter 3: Leftovers
// ---------------------------------------------------------------------------
export type ScrapItemId = "toast_crust" | "cheese_rind" | "herb_sprig" | "deviled_egg_half";

export interface ScrapCourse {
  id: ScrapItemId;
  label: string;
  description: string;
  weight: number;
}

export const SCRAP_COURSES: readonly ScrapCourse[] = [
  {
    id: "toast_crust",
    label: "Buttered Toast Crust",
    description: "Tuesday’s corner crust, aged under the tea tin.",
    weight: 1.0,
  },
  {
    id: "cheese_rind",
    label: "Waxed Cheddar Rind",
    description: "Biscuit carried it like a mattress.",
    weight: 1.25,
  },
  {
    id: "deviled_egg_half",
    label: "The Guilt Egg (Seasoned)",
    description: "Topped with lint-free oregano. The main apology.",
    weight: 1.5,
  },
] as const;

export type BreathPhase = "inhale_open" | "peak_hold" | "exhale_snore" | "rest";

export type Chapter3Step =
  | "load_spoon"
  | "wait_for_inhale"
  | "choking_onset"
  | "complete";

export interface Chapter3State {
  step: Chapter3Step;
  courseIndex: number;
  spoonLoaded: boolean;
  spoonTension: number;
  breathPhase: BreathPhase;
  breathTimerSec: number;
  /** 0..1 mouth openness during inhale */
  mouthOpenness: number;
  coursesFed: ScrapItemId[];
  mustacheScraps: number;
  chokingTriggered: boolean;
}

// ---------------------------------------------------------------------------
// Chapter 4: The Heimlich (+ Free Singing Glass Shards)
// ---------------------------------------------------------------------------
export type Chapter4Beat =
  | "1_fed_and_choking"
  | "2_stands_and_backs_up"
  | "3_breaks_bedroom_window"
  | "4_falls_outside_on_ass"
  | "5_neighbor_rushes_in"
  | "6_one_armed_heimlich_sync"
  | "7_triumphant_expulsion"
  | "complete";

export interface GlassShardSinger {
  id: number;
  name: string;
  voicePart: "soprano" | "alto" | "tenor" | "bass" | "baritone";
  x: number;
  y: number;
  rotationDeg: number;
  /** Celebratory prison-break line sung on jump */
  lyric: string;
  noteHz: number;
  bounceAmt: number;
  happyEyes: boolean;
}

export const INITIAL_GLASS_SHARDS: readonly GlassShardSinger[] = [
  {
    id: 0,
    name: "Top-Pane Tina",
    voicePart: "soprano",
    x: -0.72,
    y: 0.12,
    rotationDeg: -18,
    lyric: "FREE AT LAST! ♫",
    noteHz: 523.25, // C5
    bounceAmt: 0,
    happyEyes: true,
  },
  {
    id: 1,
    name: "Putty-Edge Pete",
    voicePart: "alto",
    x: -0.36,
    y: 0.08,
    rotationDeg: 14,
    lyric: "NO MORE PUTTY! ♪",
    noteHz: 659.25, // E5
    bounceAmt: 0,
    happyEyes: true,
  },
  {
    id: 2,
    name: "Mullion Mel",
    voicePart: "tenor",
    x: 0.04,
    y: 0.1,
    rotationDeg: -9,
    lyric: "FRESH AIR, BABY! ♩",
    noteHz: 783.99, // G5
    bounceAmt: 0,
    happyEyes: true,
  },
  {
    id: 3,
    name: "Corner-Triangle Carl",
    voicePart: "baritone",
    x: 0.41,
    y: 0.09,
    rotationDeg: 22,
    lyric: "GOODBYE SILL! ♬",
    noteHz: 987.77, // B5
    bounceAmt: 0,
    happyEyes: true,
  },
  {
    id: 4,
    name: "Latch-Side Lou",
    voicePart: "bass",
    x: 0.76,
    y: 0.14,
    rotationDeg: -24,
    lyric: "WE’RE OUTTA THE FRAME! ♫",
    noteHz: 1046.5, // C6
    bounceAmt: 0,
    happyEyes: true,
  },
] as const;

export const SHARD_CHORUS_HARMONIES: readonly {
  syllable: string;
  banner: string;
  notesHz: readonly [number, number, number, number];
}[] = [
  {
    syllable: "FA-LA-FREE! ♫",
    banner: "The shards throw their hands up: “Forty years in that sash—we’re FREE!”",
    notesHz: [261.63, 329.63, 392.0, 523.25], // C major open voicing
  },
  {
    syllable: "OO-WAH-BREEZE! ♬",
    banner: "Five jagged triangles lock into four-part barbershop harmony on the sill.",
    notesHz: [293.66, 369.99, 440.0, 587.33], // D major lift
  },
  {
    syllable: "HAL-LE-LU-GLASS! ♪",
    banner: "The glass chorus hits a triumphant seventh chord as the egg cork-pops!",
    notesHz: [349.23, 440.0, 523.25, 698.46], // F major -> C resolve
  },
] as const;

export interface Chapter4State {
  beat: Chapter4Beat;
  beatTimerSec: number;
  windowShattered: boolean;
  manOutsideOnAss: boolean;
  neighborPresent: boolean;
  /** Visible cast on her left arm—she can only thrust with her right arm */
  neighborBrokenArmCastVisible: boolean;
  /** 0..1 cycle of her one-armed Heimlich compression; sync window is 0.35..0.72 */
  compressionCycle: number;
  compressionSpeed: number;
  /** Mice that have locked in a synchronized jump on the current or completed compressions */
  syncedMice: MouseActorId[];
  /** Total jumps performed (each jump triggers the free glass shard a cappella chorus!) */
  totalMouseJumps: number;
  lastShardChorusSyllable: string | null;
  lastShardChorusBanner: string | null;
  shards: GlassShardSinger[];
  foodExpelled: boolean;
  caughtInConductorHat: boolean;
  hatsOnWindowsill: boolean;
}

// ---------------------------------------------------------------------------
// Root Story State across Chapters 1-4
// ---------------------------------------------------------------------------
export interface SmallComfortsStoryState {
  activeChapter: ChapterId;
  showingChapterCard: boolean;
  completedChapters: ChapterId[];
  activeMouse: MouseActorId;
  storyLine: string;
  pratfall: PratfallEvent | null;
  soundQueue: SoundCue[];
  ch1: Chapter1State;
  ch2: Chapter2State;
  ch3: Chapter3State;
  ch4: Chapter4State;
}

export function createInitialChapter1(): Chapter1State {
  return {
    step: "free_biscuit",
    zipperTeethFreed: 0,
    bottleCapPlaced: false,
    slingTension: 0,
    eggCrackedInCap: false,
    shellStairsStacked: 0,
    pipCrutchCrunched: false,
    whoopeePlaced: false,
    pipInShelfBed: false,
    toasterLaunched: false,
    neighbourMetInHall: false,
  };
}

export function createInitialChapter2(): Chapter2State {
  return {
    step: "beard_shave",
    beardMask: Array.from({ length: 128 }, () => true),
    strokes: [],
    trimmerActive: false,
    sleepPhase: "deep_sleep",
    phaseTimerSec: 0,
    micePlayingDead: false,
    shavedRatio: 0,
    wokeLineSpoken: false,
    pinballHits: [],
    daughterCalled: false,
  };
}

export function createInitialChapter3(): Chapter3State {
  return {
    step: "load_spoon",
    courseIndex: 0,
    spoonLoaded: false,
    spoonTension: 0,
    breathPhase: "inhale_open",
    breathTimerSec: 0,
    mouthOpenness: 0.85,
    coursesFed: [],
    mustacheScraps: 0,
    chokingTriggered: false,
  };
}

export function createInitialChapter4(): Chapter4State {
  return {
    beat: "1_fed_and_choking",
    beatTimerSec: 0,
    windowShattered: false,
    manOutsideOnAss: false,
    neighborPresent: false,
    neighborBrokenArmCastVisible: true,
    compressionCycle: 0.5,
    compressionSpeed: 0.65,
    syncedMice: [],
    totalMouseJumps: 0,
    lastShardChorusSyllable: null,
    lastShardChorusBanner: null,
    shards: INITIAL_GLASS_SHARDS.map(s => ({ ...s })),
    foodExpelled: false,
    caughtInConductorHat: false,
    hatsOnWindowsill: false,
  };
}

export function createInitialStoryState(startChapter: ChapterId = 1): SmallComfortsStoryState {
  return {
    activeChapter: startChapter,
    showingChapterCard: true,
    completedChapters: [],
    activeMouse: "conductor",
    storyLine: CHAPTER_CARDS[startChapter - 1].subtitle,
    pratfall: null,
    soundQueue: [],
    ch1: createInitialChapter1(),
    ch2: createInitialChapter2(),
    ch3: createInitialChapter3(),
    ch4: createInitialChapter4(),
  };
}

export function getChapterCard(chapter: ChapterId): ChapterCardMeta {
  return CHAPTER_CARDS[chapter - 1];
}

export function dismissChapterCard(state: SmallComfortsStoryState): SmallComfortsStoryState {
  const next = structuredClone(state);
  next.showingChapterCard = false;
  next.soundQueue.push({ kind: "chapter_chime", chapter: next.activeChapter });
  if (next.activeChapter === 1) {
    next.storyLine = "Biscuit is wedged in the brass zipper. Tap the zipper teeth to pop her free!";
  } else if (next.activeChapter === 2) {
    next.storyLine = "Pip is on nose-lookout. Drag the trimmer across his beard—release if his nostril flares!";
  } else if (next.activeChapter === 3) {
    next.storyLine = "Load the spoon with Tuesday’s crust and launch on his deep IN-BREATH.";
  } else {
    next.storyLine = "Thebite went down sideways! Watch him stumble toward the bedroom window…";
  }
  return next;
}

export function selectChapter(state: SmallComfortsStoryState, chapter: ChapterId): SmallComfortsStoryState {
  const next = structuredClone(state);
  next.activeChapter = chapter;
  next.showingChapterCard = true;
  next.pratfall = null;
  next.storyLine = CHAPTER_CARDS[chapter - 1].subtitle;
  if (chapter === 1 && next.ch1.step === "complete") next.ch1 = createInitialChapter1();
  if (chapter === 2 && next.ch2.step === "complete") next.ch2 = createInitialChapter2();
  if (chapter === 3 && next.ch3.step === "complete") next.ch3 = createInitialChapter3();
  if (chapter === 4 && next.ch4.beat === "complete") next.ch4 = createInitialChapter4();
  return next;
}

export function selectMouse(state: SmallComfortsStoryState, mouse: MouseActorId): SmallComfortsStoryState {
  return { ...state, activeMouse: mouse };
}

function triggerPratfall(
  next: SmallComfortsStoryState,
  id: string,
  actor: PratfallEvent["actor"],
  headline: string,
  caption: string,
  durationSec = 3.2,
) {
  next.pratfall = {
    id,
    chapter: next.activeChapter,
    actor,
    headline,
    caption,
    durationSec: Math.max(3.0, durationSec),
    elapsedSec: 0,
  };
  next.storyLine = caption;
  next.soundQueue.push({ kind: "pratfall_boing", branch: id });
}

// ---------------------------------------------------------------------------
// Chapter 1 Actions — Breakfast in Bed
// ---------------------------------------------------------------------------
export type Chapter1Action =
  | { type: "pull_zipper_tooth" }
  | { type: "place_bottle_cap" }
  | { type: "fire_shoelace_sling"; tension: number }
  | { type: "stack_eggshell" }
  | { type: "place_whoopee_cushion" }
  | { type: "biscuit_cannonball" }
  | { type: "pull_toaster_lever" }
  | { type: "wrong_pip_lifts_cap" }
  | { type: "wrong_biscuit_climbs_shoelace" };

export function stepChapter1(state: SmallComfortsStoryState, action: Chapter1Action): SmallComfortsStoryState {
  const next = structuredClone(state);
  next.pratfall = null;
  const c = next.ch1;

  switch (action.type) {
    case "wrong_pip_lifts_cap": {
      triggerPratfall(
        next,
        "pip_under_cap",
        "pip",
        "CLANG! Upside-Down Turtle!",
        "Pip tries to heave the brass bottle cap solo—it flips over him like a tiny helmet while his crutch pokes out the side.",
        3.4,
      );
      return next;
    }
    case "wrong_biscuit_climbs_shoelace": {
      triggerPratfall(
        next,
        "biscuit_pendulum",
        "biscuit",
        "BOING-YOING-YOING!",
        "Biscuit grabs the shoelace instead of Conductor—it stretches to the floorboards and yo-yos her up and down like a furry tea bag!",
        3.5,
      );
      return next;
    }
    case "pull_zipper_tooth": {
      if (c.step !== "free_biscuit") return next;
      c.zipperTeethFreed = Math.min(5, c.zipperTeethFreed + 1);
      const freqs = [330, 392, 440, 523.25, 659.25];
      next.soundQueue.push({
        kind: "zipper_tooth",
        index: c.zipperTeethFreed,
        total: 5,
        freqHz: freqs[c.zipperTeethFreed - 1] ?? 659.25,
      });
      if (c.zipperTeethFreed >= 5) {
        c.step = "place_bottle_cap";
        next.storyLine =
          "POP! Biscuit tumbles out of the zipper! Now slide the bottle cap under the zipper track to catch the egg.";
      } else {
        next.storyLine = `Zipper tooth ${c.zipperTeethFreed}/5 Tink! Keep tugging—Biscuit’s ears are wiggling!`;
      }
      return next;
    }
    case "place_bottle_cap": {
      if (c.step !== "place_bottle_cap") return next;
      c.bottleCapPlaced = true;
      c.step = "aim_shoelace_sling";
      next.soundQueue.push({ kind: "cap_clink" });
      next.storyLine =
        "Bottle cap set! Now pull Conductor’s shoelace sling into the gold sweet spot (70%–92%) to kick the egg off the tin.";
      return next;
    }
    case "fire_shoelace_sling": {
      if (c.step !== "aim_shoelace_sling") return next;
      const tension = Math.max(0, Math.min(1, action.tension));
      c.slingTension = tension;
      next.soundQueue.push({ kind: "sling_stretch", tension });
      if (tension < 0.65) {
        triggerPratfall(
          next,
          "sling_under_pull",
          "conductor",
          "SPLAT against the tin!",
          "Too gentle! Conductor’s boots Drum-roll against the side of the biscuit tin and his cap spins on his nose.",
          3.2,
        );
        return next;
      }
      if (tension > 0.94) {
        triggerPratfall(
          next,
          "sling_over_pull",
          "conductor",
          "WHam! Straight into the lining!",
          "Way too much mustard! Conductor sails clear over the egg and velcro-sticks to the felt suitcase roof.",
          3.3,
        );
        return next;
      }
      c.eggCrackedInCap = true;
      c.step = "stack_eggshell_stairs";
      next.soundQueue.push({
        kind: "zipper_run_down",
        notesHz: [784, 698.46, 659.25, 587.33, 523.25, 440, 392, 329.63],
      });
      next.soundQueue.push({ kind: "egg_crack" });
      next.storyLine =
        "BULLSEYE! Backflip kick! The egg xylophones down the zipper teeth—CRACK! Yolk in the bottle cap! Now stack the shell halves as stairs for Pip.";
      return next;
    }
    case "stack_eggshell": {
      if (c.step !== "stack_eggshell_stairs") return next;
      c.shellStairsStacked = Math.min(3, c.shellStairsStacked + 1);
      next.soundQueue.push({ kind: "shell_crunch" });
      if (c.shellStairsStacked >= 3) {
        c.pipCrutchCrunched = true;
        c.step = "whoopee_launchpad";
        triggerPratfall(
          next,
          "eggshell_crutch_crunch",
          "pip",
          "CRUNCH! Down go the shell stairs!",
          "Pip takes two proud hops up the eggshell staircase—and his tiny crutch punches straight through the top shell! We need the rubber whoopee cushion.",
          3.4,
        );
      } else {
        next.storyLine = `Eggshell step ${c.shellStairsStacked}/3 stacked against the shelf…`;
      }
      return next;
    }
    case "place_whoopee_cushion": {
      if (c.step !== "whoopee_launchpad") return next;
      c.whoopeePlaced = true;
      next.storyLine =
        "Whoopee cushion armed with Pip and the bottle-cap omelette! Tap Biscuit on the shelf to cannonball!";
      return next;
    }
    case "biscuit_cannonball": {
      if (c.step !== "whoopee_launchpad") return next;
      if (!c.whoopeePlaced) {
        c.whoopeePlaced = true;
      }
      c.pipInShelfBed = true;
      c.step = "toaster_finale";
      next.soundQueue.push({ kind: "whoopee_toot", pitchHz: 118, durationSec: 0.85 });
      next.storyLine =
        "PFFFRRRRT-WHEEE! Biscuit’s belly-flop launches Pip and the bottle-cap breakfast straight into his matchbox bed on the top shelf! One last problem: the man’s cold toast.";
      return next;
    }
    case "pull_toaster_lever": {
      if (c.step !== "toaster_finale") return next;
      c.toasterLaunched = true;
      c.neighbourMetInHall = true;
      c.step = "complete";
      if (!next.completedChapters.includes(1)) next.completedChapters.push(1);
      next.soundQueue.push({ kind: "toaster_lever" });
      next.soundQueue.push({ kind: "smoke_alarm" });
      next.storyLine =
        "FOOMP! The sock-toast smokes, the alarm chirps, the man bolts into the hall in his polka-dot boxers—and bumps straight into the Neighbour in her plaster arm cast!";
      return next;
    }
  }
}

// ---------------------------------------------------------------------------
// Chapter 2 Actions — This Is a Sign
// ---------------------------------------------------------------------------
export type Chapter2Action =
  | { type: "set_trimmer_active"; active: boolean }
  | { type: "shave_stroke"; x: number; y: number }
  | { type: "advance_sleep_timer"; dtSec: number }
  | { type: "speak_this_is_a_sign" }
  | { type: "hit_pinball_bumper"; target: "accept" | "voicemail" | "speaker" }
  | { type: "wrong_biscuit_dust_bunny" }
  | { type: "wrong_conductor_cord_swing" };

export function stepChapter2(state: SmallComfortsStoryState, action: Chapter2Action): SmallComfortsStoryState {
  const next = structuredClone(state);
  const c = next.ch2;

  switch (action.type) {
    case "wrong_biscuit_dust_bunny": {
      triggerPratfall(
        next,
        "biscuit_dust_rodeo",
        "biscuit",
        "YEE-HAW! Runaway Clippers!",
        "Biscuit spurs the buzzing trimmer without Conductor holding the cord—it bucks across the pillow and lassos a giant dust bunny!",
        3.4,
      );
      return next;
    }
    case "wrong_conductor_cord_swing": {
      triggerPratfall(
        next,
        "conductor_tarzan_ear",
        "conductor",
        "SWOOSH! Ear-Lobe Tarzan!",
        "Conductor yanks the cord with nobody on the clippers and swings in a grand arc right past the man’s twitching ear!",
        3.2,
      );
      return next;
    }
    case "set_trimmer_active": {
      c.trimmerActive = action.active;
      c.micePlayingDead = !action.active && c.sleepPhase !== "deep_sleep";
      if (action.active) {
        next.soundQueue.push({ kind: "trimmer_buzz", load: 0.5 });
      }
      return next;
    }
    case "shave_stroke": {
      if (c.step !== "beard_shave") return next;
      const x = Math.max(0, Math.min(1, action.x));
      const y = Math.max(0, Math.min(1, action.y));
      c.trimmerActive = true;

      if (c.sleepPhase === "stirring") {
        c.trimmerActive = false;
        c.micePlayingDead = true;
        triggerPratfall(
          next,
          "caught_buzzing_on_stir",
          "all",
          "SNORT! Freeze—Play Dead!",
          "Pip hissed from the nose tip! You buzzed while his nostril flared—all three mice flop flat on their backs like little plush toys until he settles.",
          3.1,
        );
        c.sleepPhase = "deep_sleep";
        c.phaseTimerSec = 0;
        return next;
      }

      c.strokes.push({ x, y, radius: 0.16 });
      // Carve cells in the 16x8 beard mask
      const cols = 16;
      const rows = 8;
      let newlyShaved = 0;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const cx = (col + 0.5) / cols;
          const cy = (r + 0.5) / rows;
          if (Math.hypot(cx - x, cy - y) <= 0.22) {
            const idx = r * cols + col;
            if (c.beardMask[idx]) {
              c.beardMask[idx] = false;
              newlyShaved++;
            }
          }
        }
      }
      const totalShaved = c.beardMask.filter(v => !v).length;
      c.shavedRatio = Number((totalShaved / c.beardMask.length).toFixed(3));
      next.soundQueue.push({
        kind: "trimmer_buzz",
        load: Math.min(1, 0.35 + newlyShaved * 0.08),
      });

      if (c.shavedRatio >= 0.45) {
        c.trimmerActive = false;
        c.step = "this_is_a_sign_wake";
        next.storyLine =
          "His beard has a glorious mouse-highway carved right through it! Tap the mirror so he wakes and inspects your handiwork.";
      } else {
        const pct = Math.round(c.shavedRatio * 100);
        next.storyLine = `Beard trimmed: ${pct}% (need 45%). Watch Pip on his nose—stop buzzing if he twitches!`;
      }
      return next;
    }
    case "advance_sleep_timer": {
      if (c.step !== "beard_shave") return next;
      c.phaseTimerSec += Math.max(0, action.dtSec);
      const cycle = c.phaseTimerSec % 7.5;
      const prev = c.sleepPhase;
      if (cycle < 4.5) {
        c.sleepPhase = "deep_sleep";
      } else if (cycle < 6.0) {
        c.sleepPhase = "twitch_warning";
      } else {
        c.sleepPhase = "stirring";
      }
      if (prev !== "stirring" && c.sleepPhase === "stirring") {
        next.soundQueue.push({ kind: "man_stir_snort" });
        if (!c.trimmerActive) {
          c.micePlayingDead = true;
        }
      }
      if (c.sleepPhase === "deep_sleep") {
        c.micePlayingDead = false;
      }
      return next;
    }
    case "speak_this_is_a_sign": {
      if (c.step !== "this_is_a_sign_wake") return next;
      c.wokeLineSpoken = true;
      c.step = "phone_pinball";
      next.soundQueue.push({ kind: "this_is_a_sign" });
      next.storyLine =
        "He blinks at the exact path you shaved through his beard, touches his chin, and whispers: “…this is a sign.” Now bounce across his glowing phone notifications!";
      return next;
    }
    case "hit_pinball_bumper": {
      if (c.step !== "phone_pinball") return next;
      if (!c.pinballHits.includes(action.target)) {
        c.pinballHits.push(action.target);
      }
      next.soundQueue.push({ kind: "pinball_bumper", target: action.target });
      if (c.pinballHits.length >= 3) {
        c.daughterCalled = true;
        c.step = "complete";
        if (!next.completedChapters.includes(2)) next.completedChapters.push(2);
        next.storyLine =
          "RING-RING! FaceTime connects! His daughter gasps at the screen: “Daddy… what did you do to your beard?! And… you have a MOUSE?!”";
      } else {
        next.storyLine = `Phone pinball bumper ${c.pinballHits.length}/3 lit (${c.pinballHits.join(" · ")})! Bounce the remaining notification!`;
      }
      return next;
    }
  }
}

// ---------------------------------------------------------------------------
// Chapter 3 Actions — Leftovers
// ---------------------------------------------------------------------------
export type Chapter3Action =
  | { type: "load_scrap_spoon" }
  | { type: "advance_breath"; dtSec: number; forcePhase?: BreathPhase }
  | { type: "launch_spoon" }
  | { type: "transition_to_chapter_4" };

export function stepChapter3(state: SmallComfortsStoryState, action: Chapter3Action): SmallComfortsStoryState {
  const next = structuredClone(state);
  const c = next.ch3;

  switch (action.type) {
    case "load_scrap_spoon": {
      if (c.step === "complete" || c.step === "choking_onset") return next;
      c.spoonLoaded = true;
      c.spoonTension = 0.85;
      c.step = "wait_for_inhale";
      const course = SCRAP_COURSES[c.courseIndex] ?? SCRAP_COURSES[0];
      next.soundQueue.push({ kind: "cap_clink" });
      next.storyLine = `Loaded on the spoon catapult: ${course.label}. Wait for his chest to rise on the IN-BREATH, then fire!`;
      return next;
    }
    case "advance_breath": {
      if (c.step === "complete" || c.step === "choking_onset") return next;
      if (action.forcePhase) {
        c.breathPhase = action.forcePhase;
        c.mouthOpenness =
          action.forcePhase === "inhale_open"
            ? 0.92
            : action.forcePhase === "peak_hold"
              ? 0.78
              : action.forcePhase === "exhale_snore"
                ? 0.25
                : 0.15;
        return next;
      }
      c.breathTimerSec += Math.max(0, action.dtSec);
      const cycle = c.breathTimerSec % 4.8;
      if (cycle < 1.8) {
        c.breathPhase = "inhale_open";
        c.mouthOpenness = 0.9;
      } else if (cycle < 2.5) {
        c.breathPhase = "peak_hold";
        c.mouthOpenness = 0.75;
      } else if (cycle < 3.9) {
        c.breathPhase = "exhale_snore";
        c.mouthOpenness = 0.22;
      } else {
        c.breathPhase = "rest";
        c.mouthOpenness = 0.12;
      }
      return next;
    }
    case "launch_spoon": {
      if (c.step !== "wait_for_inhale" || !c.spoonLoaded) return next;
      next.soundQueue.push({ kind: "spoon_twang" });
      const course = SCRAP_COURSES[c.courseIndex] ?? SCRAP_COURSES[0];

      if (c.breathPhase === "exhale_snore" || c.breathPhase === "rest") {
        c.spoonLoaded = false;
        c.step = "load_spoon";
        c.mustacheScraps += 1;
        next.soundQueue.push({ kind: "exhale_blast" });
        triggerPratfall(
          next,
          "exhale_scrap_blowback",
          "biscuit",
          "HONK-SHOO! Blown Back by the Snore!",
          `You fired on the EXHALE! His snore gale blasts the ${course.label} straight back into Biscuit’s chef hat and confetti-powders his mustache!`,
          3.3,
        );
        return next;
      }

      // Hit on the in-breath!
      next.soundQueue.push({ kind: "inhale_swell" });
      c.coursesFed.push(course.id);
      c.spoonLoaded = false;

      if (c.coursesFed.length >= SCRAP_COURSES.length) {
        c.chokingTriggered = true;
        c.step = "choking_onset";
        if (!next.completedChapters.includes(3)) next.completedChapters.push(3);
        next.soundQueue.push({ kind: "gulp_choke" });
        next.storyLine =
          "GULP! The Deviled Guilt Egg goes down on the in-breath—and lodges sideways! His eyes bug out! He’s choking! Cue Chapter Four!";
      } else {
        c.courseIndex += 1;
        c.step = "load_spoon";
        const nextCourse = SCRAP_COURSES[c.courseIndex];
        next.storyLine = ` Course ${c.coursesFed.length}/3 went right down the hatch on the in-breath! Next up: ${nextCourse.label}.`;
      }
      return next;
    }
    case "transition_to_chapter_4": {
      c.step = "complete";
      if (!next.completedChapters.includes(3)) next.completedChapters.push(3);
      next.activeChapter = 4;
      next.showingChapterCard = true;
      next.ch4 = createInitialChapter4();
      next.storyLine = CHAPTER_CARDS[3].subtitle;
      return next;
    }
  }
}

// ---------------------------------------------------------------------------
// Chapter 4 Actions — The Heimlich & Free Singing Glass Shards
// ---------------------------------------------------------------------------
export type Chapter4Action =
  | { type: "advance_intro_beat" }
  | { type: "tick_compression"; dtSec: number; forceCompression?: number }
  | { type: "mouse_jump"; mouse?: MouseActorId };

export function stepChapter4(state: SmallComfortsStoryState, action: Chapter4Action): SmallComfortsStoryState {
  const next = structuredClone(state);
  const c = next.ch4;

  switch (action.type) {
    case "advance_intro_beat": {
      if (c.beat === "1_fed_and_choking") {
        c.beat = "2_stands_and_backs_up";
        next.soundQueue.push({ kind: "gulp_choke" });
        next.storyLine =
          "He lurches upright out of bed, both hands clutching his throat, stumbling backward across the floorboards!";
        return next;
      }
      if (c.beat === "2_stands_and_backs_up") {
        c.beat = "3_breaks_bedroom_window";
        c.windowShattered = true;
        next.soundQueue.push({ kind: "window_shatter" });
        // The shards celebrate immediately on shattering!
        const firstHarmony = SHARD_CHORUS_HARMONIES[0];
        next.soundQueue.push({
          kind: "glass_shard_chorus",
          jumpIndex: 0,
          syllable: "WE’RE FREE! ♫",
          notesHz: firstHarmony.notesHz,
        });
        c.lastShardChorusSyllable = "WE’RE FREE! ♫";
        c.lastShardChorusBanner =
          "CRASH! The bedroom window shatters! The glass shards pop eyes and grins: “No more window frame—we’re FREE!”";
        next.storyLine = c.lastShardChorusBanner;
        return next;
      }
      if (c.beat === "3_breaks_bedroom_window") {
        c.beat = "4_falls_outside_on_ass";
        c.manOutsideOnAss = true;
        next.soundQueue.push({ kind: "ass_thud" });
        next.storyLine =
          "WHUMP! He tumbles backward through the sash and lands flat on his ass in the courtyard shrub!";
        return next;
      }
      if (c.beat === "4_falls_outside_on_ass") {
        c.beat = "5_neighbor_rushes_in";
        c.neighborPresent = true;
        c.neighborBrokenArmCastVisible = true;
        next.storyLine =
          "The Neighbour sprints over! She wraps her one good arm around his waist—her left arm is in a huge plaster cast, so her one-armed Heimlich doesn’t have enough oomph!";
        return next;
      }
      if (c.beat === "5_neighbor_rushes_in") {
        c.beat = "6_one_armed_heimlich_sync";
        c.compressionCycle = 0.52; // Start inside the readable sync zone so the player can immediately see & hit it
        next.storyLine =
          "JUMP IN SYNC! Tap JUMP when her one-armed Heimlich ring hits the GOLD zone! Watch the free glass shards sing a cappella on every jump!";
        return next;
      }
      return next;
    }

    case "tick_compression": {
      if (c.beat !== "6_one_armed_heimlich_sync") return next;
      if (typeof action.forceCompression === "number") {
        c.compressionCycle = Math.max(0, Math.min(1, action.forceCompression));
      } else {
        c.compressionCycle = (c.compressionCycle + Math.max(0, action.dtSec) * c.compressionSpeed) % 1;
      }
      // Decay shard bounce smoothly
      c.shards = c.shards.map(s => ({
        ...s,
        bounceAmt: Math.max(0, Number((s.bounceAmt - Math.max(0, action.dtSec) * 1.8).toFixed(3))),
      }));
      return next;
    }

    case "mouse_jump": {
      if (c.beat !== "6_one_armed_heimlich_sync") return next;
      const order: readonly MouseActorId[] = ["pip", "biscuit", "conductor"];
      const nextMouse =
        action.mouse ?? order.find(m => !c.syncedMice.includes(m)) ?? "conductor";

      // Every single mouse jump makes the free glass shards bounce and sing a cappella celebration notes!
      c.totalMouseJumps += 1;
      const harmonyIdx = (c.totalMouseJumps - 1) % SHARD_CHORUS_HARMONIES.length;
      const harmony = SHARD_CHORUS_HARMONIES[harmonyIdx];
      c.lastShardChorusSyllable = harmony.syllable;
      c.lastShardChorusBanner = harmony.banner;
      c.shards = c.shards.map((s, idx) => ({
        ...s,
        bounceAmt: 1.0,
        lyric:
          idx === (c.totalMouseJumps - 1) % c.shards.length
            ? harmony.syllable
            : s.lyric,
      }));
      next.soundQueue.push({
        kind: "glass_shard_chorus",
        jumpIndex: c.totalMouseJumps,
        syllable: harmony.syllable,
        notesHz: harmony.notesHz,
      });

      // Check if jump is in sync with the Neighbour's one-armed compression window (0.30 .. 0.78)
      const inSync = c.compressionCycle >= 0.3 && c.compressionCycle <= 0.78;
      next.soundQueue.push({ kind: "heimlich_grunt", synced: inSync });

      if (!inSync) {
        triggerPratfall(
          next,
          "heimlich_early_bounce",
          nextMouse,
          `OFF-BEAT BOUNCE! (${harmony.syllable})`,
          `The glass shards sang “${harmony.syllable}” in sweet four-part harmony, but ${nextMouse.toUpperCase()} bounced between her thrusts! Wait for the GOLD compression beat!`,
          3.1,
        );
        return next;
      }

      if (!c.syncedMice.includes(nextMouse)) {
        c.syncedMice.push(nextMouse);
      }

      if (c.syncedMice.length >= 3) {
        c.beat = "7_triumphant_expulsion";
        c.foodExpelled = true;
        c.caughtInConductorHat = true;
        c.hatsOnWindowsill = true;
        if (!next.completedChapters.includes(4)) next.completedChapters.push(4);
        next.soundQueue.push({ kind: "cork_pop_triumph" });
        next.storyLine =
          "THOOMP-POP! Pip, Biscuit, and Conductor slam the curtain-cord in dead sync with her one-armed thrust! The deviled egg rockets out into Conductor’s hovering cap while the free glass shards belt a grand finale chord!";
      } else {
        const remaining = 3 - c.syncedMice.length;
        next.storyLine = `SYNC HIT (${c.syncedMice.length}/3)! Shards sing “${harmony.syllable}”! ${remaining} more mouse jump${remaining === 1 ? "" : "s"} on the gold beat!`;
      }
      return next;
    }
  }
}

export function completeChapter4Finale(state: SmallComfortsStoryState): SmallComfortsStoryState {
  const next = structuredClone(state);
  next.ch4.beat = "complete";
  if (!next.completedChapters.includes(4)) next.completedChapters.push(4);
  next.storyLine =
    "Outside on the grass, the man and his cast-armed neighbour look up at the broken sill: three tiny mouse hats hover in mid-air, tip once in salute, and vanish inside the tin.";
  return next;
}
