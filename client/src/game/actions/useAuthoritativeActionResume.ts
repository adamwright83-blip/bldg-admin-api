import { useCallback, useEffect, useRef } from "react";

type EventSource = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export type AuthoritativeResumeController = {
  arm: () => void;
  dispose: () => void;
};

/**
 * Installs one external-handoff resume controller. Android commonly emits
 * visibilitychange, pageshow, and focus as a burst; arming is consumed before
 * refetch begins, so that burst results in one read and never a write.
 */
export function installAuthoritativeActionResume(input: {
  documentTarget: EventSource;
  windowTarget: EventSource;
  isVisible: () => boolean;
  onResume: () => Promise<void>;
}): AuthoritativeResumeController {
  let armed = false;
  let departed = false;
  let disposed = false;
  let inFlight: Promise<void> | null = null;

  const resume = () => {
    if (disposed || !armed || !departed || !input.isVisible() || inFlight)
      return;
    armed = false;
    departed = false;
    const pending = input.onResume().finally(() => {
      if (inFlight === pending) inFlight = null;
    });
    inFlight = pending;
  };
  const visibility = () => {
    if (!input.isVisible()) departed = true;
    else resume();
  };
  const pageshow = () => resume();
  const focus = () => resume();
  const depart = () => {
    if (armed) departed = true;
  };

  input.documentTarget.addEventListener("visibilitychange", visibility);
  input.windowTarget.addEventListener("pageshow", pageshow);
  input.windowTarget.addEventListener("focus", focus);
  input.windowTarget.addEventListener("blur", depart);
  input.windowTarget.addEventListener("pagehide", depart);

  return {
    arm: () => {
      if (!disposed) armed = true;
      departed = false;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      armed = false;
      input.documentTarget.removeEventListener("visibilitychange", visibility);
      input.windowTarget.removeEventListener("pageshow", pageshow);
      input.windowTarget.removeEventListener("focus", focus);
      input.windowTarget.removeEventListener("blur", depart);
      input.windowTarget.removeEventListener("pagehide", depart);
    },
  };
}

export function useAuthoritativeActionResume(onResume: () => Promise<void>) {
  const callback = useRef(onResume);
  const controller = useRef<AuthoritativeResumeController | null>(null);
  callback.current = onResume;

  useEffect(() => {
    const installed = installAuthoritativeActionResume({
      documentTarget: document,
      windowTarget: window,
      isVisible: () => document.visibilityState !== "hidden",
      onResume: () => callback.current(),
    });
    controller.current = installed;
    return () => {
      installed.dispose();
      if (controller.current === installed) controller.current = null;
    };
  }, []);

  return useCallback(() => controller.current?.arm(), []);
}
