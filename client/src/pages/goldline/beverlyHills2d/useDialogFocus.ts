import { useEffect, type RefObject } from "react";
/** Trap keyboard focus in an open dialog and restore it on dismissal. */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  active: boolean
) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const host = ref.current;
    const before = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(
        host.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary"
        )
      ).filter(el => el.getClientRects().length > 0);
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const all = items();
      const first = all[0],
        last = all.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !host.contains(document.activeElement))
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !host.contains(document.activeElement))
      ) {
        e.preventDefault();
        first?.focus();
      }
    };
    host.addEventListener("keydown", key);
    return () => {
      host.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [active, ref]);
}
