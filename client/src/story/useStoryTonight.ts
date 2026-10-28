import { useQuery, useQueryClient } from "@tanstack/react-query";
import { storyClient } from "./storyClient";

export const STORY_TONIGHT_QUERY_KEY = ["story", "tonight"] as const;

/** `system.story.tonight` through the story client. Off-by-default tenants get `{ enabled: false }`. */
export function useStoryTonight(enabled: boolean) {
  return useQuery({
    queryKey: STORY_TONIGHT_QUERY_KEY,
    queryFn: () => storyClient().tonight(),
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useRefreshStoryTonight() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: STORY_TONIGHT_QUERY_KEY });
}
