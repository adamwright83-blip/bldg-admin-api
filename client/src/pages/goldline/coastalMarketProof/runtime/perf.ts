import * as THREE from "three";

const bufferSize = new THREE.Vector2();

/**
 * ?perf=1 overlay. Numbers are whatever this browser measures; the overlay
 * prints the GPU string and render size so a screenshot says where it ran.
 */
export class PerfMeter {
  private readonly frames: number[] = [];
  /** main-thread ms spent inside our frame callback (update + render submit), independent of vsync */
  private readonly work: number[] = [];
  private last = 0;
  private fpsWindowStart = 0;
  private fpsFrames = 0;
  fps = 0;
  p95 = 0;
  drawCalls = 0;
  triangles = 0;
  private readonly el: HTMLDivElement;
  private readonly gpu: string;
  private readonly build: string;
  private lastPaint = 0;

  constructor(parent: HTMLElement, renderer: THREE.WebGLRenderer, build: string, visible: boolean) {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.build = build;
    this.el = document.createElement("div");
    this.el.className = "cmp-perf";
    this.el.hidden = !visible;
    parent.appendChild(this.el);
  }

  recordWork(ms: number) {
    this.work.push(ms);
    if (this.work.length > 300) this.work.shift();
  }

  frame(now: number, renderer: THREE.WebGLRenderer) {
    if (this.last) {
      this.frames.push(now - this.last);
      if (this.frames.length > 300) this.frames.shift();
    }
    this.last = now;
    this.fpsFrames++;
    if (!this.fpsWindowStart) this.fpsWindowStart = now;
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsWindowStart);
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
      const sorted = [...this.frames].sort((a, b) => a - b);
      this.p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    }
    this.drawCalls = renderer.info.render.calls;
    this.triangles = renderer.info.render.triangles;
    if (!this.el.hidden && now - this.lastPaint > 250) {
      this.lastPaint = now;
      const size = renderer.getDrawingBufferSize(bufferSize);
      this.el.textContent =
        `${this.fps.toFixed(0)} fps  p95 ${this.p95.toFixed(1)} ms  cpu ${this.workP95().toFixed(1)} ms\n` +
        `${this.drawCalls} draws  ${(this.triangles / 1000).toFixed(0)}k tris\n` +
        `${size.x}x${size.y} @${renderer.getPixelRatio().toFixed(2)}  dpr ${window.devicePixelRatio}\n` +
        `${this.gpu.slice(0, 60)}\n${this.build}`;
    }
  }

  private workP95() {
    const w = [...this.work].sort((a, b) => a - b);
    return w.length ? w[Math.floor(w.length * 0.95)] : 0;
  }

  snapshot() {
    const sorted = [...this.frames].sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    return {
      fps: this.fps,
      meanFrameMs: mean,
      p95FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      p99FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0,
      samples: sorted.length,
      cpuMeanMs: this.work.length ? this.work.reduce((a, b) => a + b, 0) / this.work.length : 0,
      cpuP95Ms: this.workP95(),
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      gpu: this.gpu,
    };
  }

  toggle() {
    this.el.hidden = !this.el.hidden;
  }

  dispose() {
    this.el.remove();
  }
}
