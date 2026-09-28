import { describe, expect, it, vi } from "vitest";
import { installAuthoritativeActionResume } from "./useAuthoritativeActionResume";

class FakeEventTarget {
  private listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | AddEventListenerOptions
  ) {
    if (!listener) return;
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | EventListenerOptions
  ) {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type: string) {
    const event = new Event(type);
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
}

describe("installAuthoritativeActionResume", () => {
  it("does not install global lifecycle listeners until an external handoff is armed", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = installAuthoritativeActionResume({
      documentTarget,
      windowTarget,
      isVisible: () => true,
      onResume: async () => {},
    });

    expect(documentTarget.count("visibilitychange")).toBe(0);
    expect(windowTarget.count("pageshow")).toBe(0);
    expect(windowTarget.count("focus")).toBe(0);
    expect(windowTarget.count("blur")).toBe(0);
    expect(windowTarget.count("pagehide")).toBe(0);

    controller.dispose();
  });

  it("consumes one resume burst and removes every handoff listener", async () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const onResume = vi.fn(async () => {});
    const controller = installAuthoritativeActionResume({
      documentTarget,
      windowTarget,
      isVisible: () => true,
      onResume,
    });

    controller.arm();
    expect(documentTarget.count("visibilitychange")).toBe(1);
    expect(windowTarget.count("pageshow")).toBe(1);
    expect(windowTarget.count("focus")).toBe(1);
    expect(windowTarget.count("blur")).toBe(1);
    expect(windowTarget.count("pagehide")).toBe(1);

    windowTarget.dispatch("blur");
    windowTarget.dispatch("focus");
    await Promise.resolve();

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(documentTarget.count("visibilitychange")).toBe(0);
    expect(windowTarget.count("pageshow")).toBe(0);
    expect(windowTarget.count("focus")).toBe(0);
    expect(windowTarget.count("blur")).toBe(0);
    expect(windowTarget.count("pagehide")).toBe(0);

    windowTarget.dispatch("pageshow");
    windowTarget.dispatch("focus");
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("dispose removes armed listeners without resuming", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const onResume = vi.fn(async () => {});
    const controller = installAuthoritativeActionResume({
      documentTarget,
      windowTarget,
      isVisible: () => true,
      onResume,
    });

    controller.arm();
    controller.dispose();

    expect(documentTarget.count("visibilitychange")).toBe(0);
    expect(windowTarget.count("pageshow")).toBe(0);
    expect(windowTarget.count("focus")).toBe(0);
    expect(windowTarget.count("blur")).toBe(0);
    expect(windowTarget.count("pagehide")).toBe(0);
    windowTarget.dispatch("focus");
    expect(onResume).not.toHaveBeenCalled();
  });
});
