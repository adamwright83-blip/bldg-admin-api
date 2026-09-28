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
 * Arms external-handoff resume only when the operator actually launches an
 * external action. Android commonly emits visibilitychange, pageshow, and
 * focus as a burst; arming is consumed before refetch begins, so that burst
 * results in one read and never a write.
 *
 * Keeping these global lifecycle listeners detached until arm() matters:
 * merely opening a VISIT/FOLLOW_UP surface must not change the world's
 * listener footprint, and a completed surface must never leave resume
 * listeners behind.
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
  let listening = false;
  let inFlight: Promise<void> | null = null;

  const detach = () => {
    if (!listening) return;
    input.documentTarget.removeEventListener("visibilitychange", visibility);
    input.windowTarget.removeEventListener("pageshow", pageshow);
    input.windowTarget.removeEventListener("focus", focus);
    input.windowTarget.removeEventListener("blur", depart);
    input.windowTarget.removeEventListener("pagehide", depart);
    listening = false;
  };

  const resume = () => {
    if (disposed || !armed || !departed || !input.isVisible() || inFlight)
      return;
    armed = false;
    departed = false;
    detach();
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

  const attach = () => {
    if (disposed || listening) return;
    input.documentTarget.addEventListener("visibilitychange", visibility);
    input.windowTarget.addEventListener("pageshow", pageshow);
    input.windowTarget.addEventListener("focus", focus);
    input.windowTarget.addEventListener("blur", depart);
    input.windowTarget.addEventListener("pagehide", depart);
    listening = true;
  };

  return {
    arm: () => {
      if (disposed) return;
      armed = true;
      departed = false;
      attach();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      armed = false;
      departed = false;
      detach();
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
