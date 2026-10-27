import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

/** Where the Tin Can House on Lantern City's Hollywood island loads the real game from. */
export const SMALL_COMFORTS_PATH = "/small-comforts";

/**
 * The canonical game is a folder of standalone pages (inline scripts, three.js
 * from jsdelivr), so the app-wide policy, which forbids inline script and every
 * frame, would blank it. This one is scoped to the game's own path: inline
 * script and jsdelivr only, framed only by this origin.
 */
export const SMALL_COMFORTS_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
].join("; ");

/** preview/small-comforts sits at the repo root: ../.. from server/_core in dev, .. from dist in production. */
export function resolveSmallComfortsDir(from: string | undefined = import.meta.dirname, cwd = process.cwd()): string | null {
  const candidates = [
    path.resolve(cwd, "preview", "small-comforts"),
    ...(from
      ? [path.resolve(from, "..", "preview", "small-comforts"), path.resolve(from, "..", "..", "preview", "small-comforts")]
      : []),
  ];
  return candidates.find(dir => fs.existsSync(path.join(dir, "index.html"))) ?? null;
}

export function registerSmallComforts(app: Express, dir = resolveSmallComfortsDir()) {
  if (!dir) {
    console.error(`[small-comforts] preview/small-comforts not found; ${SMALL_COMFORTS_PATH} will fall through to the app`);
    return;
  }
  app.use(
    SMALL_COMFORTS_PATH,
    (req: Request, res: Response, next: NextFunction) => {
      // The README, story notes and reference stills are for agents, not players.
      if (/\.md$/i.test(req.path) || req.path.startsWith("/reference/")) {
        res.status(404).end();
        return;
      }
      res.setHeader("Content-Security-Policy", SMALL_COMFORTS_CSP);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      next();
    },
    express.static(dir, { index: "index.html", fallthrough: false }),
  );
}
