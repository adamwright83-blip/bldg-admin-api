import * as THREE from "three";
import { FIXTURES, type FixtureId } from "../logic/foraging";
import { cyl } from "./style";
import { buildShelfProp } from "./shelf";

/** the fixtures the proprietor has built inside the suitcase: the hauled object, re-set to work as furniture */
export class FixtureWorks {
  group = new THREE.Group();
  private built = new Map<FixtureId, THREE.Group>();
  private born = new Map<FixtureId, number>();
  private flame: THREE.Mesh | null = null;
  private glint: THREE.Mesh | null = null;
  private light: THREE.PointLight | null = null;

  sync(fixtures: readonly FixtureId[], now: number, animate = true) {
    for (const f of fixtures) {
      if (this.built.has(f)) continue;
      const g = this.build(f);
      g.name = `Fixture_${f}`;
      const at = FIXTURES[f].home;
      g.position.set(at.x, 0, at.z);
      if (animate) g.scale.setScalar(0.001);
      this.group.add(g);
      this.built.set(f, g);
      this.born.set(f, animate ? now : now - 10);
    }
    for (const [f, g] of this.built) if (!fixtures.includes(f)) { g.parent?.remove(g); this.built.delete(f); this.born.delete(f); }
  }

  has(f: FixtureId) { return this.built.has(f); }

  private build(f: FixtureId): THREE.Group {
    const g = new THREE.Group();
    if (f === "signal_mirror") {
      const prop = buildShelfProp("brass_button");
      // stand the button on its edge, tipped back against the lining, face to the window
      prop.group.rotation.set(Math.PI / 2 - 0.25, 0, 0);
      prop.group.scale.setScalar(0.85);
      prop.group.position.set(0, 0.66, 0);
      g.add(prop.group);
      const foot = cyl(0.18, 0.22, 0.14, "#8a6a2b", 12); foot.position.set(0, 0.07, 0.05); g.add(foot);
      const glint = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), new THREE.MeshBasicMaterial({ color: "#fff7c2", transparent: true, opacity: 0.0, depthWrite: false }));
      glint.position.set(0, 0.68, 0.3); g.add(glint); this.glint = glint;
    } else if (f === "spool_stool") {
      const prop = buildShelfProp("thread_spool");
      prop.spin.position.y = 0;
      prop.group.rotation.set(0, 0, 0);
      // upright: undo the on-its-side rotation of the inner body
      prop.spin.children[0].rotation.set(0, 0, 0);
      prop.group.scale.setScalar(0.62);
      prop.group.position.y = 0.62 * 0.62 + 0.06;
      g.add(prop.group);
    } else {
      const prop = buildShelfProp("thimble");
      prop.group.rotation.set(Math.PI, 0, 0);
      prop.group.scale.setScalar(0.95);
      prop.group.position.y = 0.62 * 0.95 + 0.18;
      g.add(prop.group);
      for (const [x, z] of [[-0.28, 0], [0.28, 0], [0, 0.28]] as const) {
        const leg = cyl(0.04, 0.04, 0.18, "#8a8f94", 6, false); leg.position.set(x, 0.09, z); g.add(leg);
      }
      const candle = cyl(0.07, 0.07, 0.14, "#f4ead0", 10, false); candle.position.y = 0.07; g.add(candle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8), new THREE.MeshBasicMaterial({ color: "#ffb347" })); flame.position.y = 0.24; g.add(flame); this.flame = flame;
      const light = new THREE.PointLight("#ffb066", 2.4, 3.2, 1.6); light.position.y = 0.4; g.add(light); this.light = light;
    }
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    return g;
  }

  update(t: number) {
    for (const [f, g] of this.built) {
      const k = Math.min(1, (t - (this.born.get(f) ?? 0)) / 0.5);
      const e = k >= 1 ? 1 : 1 + 2.7 * Math.pow(k - 1, 3) + 1.9 * Math.pow(k - 1, 2);
      g.scale.setScalar(Math.max(0.001, e));
    }
    if (this.flame) { this.flame.scale.set(1, 0.85 + Math.sin(t * 17) * 0.15, 1); }
    if (this.light) this.light.intensity = 2.2 + Math.sin(t * 9) * 0.3;
    if (this.glint) (this.glint.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.sin(t * 2.2)) ** 6 * 0.9;
  }
}
