# Implementation Design

## Summary

Replace the learning-session PDF zoom buttons with a slider-based zoom control and add drag-to-pan behavior inside the PDF viewport so users can inspect off-screen parts of an enlarged page without changing the current zoom.

## Problem

The current PDF viewer exposes zoom as small `-`, percentage, `+`, and `fit` controls. When a page is zoomed in, the viewport relies on scrollbars and default overflow behavior. This makes it awkward to inspect the right side of an enlarged page: users expect click-dragging left to move the document left and reveal the right side.

## Goals / Non-goals

Goals:
- Replace the visible `-` and `+` zoom buttons with a single range slider plus a compact percent readout.
- Preserve the existing page navigation controls and the reset-to-fit action.
- Add mouse/pointer drag panning inside the PDF viewport when zoomed enough to overflow.
- Keep the current wheel zoom shortcut behavior for users who already use `ctrl/cmd + wheel`.
- Avoid panning while the user is interacting with toolbar controls.
- Keep the behavior local to the session PDF viewer and avoid server/data model changes.

Non-goals:
- No multi-page continuous PDF scrolling.
- No touch pinch-zoom implementation in this change.
- No persistence of zoom/pan across browser refreshes.
- No changes to quiz, chat, or session event APIs.

## Current System Snapshot

`apps/web/src/components/pdf/PdfViewer.tsx` owns PDF rendering, page navigation, zoom state, and viewport sizing. It uses `react-pdf` `Document` and `Page`, computes a fit-to-viewport `baseScale`, then applies `zoomRatio` to produce `effectiveScale`.

The viewport is `.pdf-single-view`, a scrollable div with `overflow: auto`, grid centering, and the PDF page canvas inside `react-pdf` wrappers. Zoom buttons currently update `zoomRatio` in small steps from `0.7` to `2`.

`apps/web/src/styles/global.css` defines all viewer layout and responsive rules.

## Proposed Design

Introduce constants in `PdfViewer.tsx` for zoom range and slider step:
- `MIN_ZOOM_RATIO = 0.7`
- `MAX_ZOOM_RATIO = 2`
- `ZOOM_SLIDER_STEP = 0.01`

Replace the plus/minus controls with:
- a labeled `input type="range"` bound to `zoomRatio`
- a percent readout
- a `맞춤` reset button that sets `zoomRatio` to `1`

Add drag-to-pan with pointer events on `.pdf-single-view`:
- Keep pan refs/state inside `PdfViewer`; do not add zoom or pan state to `SessionRoute`, server APIs, or persisted session data.
- On pointer down, only start a pan for primary-button pointer events inside the viewport when the rendered PDF overflows the viewport. The `canPan` check is `scrollWidth > clientWidth || scrollHeight > clientHeight`.
- Store `pointerId`, pointer start coordinates, viewport `scrollLeft`/`scrollTop`, whether pointer capture succeeded, and whether the movement threshold has been crossed.
- Capture the pointer so the drag remains stable if the cursor leaves the viewport. Guard `setPointerCapture`/`releasePointerCapture` with `try/catch`.
- If pointer capture fails, attach temporary global `pointerup`/`pointercancel` listeners and always clear them during pan cleanup.
- On pointer move, set:
  - `scrollLeft = startScrollLeft - (currentClientX - startClientX)`
  - `scrollTop = startScrollTop - (currentClientY - startClientY)`
- This means dragging the mouse left produces a negative delta and increases `scrollLeft`, revealing content on the right.
- Ignore pointer move events from a different pointer id or when the primary button is no longer pressed.
- End the pan on pointer up, pointer cancel, lost pointer capture, or component unmount.
- Use a small movement threshold before marking the viewport as actively dragging, so incidental clicks do not feel sticky.
- Cancel any active pan when `pdfUrl` or `currentPage` changes.

Scroll positioning rules:
- Page changes and PDF URL changes preserve the zoom ratio but reset viewport scroll to top-left after the new page render. This prevents stale scroll offsets from one page carrying into another.
- Zoom changes preserve the viewport center proportionally when possible. Before changing zoom from slider or wheel, capture the current visible center as ratios of the scrollable width/height; after `effectiveScale` rerenders, restore the center using `requestAnimationFrame`.
- `맞춤` resets zoom to `1` and also recenters/normalizes scroll after render.
- Resize-driven `baseScale` changes reuse the same center-preservation/clamping path.
- After `effectiveScale`, `pageSize`, `currentPage`, or `pdfUrl` changes, clamp `scrollLeft`/`scrollTop` with `requestAnimationFrame` so they remain within valid browser scroll bounds.

Layout determinism:
- Put the rendered `Document/Page` inside an inner wrapper. The viewport remains the scroll container; the wrapper centers content only when the rendered page is narrower/shorter than the viewport and otherwise provides deterministic scroll bounds.

