import { useEffect } from "react";
import { wwwGojoystickRedirectTarget } from "@shared/joystickHostRouting";

/** Client fallback for the live Vercel 308 from www.gojoystick.com to the apex. */
export function WwwGojoystickRedirect() {
  useEffect(() => {
    const target = wwwGojoystickRedirectTarget(
      window.location.pathname,
      window.location.search,
      window.location.hash
    );
    if (window.location.href !== target) window.location.replace(target);
  }, []);
  return (
    <main data-joystick-host="www-redirect">
      <p>Redirecting to gojoystick.com</p>
    </main>
  );
}

/**
 * The API hostname is not a frontend. If this SPA is ever served there, it
 * must not render admin, driver, customer, resident, or marketing surfaces.
 */
export function JoystickApiHostRefused() {
  return (
    <main data-joystick-host="api.gojoystick.com">
      <h1>JOYSTICK API</h1>
      <p>This hostname serves the main API. It does not serve an app.</p>
    </main>
  );
}
