import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioManager, cueCategory, scheduleCue, type AudioCueId } from "./AudioManager";

/**
 * Autoplay policy: a Web Audio context only runs once a real user gesture has
 * created or resumed it. These run under vitest's "node" environment, so the
 * browser pieces are small fakes: a window that is an EventTarget, and an
 * AudioContext whose resume() only succeeds when the fake says a gesture
 * counted.
 */

type FakeState = "suspended" | "running" | "closed";

class FakeParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  type = "";
  buffer: unknown = null;
  connect(next?: unknown) {
    return next ?? this;
  }
  start() {}
  stop() {}
}

let honourGestures = true;
const contexts: FakeAudioContext[] = [];

class FakeAudioContext extends EventTarget {
  state: FakeState = "suspended";
  sampleRate = 48_000;
  currentTime = 0;
  destination = new FakeNode();
  resumeCalls = 0;
  constructor() {
    super();
    contexts.push(this);
  }
  resume() {
    this.resumeCalls += 1;
    if (honourGestures) this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
  createWaveShaper() {
    return Object.assign(new FakeNode(), { curve: null as Float32Array | null, oversample: "none" });
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
}

const store = new Map<string, string>();
let fakeWindow: EventTarget & Record<string, unknown>;

async function settle() {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
}

beforeEach(() => {
  store.clear();
  contexts.length = 0;
  honourGestures = true;
  fakeWindow = Object.assign(new EventTarget(), {
    AudioContext: FakeAudioContext,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
  (globalThis as { window?: unknown }).window = fakeWindow;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("audio unlock", () => {
  it("survives a muted start: a gesture made while muted does not use the unlock up", async () => {
    store.set("goldline:audio:muted", "1");
    const audio = new AudioManager();
    audio.primeOnGesture(fakeWindow);

    fakeWindow.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(contexts).toHaveLength(0);

    // The unmute button's own click is the gesture that starts the sound.
    audio.setMuted(false);
    await settle();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.state).toBe("running");
    expect(audio.isRunning).toBe(true);
  });

  it("keeps listening when the browser does not count a gesture, and does nothing more once running", async () => {
    const audio = new AudioManager();
    audio.primeOnGesture(fakeWindow);

    // e.g. a touch pointerdown, which is not a user activation
    honourGestures = false;
    fakeWindow.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(contexts[0]!.state).toBe("suspended");

    honourGestures = true;
    fakeWindow.dispatchEvent(new Event("pointerup"));
    await settle();
    expect(contexts[0]!.state).toBe("running");

    const calls = contexts[0]!.resumeCalls;
    fakeWindow.dispatchEvent(new Event("click"));
    await settle();
    expect(contexts[0]!.resumeCalls).toBe(calls);
  });

  it("mutes by suspending the device's audio and plays nothing until unmuted", async () => {
    const audio = new AudioManager();
    audio.primeOnGesture(fakeWindow);
    fakeWindow.dispatchEvent(new Event("click"));
    await settle();
    expect(audio.isRunning).toBe(true);

    audio.setMuted(true);
    await settle();
    expect(contexts[0]!.state).toBe("suspended");
    expect(audio.isRunning).toBe(false);

    audio.setMuted(false);
    await settle();
    expect(contexts[0]!.state).toBe("running");
    expect(contexts).toHaveLength(1);
  });

  it("plays the cue asked for by the very tap that unlocks audio", async () => {
    const audio = new AudioManager();
    audio.primeOnGesture(fakeWindow);
    let started = 0;
    const createOscillator = FakeAudioContext.prototype.createOscillator;
    FakeAudioContext.prototype.createOscillator = function () {
      return Object.assign(createOscillator.call(this), { start: () => void (started += 1) });
    };
    try {
      // Capture-phase unlock, then the button's own handler asks for a cue.
      honourGestures = false;
      fakeWindow.dispatchEvent(new Event("click"));
      audio.play("ui_tap");
      expect(started).toBe(1);
      await settle();
      // No gesture in flight and still not running: nothing piles up.
      audio.play("ui_tap");
      expect(started).toBe(1);
    } finally {
      FakeAudioContext.prototype.createOscillator = createOscillator;
    }
  });

  it("brings audio back on the next tap if the device takes it away", async () => {
    const audio = new AudioManager();
    audio.primeOnGesture(fakeWindow);
    fakeWindow.dispatchEvent(new Event("click"));
    await settle();

    const ctx = contexts[0]!;
    ctx.state = "suspended";
    fakeWindow.dispatchEvent(new Event("touchend"));
    await settle();
    expect(ctx.state).toBe("running");
  });

  it("arms once for the life of the page: listener counts never change", async () => {
    // Goldline's e2e lifecycle gate compares listener counts before and after
    // remounts, so arming must add each listener exactly once and never
    // remove it — not even once audio is running.
    const added: string[] = [];
    const removed: string[] = [];
    const addEventListener = fakeWindow.addEventListener.bind(fakeWindow);
    const removeEventListener = fakeWindow.removeEventListener.bind(fakeWindow);
    fakeWindow.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      return (addEventListener as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof fakeWindow.addEventListener;
    fakeWindow.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (removeEventListener as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof fakeWindow.removeEventListener;

    const audio = new AudioManager();
    audio.primeOnGesture(fakeWindow);
    audio.primeOnGesture(fakeWindow);
    fakeWindow.dispatchEvent(new Event("click"));
    await settle();
    audio.setMuted(true);
    audio.setMuted(false);
    audio.primeOnGesture(fakeWindow);
    await settle();

    expect(audio.isRunning).toBe(true);
    expect([...added].sort()).toEqual(["click", "keydown", "pointerdown", "pointerup", "touchend"]);
    expect(removed).toEqual([]);
  });
});

describe("the Colosseum's hit cues", () => {
  const HIT_CUES: AudioCueId[] = [
    "clockface_impact",
    "clockhead_howl",
    "clockhead_roar",
    "borrowed_minute",
    "seal_lock",
  ];

  it.each(HIT_CUES)("%s is fiction, never a business-result sound", cue => {
    expect(cueCategory(cue)).toBe("encounter");
  });

  it.each(["level_complete", "radio_static", "radio_chirp", "voice_cut", "companion_join"] as AudioCueId[])(
    "%s (the Colosseum aftermath) is fiction's world, never a business win",
    cue => {
      expect(cueCategory(cue)).toBe("world");
      const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
      expect(() => scheduleCue(ctx, (ctx as unknown as FakeAudioContext).destination as unknown as AudioNode, cue)).not.toThrow();
    }
  );

  it.each(HIT_CUES)("%s schedules onto any audio graph", cue => {
    const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
    expect(() => scheduleCue(ctx, (ctx as unknown as FakeAudioContext).destination as unknown as AudioNode, cue, { pitch: 1.05 })).not.toThrow();
  });
});
