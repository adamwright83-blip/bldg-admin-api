/**
 * Video texture lifecycle for a looping in-world detail clip (e.g. a
 * waterfall). Built and unit-tested against the documented behavior, but
 * unattached to any real footage — `waterfall_01.webm` does not exist yet
 * (see client/public/assets/goldline/corridor_01/README.md). Call
 * `loadLoopingVideoTexture` once that asset is added; nothing in the render
 * loop depends on it today.
 */
export type ManagedVideoTexture = {
  element: HTMLVideoElement;
  pause(): void;
  resume(): void;
  destroy(): void;
};

export function loadLoopingVideoTexture(url: string): ManagedVideoTexture {
  const video = document.createElement("video");
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "none"; // lazy: only fetched once resume() is called

  let destroyed = false;

  const handleVisibility = () => {
    if (document.hidden) video.pause();
    else if (!destroyed) void video.play().catch(() => {});
  };
  const handlePageHide = () => video.pause();

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", handlePageHide);

  return {
    element: video,
    pause() {
      video.pause();
    },
    resume() {
      if (destroyed) return;
      video.preload = "auto";
      void video.play().catch(() => {
        // Autoplay can still be blocked pre-gesture; caller may retry resume()
        // from a user-gesture handler.
      });
    },
    destroy() {
      destroyed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}
