/**
 * Mobile-first input. A floating thumbstick appears wherever the left thumb
 * lands on the left half; dragging on the right half looks around. Keyboard
 * (WASD / arrows, Q/E or J/L to look) is for QA. Every listener added here is
 * removed in dispose().
 */
export type MoveVector = { x: number; y: number };

const STICK_RADIUS_PX = 58;
const DEADZONE = 0.12;
const LOOK_RAD_PER_PX = 0.0062;

export class ProofInput {
  /** x: right, y: forward, magnitude <= 1 */
  readonly move: MoveVector = { x: 0, y: 0 };
  /** radians accumulated since the last consumeLook() */
  private lookYaw = 0;
  private lookPitch = 0;
  lastLookAt = -Infinity;
  lastMoveAt = -Infinity;
  enabled = true;
  /** Set by the autopilot; when non-null it replaces user movement. */
  override: MoveVector | null = null;
  lineHeld = false;
  private jumpQueued = false;

  private readonly el: HTMLElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickValue = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private keys = new Set<string>();
  private readonly cleanups: Array<() => void> = [];

  constructor(el: HTMLElement) {
    this.el = el;
    this.stick = document.createElement("div");
    this.stick.className = "cmp-stick";
    this.knob = document.createElement("div");
    this.knob.className = "cmp-stick-knob";
    this.stick.appendChild(this.knob);
    el.appendChild(this.stick);
    const jump = document.createElement("button");
    jump.className = "cmp-action cmp-jump";
    jump.textContent = "JUMP";
    jump.type = "button";
    const hook = document.createElement("button");
    hook.className = "cmp-action cmp-hook";
    hook.textContent = "LINE";
    hook.type = "button";
    el.append(jump, hook);
    this.cleanups.push(() => jump.remove(), () => hook.remove());

    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, "pointerdown", e => this.onDown(e), { passive: false });
    on(el, "pointermove", e => this.onMove(e), { passive: false });
    on(el, "pointerup", e => this.onUp(e));
    on(el, "pointercancel", e => this.onUp(e));
    on(el, "contextmenu", e => e.preventDefault());
    on(window, "keydown", e => this.onKey(e as KeyboardEvent, true));
    on(window, "keyup", e => this.onKey(e as KeyboardEvent, false));
    on(window, "blur", () => this.keys.clear());
    on(jump, "pointerdown", e => { this.jumpQueued = true; e.stopPropagation(); e.preventDefault(); });
    on(hook, "pointerdown", e => { this.lineHeld = true; e.stopPropagation(); e.preventDefault(); });
    on(hook, "pointerup", e => { this.lineHeld = false; e.stopPropagation(); });
    on(hook, "pointercancel", () => { this.lineHeld = false; });
  }

  private onDown(e: PointerEvent) {
    if (!this.enabled) return;
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const leftHalf = x < rect.width * 0.5;
    if (leftHalf && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickValue = { x: 0, y: 0 };
      this.stick.style.transform = `translate(${x}px, ${e.clientY - rect.top}px)`;
      this.stick.classList.add("is-active");
      this.knob.style.transform = "translate(-50%, -50%)";
    } else if (!leftHalf && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    } else {
      return;
    }
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers in tests cannot always be captured */
    }
    e.preventDefault();
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_RADIUS_PX ? STICK_RADIUS_PX / len : 1;
      const kx = dx * k;
      const ky = dy * k;
      this.knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      this.stickValue = { x: kx / STICK_RADIUS_PX, y: -ky / STICK_RADIUS_PX };
      e.preventDefault();
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookYaw -= dx * LOOK_RAD_PER_PX;
      this.lookPitch += dy * LOOK_RAD_PER_PX * 0.7;
      if (Math.abs(dx) + Math.abs(dy) > 0) this.lastLookAt = performance.now();
      e.preventDefault();
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickValue = { x: 0, y: 0 };
      this.stick.classList.remove("is-active");
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "q", "e", "j", "l", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " "].includes(k)) {
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      if (k.startsWith("arrow")) e.preventDefault();
    }
    if (k === " " && down && !e.repeat) this.jumpQueued = true;
    if (k === "e") this.lineHeld = down;
  }

  /** Called once per frame before the controller reads `move`. */
  update(dt: number, now: number) {
    let x = this.stickValue.x;
    let y = this.stickValue.y;
    const kx = (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0) - (this.keys.has("a") || this.keys.has("arrowleft") ? 1 : 0);
    const ky = (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0) - (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      const slow = this.keys.has("shift") ? 0.45 : 1;
      x = (kx / len) * slow;
      y = (ky / len) * slow;
    }
    const lookKeys = (this.keys.has("q") || this.keys.has("j") ? 1 : 0) - (this.keys.has("l") ? 1 : 0);
    if (lookKeys) {
      this.lookYaw += lookKeys * 1.9 * dt;
      this.lastLookAt = now;
    }
    if (this.override) {
      x = this.override.x;
      y = this.override.y;
    }
    const mag = Math.hypot(x, y);
    if (mag < DEADZONE) {
      this.move.x = 0;
      this.move.y = 0;
    } else {
      // remap so the stick is live immediately past the deadzone
      const m = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
      this.move.x = (x / mag) * m;
      this.move.y = (y / mag) * m;
      this.lastMoveAt = now;
    }
  }

  consumeLook(): { yaw: number; pitch: number } {
    const out = { yaw: this.lookYaw, pitch: this.lookPitch };
    this.lookYaw = 0;
    this.lookPitch = 0;
    return out;
  }

  consumeJump() {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  }

  dispose() {
    for (const fn of this.cleanups.splice(0)) fn();
    this.stick.remove();
  }
}
