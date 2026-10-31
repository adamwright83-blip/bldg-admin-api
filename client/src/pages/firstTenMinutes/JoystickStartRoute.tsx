import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { firstTenShownTo } from "@shared/firstTenMinutes";
import { takePreviewCodeFromUrl } from "@/lib/previewCode";
import { adoptFirstTenHandoff, sessionBelongsToTodaysFunnel } from "./draftStorage";

const JoystickAcquisitionPage = lazy(() => import("../JoystickAcquisitionPage"));
const FirstTenMinutes = lazy(() => import("./FirstTenMinutes"));

/**
 * /joystick-start. With JOYSTICK_FIRST_TEN_MINUTES off (the default), or when the server can't say, this is today's
 * funnel, unchanged. With it on, it is the first ten minutes. With it `preview`, only for a browser the server has
 * given a preview pass (from ?crew=<code>); the server checks that pass on every call, not this page.
 */
export default function JoystickStartRoute() {
  const availability = trpc.system.firstTenMinutes.availability.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const enterPreview = trpc.system.firstTenMinutes.enterPreview.useMutation();
  // a journey carried here from another origin is adopted before anything else reads the stored draft
  const previewCode = useMemo(() => {
    adoptFirstTenHandoff();
    // taken out of the URL at startup, before analytics (lib/previewCode.ts); held in memory only
    return takePreviewCodeFromUrl();
  }, []);
  const [entering, setEntering] = useState(Boolean(previewCode));
  // the server's own answer to the code: the pass is set with it, so later calls carry it; the page doesn't wait on a
  // second availability round trip racing the cookie
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!previewCode) return;
    enterPreview
      .mutateAsync({ code: previewCode })
      .then(result => {
        if (result.open) setEntered(true);
        return availability.refetch();
      })
      .catch(() => undefined)
      .finally(() => setEntering(false));
    // once, with the code this page was opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCode]);
  const todaysReturn = useMemo(() => sessionBelongsToTodaysFunnel(window.location.search), []);

  if (availability.isLoading || entering) return <div style={{ minHeight: "100vh", background: "#1e1712" }} />;
  const shown = !todaysReturn && availability.data && firstTenShownTo({ mode: availability.data.mode, open: availability.data.open || entered });
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: shown ? "#1e1712" : "#090b08" }} />}>
      {shown && availability.data ? <FirstTenMinutes availability={availability.data} /> : <JoystickAcquisitionPage />}
    </Suspense>
  );
}
