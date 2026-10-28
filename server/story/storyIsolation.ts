import type { NextFunction, Request, Response } from "express";
import { isStoryProcedurePath, STORY_REQUEST_HEADER } from "../../shared/story";

/**
 * Story gameplay must never reach the business. Every request made from story gameplay carries STORY_REQUEST_HEADER,
 * and the server refuses that request everywhere except `system.story.*`. Two layers, both on the server:
 *
 * 1. `storyRequestGate` (Express, mounted before every route): a story request to any path other than a tRPC call whose
 *    every procedure is in `system.story.*` gets 403 before any handler, webhook, REST endpoint or integration runs.
 * 2. `assertStoryRequestAllowed` (tRPC base procedure): the same rule per procedure, so a story request can never execute
 *    a business procedure even if it arrived some way the gate did not see.
 *
 * The header is checked for presence, not value: an empty or odd value is still a story request.
 */

export function isStoryRequest(headers: Record<string, unknown> | undefined | null): boolean {
  if (!headers) return false;
  return Object.prototype.hasOwnProperty.call(headers, STORY_REQUEST_HEADER) && headers[STORY_REQUEST_HEADER] !== undefined;
}

/** The procedure paths a tRPC HTTP request names, decoded. Null when the path is not a tRPC call at all. */
export function trpcProcedurePaths(requestPath: string): string[] | null {
  const prefix = "/api/trpc/";
  if (!requestPath.startsWith(prefix)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(requestPath.slice(prefix.length));
  } catch {
    return null;
  }
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest.split(",").map(p => p.trim());
}

export function storyRequestAllowedForPath(requestPath: string): boolean {
  const paths = trpcProcedurePaths(requestPath);
  return paths !== null && paths.length > 0 && paths.every(isStoryProcedurePath);
}

export function storyRequestGate() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isStoryRequest(req.headers as Record<string, unknown>)) return next();
    // originalUrl keeps the path as sent, before any router rewrote it; the query string is not part of the decision.
    const requestPath = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
    if (storyRequestAllowedForPath(requestPath)) return next();
    res.status(403).json({ error: "story_isolation", message: "Story requests may only reach system.story." });
  };
}

export class StoryIsolationViolation extends Error {
  constructor(public readonly procedurePath: string) {
    super("Story requests may only reach system.story.");
  }
}

/** Throws when a story request names a procedure outside `system.story.*`. In-process callers (no request) pass. */
export function assertStoryRequestAllowed(req: { headers?: Record<string, unknown> } | undefined | null, procedurePath: string): void {
  if (!req || !isStoryRequest(req.headers)) return;
  if (!isStoryProcedurePath(procedurePath)) throw new StoryIsolationViolation(procedurePath);
}
