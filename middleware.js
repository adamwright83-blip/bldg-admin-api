/**
 * Vercel Routing Middleware. gojoystick.com/ serves the static JOYSTICK homepage in
 * client/public/joystick-home/ while the address bar stays at gojoystick.com.
 *
 * A vercel.json rewrite cannot do this: the filesystem (the SPA's index.html) answers "/" before
 * rewrites run. Middleware runs first. Only the apex root is touched; every other host and path,
 * including app./admin./driver.gojoystick.com and the SPA's own routes, passes through unchanged.
 * Railway's Express server never loads this file.
 */
export const config = { matcher: "/" };

export default function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (host === "gojoystick.com") {
    return new Response(null, {
      headers: { "x-middleware-rewrite": new URL("/joystick-home/index.html", request.url).toString() },
    });
  }
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}
