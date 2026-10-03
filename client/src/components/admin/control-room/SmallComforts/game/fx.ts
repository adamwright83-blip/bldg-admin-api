import * as THREE from "three";

function glyph(ch: string, color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!; g.font = "bold 46px 'Trebuchet MS', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 8; g.strokeStyle = "#2a1d2e"; g.strokeText(ch, 32, 34); g.fillStyle = color; g.fillText(ch, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const zTex = () => (zT ??= glyph("Z", "#ffffff"));
const sTex = () => (sT ??= glyph("★", "#ffd23f"));
let zT: THREE.CanvasTexture | null = null, sT: THREE.CanvasTexture | null = null;

interface P { s: THREE.Object3D; v: THREE.Vector3; life: number; max: number; spin?: number; grow?: number }

export class Fx {
  group = new THREE.Group();
  private ps: P[] = [];
  private sprite(tex: THREE.Texture, size: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    s.scale.setScalar(size); s.renderOrder = 20; return s;
  }
  z(pos: THREE.Vector3) {
    const s = this.sprite(zTex(), 0.4); s.position.copy(pos);
    this.group.add(s); this.ps.push({ s, v: new THREE.Vector3(0.18, 0.5, 0), life: 0, max: 2.2, grow: 1.4 });
  }
  stars(pos: THREE.Vector3) {
    for (let i = 0; i < 4; i++) {
      const s = this.sprite(sTex(), 0.28); s.position.copy(pos);
      const a = (i / 4) * Math.PI * 2;
      this.group.add(s); this.ps.push({ s, v: new THREE.Vector3(Math.cos(a) * 1.4, 0.6, Math.sin(a) * 1.4), life: 0, max: 0.9 });
    }
  }
  poof(pos: THREE.Vector3, colors = ["#ffd23f", "#ffffff", "#f08fa3"]) {
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 8, 6), new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
      m.position.copy(pos);
      const a = Math.random() * Math.PI * 2, u = 1 + Math.random() * 1.6;
      this.group.add(m); this.ps.push({ s: m, v: new THREE.Vector3(Math.cos(a) * u, 1.6 + Math.random() * 1.4, Math.sin(a) * u), life: 0, max: 0.8 + Math.random() * 0.4 });
    }
  }
  update(dt: number) {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i]; p.life += dt;
      const k = p.life / p.max;
      p.s.position.addScaledVector(p.v, dt);
      if (!p.grow) p.v.y -= 4.5 * dt;
      const mat = (p.s as THREE.Sprite | THREE.Mesh).material as THREE.Material & { opacity: number };
      mat.opacity = Math.max(0, 1 - k * k);
      if (p.grow) p.s.scale.setScalar(0.4 + k * p.grow * 0.5);
      if (k >= 1) { this.group.remove(p.s); this.ps.splice(i, 1); }
    }
  }
}