Update CSS:
- Toolbar controls should stay compact and responsive.
- Add a `.pdf-zoom-control` group with fixed, stable slider dimensions.
- Add cursor affordances on `.pdf-single-view.can-pan`: `grab` by default, `grabbing` while active.
- Disable text/canvas selection during drag.
- Add stable mobile sizing: toolbar controls wrap predictably, the slider uses `clamp()`/`minmax()` widths, and page navigation remains usable at narrow widths.
- Keep overflow auto so keyboard/trackpad/scrollbar users still have fallback navigation.
- Add stable browser-test selectors/labels for the PDF viewport, zoom slider, zoom readout, and reset button.

## Module Changes

`apps/web/src/components/pdf/PdfViewer.tsx`:
- Add zoom constants and pointer pan refs/state.
- Add slider change handler.
- Replace zoom buttons with slider markup.
- Add pointer event handlers to the viewport.
- Preserve `ctrl/meta + wheel` zoom.
- Reset stale `pdfDoc`, `loadedNumPages`, `loadError`, and page-size assumptions when `pdfUrl` changes or a new document fails to load.
- Add stable selector contracts:
  - viewport: `data-testid="pdf-viewport"`
  - inner page wrapper: `data-testid="pdf-pan-surface"`
  - zoom slider: `data-testid="pdf-zoom-slider"` and accessible label `PDF 확대 비율`
  - zoom readout: `data-testid="pdf-zoom-readout"`
  - reset button: `data-testid="pdf-reset-fit"`

`apps/web/src/styles/global.css`:
- Style the slider group.
- Adjust PDF viewport cursor and selection behavior.
- Keep mobile wrapping safe for the toolbar.

## Data and Control Flow

Zoom flow:
1. User moves range slider.
2. `zoomRatio` updates within `[0.7, 2]`.
3. `effectiveScale = baseScale * zoomRatio`, clamped as today.
4. `react-pdf` rerenders the current page at the new scale.

Pan flow:
1. User presses the primary pointer button inside `.pdf-single-view`.
2. Component stores pointer and scroll origin.
3. User drags left/right/up/down.
4. Component updates viewport scroll offsets directly.
5. Browser overflow boundaries naturally clamp scroll positions.

Zoom-center flow:
1. Before changing zoom, component snapshots the visible center of the scroll container.
2. Zoom ratio updates and `react-pdf` rerenders at the new effective scale.
3. On the next animation frame, component restores the same center ratio and clamps scroll offsets.

## Failure Handling

- If the PDF is not loaded, the viewport still renders the existing loading/error content and pointer handlers are harmless.
- If the PDF is not overflowing, the viewport does not enter pan mode and does not show a grab cursor.
- If pointer capture is unavailable or fails, global pointer cleanup listeners prevent stuck panning.
- If capture/release throws, cleanup still clears refs and React state.
- If the page is not overflowing, scroll offsets remain clamped at zero.
- If a user zooms out or resets to fit, overflow disappears and drag has no effect.
- If the user changes pages while dragging, active pan is cancelled and scroll resets after the new page render.

## Test Strategy

Automated:
- Run `npm run build -w apps/web` to verify TypeScript and Vite build.
- Add/run a focused Playwright test for `/session/:lectureId` with mocked auth/session API responses and a deterministic generated PDF response. This avoids relying on mutable local seed data.
- Assertions should cover:
  - stable selectors exist for `pdf-viewport`, `pdf-pan-surface`, `pdf-zoom-slider`, `pdf-zoom-readout`, and `pdf-reset-fit`
  - slider changes the percent/readout
  - zoom creates horizontal overflow
  - dragging left increases `scrollLeft` and dragging right decreases it
  - `맞춤` resets zoom to 100%
  - previous/next page controls remain usable
  - `ctrl/cmd + wheel` still changes zoom

Manual/browser:
- Open a learning session.
- Move zoom slider above 100%.
- Drag left inside the PDF page and confirm the right side becomes visible.
- Drag right and confirm the left side returns.
- Confirm page previous/next still work.
- Confirm `맞춤` resets zoom to 100%.
- Confirm `ctrl/cmd + wheel` zoom still changes the percent.
- Check desktop and narrow viewport toolbar wrapping.
- Check scrollbar fallback remains visible/usable when overflow exists.
- Check cursor/grabbing state and pointer-up/cancel cleanup after dragging outside the viewport.

## Scenario Changes

Before:
- User zooms in with `+`, then must use scrollbars or trackpad scrolling to inspect hidden content.

After:
- User zooms in with a slider, then click-drags the PDF viewport. Dragging left moves the enlarged PDF left, revealing the right side while keeping the zoom level.

## Open Risks

- React PDF rerendering at high zoom can be expensive on large pages, but this change does not expand the existing max zoom.
- Dragging on selectable text is not a concern because the current viewer disables the text layer.
- Touch panning is not explicitly tuned yet; pointer events will provide a baseline, but pinch gestures remain outside scope.
