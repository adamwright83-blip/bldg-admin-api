# DAYLINE approved composition restoration

The default Driver Day Line now uses the approved 941 × 1672 artwork as its visual coordinate system. The original scene, walking explorer, glowing route, category graphics, portraits, wordmark and dock remain source artwork. Native buttons render the current task names, addresses, time windows, known bag/weight facts and explicit completion states; each opens its own existing stop dialog.

The artwork's sample task plaques and time/date text are masked for every day, including empty days. The business date stays live. Repeated tasks retain every source ID and receive independent cards; longer days continue below the illustrated scene. Opening or scrolling the page does not record completion. The classic layout remains available through `?dayline=classic`.

No global viewport, page scale or Driver shell width was changed. The shrinking-picture issue is outside this change. The illustrated stage keeps the approved artwork's intrinsic proportions so its own overlays align with the art.

## Review

Open `comparison.html` for the original approval beside the browser capture. `approved-render.png` comes from the compile-time-only `art-approved` fixture using the production compositor, chrome and stop dialog. `live-data-render.png` uses a different day projection; `empty-render.png` verifies that no sample business work appears on an empty day. None of these sample records is included in a production build.

## Verification

- Application type check passes.
- 58 focused unit checks pass.
- 23 browser checks pass at 390 × 844 and 430 × 932, including exact approved anchors, independent dialogs, long repeated tasks, empty days, decode/retry and verified-only progress.
- Frontend build passes. The existing large-bundle warning remains.

This branch has not been merged or deployed.
