import * as THREE from "three";
import { rng } from "./textures.js";

// Dusk city around the plant. The plant block sits at the origin; streets every 40 m.
function windowTextures() {
  const mk = (lit, density = 0.42) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    const r = rng(lit ? 91 : 90);
    g.fillStyle = lit ? "#000" : "#c9d0d9";
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const on = r() > density;
        if (lit) g.fillStyle = on ? `rgba(255,${190 + r() * 40},${110 + r() * 50},1)` : "#000";
        else g.fillStyle = "#8ea0b5";
        g.fillRect(x * 64 + 12, y * 64 + 14, 40, 40);
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { day: mk(false), lit: mk(true, 0.86), hero: mk(true, 0.2) };
}

function boxWithUV(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // faces: px nx py ny pz nz, 4 verts each
  for (let f = 0; f < 6; f++) {
    const fw = f < 2 ? d : w;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (f === 2 || f === 3) uv.setXY(k, 0.02, 0.02);
      else uv.setXY(k, uv.getX(k) * (fw / 4), uv.getY(k) * (h / 3.5));
    }
  }
  return g;
}

export function buildCity(scene) {
  const tex = windowTextures();
  const facade = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex.day, emissive: 0xffffff, emissiveMap: tex.lit, emissiveIntensity: 0, roughness: 0.75,
  });
  const roof = new THREE.MeshStandardMaterial({ color: 0xb6bec8, roughness: 0.9 });
  const city = new THREE.Group();
  scene.add(city);
  const r = rng(2026);
  const S = 40;
  const lanterns = [];
  const LANDMARK = {
    "-1,-2": { name: "OPUS LA", h: 74, w: 16, d: 16, hero: true },
    "1,-3": { name: "THE LOUISE", h: 34, w: 16, d: 22 },
    "-3,-1": { name: "LOS FELIZ TOWERS", h: 46, w: 14, d: 14 },
    "-2,-4": { name: "CENTURY PARK EAST", h: 58, w: 16, d: 16 },
  };
  let hero = null;
  for (let bx = -6; bx <= 5; bx++)
    for (let bz = -7; bz <= 4; bz++) {
      if (bx === 0 && bz === 0) continue;
      const cx = bx * S,
        cz = bz * S;
      const lm = LANDMARK[`${bx},${bz}`];
      const place = (w, h, d, x, z) => {
        const m = new THREE.Mesh(boxWithUV(w, h, d), [facade, facade, roof, roof, facade, facade]);
        m.position.set(x, -0.55 + h / 2, z);
        m.castShadow = false;
        m.receiveShadow = false;
        city.add(m);
        return m;
      };
      if (lm) {
        const m = place(lm.w, lm.h, lm.d, cx, cz);
        const ownMat = new THREE.MeshStandardMaterial({
          color: 0xffffff, map: tex.day, emissive: 0xffd27a, emissiveMap: tex.hero, emissiveIntensity: 0, roughness: 0.7,
        });
        m.material = [ownMat, ownMat, roof, roof, ownMat, ownMat];
        // crown
        const crown = new THREE.Mesh(new THREE.BoxGeometry(lm.w * 0.7, 3, lm.d * 0.7), roof);
        crown.position.set(cx, -0.55 + lm.h + 1.5, cz);
        city.add(crown);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffc23a, toneMapped: false, transparent: true, opacity: 0 }));
        orb.position.set(cx, -0.55 + lm.h + 5, cz);
        city.add(orb);
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 1.6, 60, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        );
        beam.position.set(cx, -0.55 + lm.h + 35, cz);
        city.add(beam);
        const l = { name: lm.name, hero: !!lm.hero, mat: ownMat, orb, beam, top: new THREE.Vector3(cx, lm.h + 9, cz), side: new THREE.Vector3(cx + lm.w / 2, lm.h * 0.72, cz + lm.d / 2), base: new THREE.Vector3(cx, 0, cz), lit: lm.hero ? 0 : 1 };
        lanterns.push(l);
        if (lm.hero) hero = l;
        continue;
      }
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const w = 8 + r() * 10,
          d = 8 + r() * 10;
        const far = Math.hypot(cx, cz);
        const h = 6 + r() * (far < 60 ? 10 : 34);
        const ox = (r() - 0.5) * (S - 12 - w),
          oz = (r() - 0.5) * (S - 12 - d);
        place(w, h, d, cx + ox, cz + oz);
      }
    }
  // streets
  const streetMat = new THREE.MeshStandardMaterial({ color: 0xd5dbe2, roughness: 1 });
  for (let k = -7; k <= 6; k++) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(9, 600), streetMat);
    a.rotation.x = -Math.PI / 2;
    a.position.set(k * S + S / 2, -0.54, -60);
    city.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(600, 9), streetMat);
    b.rotation.x = -Math.PI / 2;
    b.position.set(-20, -0.539, k * S + S / 2);
    city.add(b);
  }
  // street lamps (night only)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false, transparent: true, opacity: 0 });
  const lampGeo = new THREE.SphereGeometry(0.45, 10, 8);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 600);
  let li = 0;
  const m4 = new THREE.Matrix4();
  for (let k = -7; k <= 6 && li < 600; k++)
    for (let j = -300; j < 300 && li < 600; j += 22) {
      m4.makeTranslation(k * S + S / 2 + 5, 5, j);
      lamps.setMatrixAt(li++, m4);
      if (li < 600) {
        m4.makeTranslation(j - 20, 5, k * S + S / 2 + 5);
        lamps.setMatrixAt(li++, m4);
      }
    }
  lamps.count = li;
  city.add(lamps);

  // gold route from the loading dock to the hero tower
  const pts = [
    [10.5, -2.4], [20, -2.4], [20, -60], [-20, -60], [-20, -71], [-31, -71],
  ].map(([x, z]) => new THREE.Vector3(x, 0.4, z));
  const path = new THREE.CurvePath();
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  const routeGeo = new THREE.TubeGeometry(path, 400, 0.55, 10, false);
  const routeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uProg: { value: 0 }, uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uProg; uniform float uFade; varying vec2 vUv;
      void main(){
        float head = smoothstep(uProg - 0.06, uProg, vUv.x) * step(vUv.x, uProg);
        float body = step(vUv.x, uProg) * 0.55;
        float a = max(body, head * 1.6) * uFade;
        if (a <= 0.001) discard;
        vec3 c = mix(vec3(1.0, 0.72, 0.18), vec3(1.0, 0.95, 0.75), head);
        gl_FragColor = vec4(c * (1.4 + head * 2.5), a);
      }`,
  });
  const route = new THREE.Mesh(routeGeo, routeMat);
  route.renderOrder = 5;
  city.add(route);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff1c4, toneMapped: false, transparent: true, opacity: 0 }));
  city.add(spark);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 96), new THREE.MeshBasicMaterial({ color: 0xffc23a, toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(hero.base).setY(-0.4);
  city.add(ring);

  return {
    city, lanterns, hero, path, spark,
    setNight(k) {
      facade.emissiveIntensity = k * 0.9;
      facade.color.setRGB(1 - k * 0.8, 1 - k * 0.78, 1 - k * 0.7);
      roof.color.setRGB(0.71 - k * 0.6, 0.75 - k * 0.62, 0.78 - k * 0.6);
      streetMat.color.setRGB(0.83 - k * 0.72, 0.86 - k * 0.72, 0.89 - k * 0.7);
      lampMat.opacity = k;
      for (const l of lanterns) {
        const on = l.lit;
        l.mat.color.setRGB(1 - k * 0.78, 1 - k * 0.76, 1 - k * 0.7);
        l.mat.emissiveIntensity = k * (0.35 + on * 1.6);
        l.orb.material.opacity = k * on;
        l.beam.material.opacity = k * on * (l.hero ? 0.35 : 0.14);
      }
    },
    setRoute(p, fade = 1) {
      routeMat.uniforms.uProg.value = p;
      routeMat.uniforms.uFade.value = fade;
      if (p > 0 && p < 1) {
        spark.position.copy(path.getPointAt(Math.min(0.999, p)));
        spark.material.opacity = fade;
      } else spark.material.opacity = 0;
    },
    setRing(k) {
      ring.material.opacity = k > 0 && k < 1 ? (1 - k) * 0.9 : 0;
      ring.scale.setScalar(2 + k * 30);
    },
  };
}
