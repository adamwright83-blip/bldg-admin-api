import { LoaderUtils, TextureLoader, type LoadingManager } from "three";
import { GLTFLoader as BaseGLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

/**
 * The preview build's GLTFLoader (vite.special-delivery-preview.config.ts aliases it in for `vite build` only; the
 * app itself never uses this file).
 *
 * What a claude.ai artifact needs:
 *  - its CSP blocks fetch() of blob: URLs, which is how three decodes a GLB's embedded textures (ImageBitmapLoader),
 *    so every texture would silently fail; an <img> may load blob:, so textures go through TextureLoader instead;
 *  - it serves no .glb files, and one file may be at most 15 MB, so package-artifact.mjs ships each model as
 *    base64 text in JSON parts with a small manifest, and this loader puts the bytes back together before parsing.
 */
export type { GLTF };

type PartsManifest = { size: number; encoding: "base64"; parts: string[] };

function decodeInto(target: Uint8Array, at: number, base64: string) {
  const bin = atob(base64);
  for (let i = 0; i < bin.length; i++) target[at + i] = bin.charCodeAt(i);
  return bin.length;
}

export class GLTFLoader extends BaseGLTFLoader {
  constructor(manager?: LoadingManager) {
    super(manager);
    this.register(parser => {
      parser.textureLoader = new TextureLoader(parser.options.manager);
      return { name: "artifact_texture_loader" };
    });
  }

  load(url: string, onLoad: (gltf: GLTF) => void, onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void): void {
    if (!/\.glb$/.test(url)) return super.load(url, onLoad, onProgress, onError);
    const base = LoaderUtils.extractUrlBase(url);
    const fail = (err: unknown) => (onError ? onError(err) : console.error(err));
    fetch(`${url}.parts.json`)
      .then(r => {
        if (!r.ok) throw new Error(`${url}.parts.json: ${r.status}`);
        return r.json() as Promise<PartsManifest>;
      })
      .then(async manifest => {
        const whole = new Uint8Array(manifest.size);
        let at = 0;
        for (const part of manifest.parts) {
          const r = await fetch(base + part);
          if (!r.ok) throw new Error(`${part}: ${r.status}`);
          at += decodeInto(whole, at, (await r.json()) as string);
          onProgress?.(new ProgressEvent("progress", { lengthComputable: true, loaded: at, total: manifest.size }));
        }
        if (at !== manifest.size) throw new Error(`${url} parts are ${at} bytes, expected ${manifest.size}`);
        this.parse(whole.buffer, base, onLoad, fail);
      })
      .catch(fail);
  }
}
