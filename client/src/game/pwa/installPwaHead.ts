/**
 * This host serves several unrelated products (admin dashboard, Dayforge,
 * Goldline) from one SPA shell, so the manifest/PWA meta tags are injected
 * only while the Goldline driver route is mounted, not globally in
 * index.html — otherwise every other page on this origin would also
 * advertise itself as installable under the Goldline manifest.
 */
const TAG_DATA_ATTR = "data-goldline-pwa";

export function installPwaHeadTags(): () => void {
  if (typeof document === "undefined") return () => {};

  const manifestLink = document.createElement("link");
  manifestLink.rel = "manifest";
  manifestLink.href = "/goldline.webmanifest";
  manifestLink.setAttribute(TAG_DATA_ATTR, "1");

  const themeColor = document.createElement("meta");
  themeColor.name = "theme-color";
  themeColor.content = "#071119";
  themeColor.setAttribute(TAG_DATA_ATTR, "1");

  const appleCapable = document.createElement("meta");
  appleCapable.name = "apple-mobile-web-app-capable";
  appleCapable.content = "yes";
  appleCapable.setAttribute(TAG_DATA_ATTR, "1");

  const appleStatusBar = document.createElement("meta");
  appleStatusBar.name = "apple-mobile-web-app-status-bar-style";
  appleStatusBar.content = "black-translucent";
  appleStatusBar.setAttribute(TAG_DATA_ATTR, "1");

  const appleTitle = document.createElement("meta");
  appleTitle.name = "apple-mobile-web-app-title";
  appleTitle.content = "Goldline";
  appleTitle.setAttribute(TAG_DATA_ATTR, "1");

  const appleTouchIcon = document.createElement("link");
  appleTouchIcon.rel = "apple-touch-icon";
  appleTouchIcon.href = "/assets/goldline/pwa/icon-192.png";
  appleTouchIcon.setAttribute(TAG_DATA_ATTR, "1");

  const tags = [manifestLink, themeColor, appleCapable, appleStatusBar, appleTitle, appleTouchIcon];
  tags.forEach(tag => document.head.appendChild(tag));

  return () => {
    tags.forEach(tag => tag.remove());
  };
}
