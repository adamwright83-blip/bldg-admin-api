import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { STORY_REQUEST_HEADER, type StoryOutcome, type StoryQuestion, type StoryResolvedLine, type StoryTonight } from "@shared/story";
import { apiBase } from "@/lib/apiBase";
import type { AppRouter } from "../../../server/routers";

/**
 * The only way story code talks to the server. Every request it makes carries STORY_REQUEST_HEADER, and the server
 * refuses such a request anywhere but `system.story.*` (server/story/storyIsolation.ts). The client exposes the four
 * story procedures and nothing else, so story gameplay has no handle on the business at all.
 *
 * Business reads on the account page (snapshot, territories) use the main client in `@/lib/trpc`, never this one.
 */

export type StoryStartResult = { chapterNumber: number; gameKey: string; config: Record<string, unknown> };
export type StoryFinishResult = { advanced: boolean; after: StoryResolvedLine[] | null; question: StoryQuestion | null };

export type StoryClient = {
  tonight(): Promise<StoryTonight>;
  start(chapterNumber: number): Promise<StoryStartResult>;
  finish(input: { chapterNumber: number; outcome: StoryOutcome; durationMs?: number | null }): Promise<StoryFinishResult>;
  answer(input: { questionKey: string; optionKey: string }): Promise<{ answered: string }>;
};

export function createStoryClient(options: { url?: string; fetch?: typeof globalThis.fetch } = {}): StoryClient {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: options.url ?? `${apiBase()}/api/trpc`,
        transformer: superjson,
        headers: () => ({ [STORY_REQUEST_HEADER]: "1" }),
        fetch: (input, init) => send(input, { ...(init ?? {}), credentials: "include" }),
      }),
    ],
  });
  const story = client.system.story;
  return {
    tonight: () => story.tonight.query(),
    start: chapterNumber => story.start.mutate({ chapterNumber }),
    finish: input => story.finish.mutate(input),
    answer: input => story.answer.mutate(input),
  };
}

let shared: StoryClient | null = null;

/** The page's story client, created on first use. */
export function storyClient(): StoryClient {
  return (shared ??= createStoryClient());
}
