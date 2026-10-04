import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SMALL_COMFORTS_ART, type ImportedSmallComfortsItemKind } from "../logic/artAssets";

const loader = new GLTFLoader();
const prototypeCache = new Map<string, Promise<THREE.Group>>();

function loadPrototype(url: string): Promise<THREE.Group> {
  let pending = prototypeCache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then(gltf => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      return scene;
    });
    prototypeCache.set(url, pending);
  }
  return pending;
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  const cloned = material.clone();
  // World.dispose() releases every texture it owns. Clone texture objects as
  // well as materials so leaving/re-entering Small Comforts never disposes
  // the cached GLTF prototype's texture handles.
  const record = cloned as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (value instanceof THREE.Texture) record[key] = value.clone();
  }
  return cloned;
}

function cloneForRuntime(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  clone.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(cloneMaterial);
    else if (mesh.material) mesh.material = cloneMaterial(mesh.material);

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial && standard.emissiveMap) {
        material.userData.scLampEmissive = true;
        material.userData.scLampEmissiveIntensity = standard.emissiveIntensity || 1;
      }
    }
  });
  return clone;
}

export async function loadSuitcaseArt(): Promise<THREE.Group> {
  return cloneForRuntime(await loadPrototype(SMALL_COMFORTS_ART.suitcase.url));
}

export async function loadItemArt(kind: ImportedSmallComfortsItemKind): Promise<THREE.Group> {
  return cloneForRuntime(await loadPrototype(SMALL_COMFORTS_ART[kind].url));
}

export function setImportedLampEmissive(root: THREE.Object3D, on: boolean) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material?.userData.scLampEmissive) continue;
      const standard = material as THREE.MeshStandardMaterial;
      standard.emissiveIntensity = on ? (material.userData.scLampEmissiveIntensity ?? 1) : 0;
      standard.needsUpdate = true;
    }
  });
}
