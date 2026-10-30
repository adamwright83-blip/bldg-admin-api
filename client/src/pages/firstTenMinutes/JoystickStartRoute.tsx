import { lazy, Suspense, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { firstTenShownTo } from "@shared/firstTenMinutes";
import { adoptFirstTenHandoff, readPreviewOptIn, sessionBelongsToTodaysFunnel } from "./draftStorage";

const JoystickAcquisitionPage = lazy(() => import("../JoystickAcquisitionPage"));
const FirstTenMinutes = lazy(() => import("./FirstTenMinutes"));

/**
 * /joystick-start. With JOYSTICK_FIRST_TEN_MINUTES off (the default), or when the server can't say, this is today's
 * funnel, unchanged. With it on (or `preview` and this tab opted in), it is the first ten minutes.
 */
export default function JoystickStartRoute() {
  const availability = trpc.system.firstTenMinutes.availability.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  // a journey carried here from another origin is adopted before anything else reads the stored draft
  const optedIn = useMemo(() => {
    adoptFirstTenHandoff();
    return readPreviewOptIn();
  }, []);
  const todaysReturn = useMemo(() => sessionBelongsToTodaysFunnel(window.location.search), []);

  if (availability.isLoading) return <div style={{ minHeight: "100vh", background: "#1e1712" }} />;
  const shown = !todaysReturn && availability.data && firstTenShownTo(availability.data.mode, optedIn);
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: shown ? "#1e1712" : "#090b08" }} />}>
      {shown && availability.data ? <FirstTenMinutes availability={availability.data} /> : <JoystickAcquisitionPage />}
    </Suspense>
  );
}
