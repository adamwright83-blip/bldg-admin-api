import * as THREE from "three";
import type { AnatomyProject } from "../logic/episode";
import { rbox, toon, ball } from "./style";

function clothPlane(width: number, depth: number, color: string) {
  const geo = new THREE.PlaneGeometry(width, depth, 8, 5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const sag = (1 - Math.pow(Math.min(1, Math.abs(x) / (width / 2)), 2)) * 0.16;
    pos.setZ(i, -sag + Math.sin(y * 8 + x * 3) * 0.012);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, toon(color));
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class AnatomyWorks {
  group = new THREE.Group();
  private built = new Map<AnatomyProject, THREE.Group>();
  private born = new Map<AnatomyProject, number>();

  sync(projects: readonly AnatomyProject[], now: number) {
    for (const project of projects) {
      if (this.built.has(project)) continue;
      const g = this.build(project);
      g.name = `Anatomy_${project}`;
      g.scale.setScalar(0.001);
      this.group.add(g);
      this.built.set(project, g);
      this.born.set(project, now);
    }
  }

  update(now: number) {
    for (const [project, g] of this.built) {
      const t0 = this.born.get(project) ?? 0;
      const k = Math.max(0, Math.min(1, (now - t0) / 0.55));
      const overshoot = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.08 : 1;
      const s = Math.max(0.001, k * overshoot);
      g.scale.setScalar(s);
    }
  }

  private build(project: AnatomyProject): THREE.Group {
    if (project === "lining_stairs") return this.stairs();
    if (project === "strap_hammock") return this.hammock();
    return this.loft();
  }

  private stairs() {
    const g = new THREE.Group();
    const cloth = "#b98c5f";
    for (let i = 0; i < 4; i++) {
      const step = rbox(0.78 - i * 0.05, 0.12, 0.45, cloth, 0.05);
      step.position.set(1.75, 0.07 + i * 0.20, -1.22 - i * 0.12);
      step.rotation.y = -0.05 * i;
      step.castShadow = true;
      g.add(step);
    }
    const stitchMat = new THREE.MeshBasicMaterial({ color: "#7b4f34" });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), stitchMat);
      s.position.set(1.45 + i * 0.075, 0.09, -0.98);
      g.add(s);
    }
    return g;
  }

  private hammock() {
    const g = new THREE.Group();
    const sling = clothPlane(1.55, 0.70, "#a44b53");
    sling.position.set(-1.15, 0.78, -1.20);
    sling.rotation.z = -0.04;
    g.add(sling);
    const cordMat = toon("#d3b06a");
    for (const x of [-1.95, -0.35]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6), cordMat);
      cord.position.set(x, 0.98, -1.23);
      cord.rotation.z = x < -1 ? -0.48 : 0.48;
      g.add(cord);
    }
    return g;
  }

  private loft() {
    const g = new THREE.Group();
    const shelf = rbox(1.45, 0.10, 0.72, "#7f4936", 0.05);
    shelf.position.set(1.45, 1.06, -1.58);
    shelf.castShadow = true;
    g.add(shelf);
    const cushion = rbox(0.92, 0.12, 0.48, "#d6aa55", 0.10);
    cushion.position.set(1.45, 1.18, -1.54);
    cushion.castShadow = true;
    g.add(cushion);
    const button = ball(0.055, "#6f3840", false);
    button.position.set(1.45, 1.31, -1.52);
    g.add(button);
    return g;
  }
}
