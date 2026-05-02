# PDF Contained Zoom Design

## Summary

PDF zoom must affect only the PDF content inside the lecture viewer. Moving the zoom slider should not make the overall learning session UI, the PDF card, or the AI tutor chat column feel enlarged or pushed larger.

This document is a pre-implementation design. The current code is expected to fail several listed invariants until the implementation phase applies this design. Static design validation should judge whether the proposed changes are complete, consistent with the current architecture, and testable; implementation validation will later judge whether the code and e2e tests actually contain those changes.

## Problem

The PDF viewer already uses a slider and drag-to-pan behavior, but the enlarged PDF canvas can still participate in outer layout sizing. The late session CSS overrides `.session-layout` to `height: auto`, so a larger PDF page can make the two-column grid row taller. Because the chat shell is the adjacent grid item, it can visually stretch together with the PDF area. This creates the impression that the entire UI or the right-side agent chat is being enlarged.

## Goals

- Zoom slider changes only the rendered PDF page scale.
- The PDF viewport remains a fixed, bounded scroll container on desktop.
- The right-side AI tutor chat panel keeps a stable width and height while PDF zoom changes.
- Enlarged PDF areas are reached by scrolling/drag panning inside `.pdf-single-view`, not by growing the session layout.
- Existing PDF slider, reset, wheel zoom, page navigation, and drag pan behavior continue to work.
- Mobile layout keeps the current stacked behavior, but the PDF card still has a bounded internal viewport.

## Non-goals

- Do not change browser-level zoom.
- Do not resize chat fonts, bubbles, or agent content based on PDF zoom.
- Do not replace the `react-pdf` rendering path.
- Do not alter quiz/session agent behavior except where existing tests need to keep guarding race conditions.

## Current System Snapshot

- `PdfViewer.tsx` renders one `Page` with `scale = baseScale * zoomRatio`.
- `.pdf-single-view` is intended to be the scroll container and pan target.
- `.pdf-pan-surface` uses max-content sizing so the zoomed page can create internal scrollable overflow.
- `.session-page` uses grid rows, but the later `.session-layout` rule sets `height: auto`.
- `.pdf-viewer-shell` and `.session-chat-shell` hide overflow, but their grid row can grow when the PDF content gets taller.

## Proposed Design

### Contain The Desktop Session Grid

The final desktop `.session-layout` rule should restore a bounded height instead of `height: auto`. This rule must win the cascade. Implement it in the late session CSS block that currently resets `.session-layout` to `height: auto`, or add a final `@media (min-width: 981px)` containment block after all session/mobile overrides.

- Use a viewport-derived height that accounts for the topbar, session header, and vertical page padding.
- Keep `min-height: 0` so child scroll containers can shrink.
- Add `max-height` to prevent zoomed PDF content from expanding the whole row.
- Use `align-items: stretch` so both columns fill the same bounded row.
- Keep the existing two-column ratio and the minimum chat width.
- Remove hard desktop minimums that can exceed the available viewport height. If a minimum is needed, clamp it below the viewport-derived height, for example with `min-height: min(620px, var(--session-workspace-height))`.

The desktop rule should be equivalent to:

```css
@media (min-width: 981px) {
  .session-layout {
    --session-workspace-height: calc(100dvh - var(--topbar-height) - var(--session-header-height) - 50px);
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
    height: var(--session-workspace-height);
    min-height: min(620px, var(--session-workspace-height));
    max-height: var(--session-workspace-height);
    align-items: stretch;
    overflow: hidden;
  }
}
```

### Bound The Column Shells

Both direct children of `.session-layout` must be layout-stable containers.

- Set `height: 100%`, `max-height: 100%`, and `min-width: 0`.
- Keep `overflow: hidden`.
- Keep `display: flex` and `flex-direction: column` for the PDF and chat shells.
- Put these rules in the same final cascade-winning block as the desktop session layout, so a later generic `.pdf-viewer-shell` or `.session-chat-shell` rule cannot weaken them.
- Add stable test IDs so the containment invariant is observable:
  - `data-testid="session-layout"` on the session grid;
  - `data-testid="pdf-viewer-shell"` on the PDF shell;
  - `data-testid="session-chat-shell"` on the chat shell;
  - `data-testid="session-chat-panel"` on the scrollable chat message panel;
  - `data-testid="session-chat-bubble"` on rendered chat bubbles.

### Make PDF Overflow Internal

`.pdf-single-view` remains the only place where zoomed PDF overflow is allowed.

- Keep `flex: 1 1 auto`, `min-height: 0`, `overflow: auto`, and `scrollbar-gutter`.
- Add layout/paint containment so the larger PDF canvas does not invalidate outer layout sizing.
- Do not use `contain: size`; it can interfere with flex and viewport measurement.
- Keep `.pdf-pan-surface` max-content sizing so the enlarged PDF can still be panned and scrolled internally.
- Acceptance criterion: zooming from 100% to 200% must not change the PDF viewport bounding box or `clientWidth/clientHeight` by more than 1-2px. Only `scrollWidth/scrollHeight` should increase.

### Preserve Mobile Behavior

Under `max-width: 980px`, the session layout can remain stacked and height auto, but the PDF card itself must still be bounded so zoomed canvas size stays inside the PDF viewport.

- Set mobile PDF shell to an explicit viewport-relative `height`, not only `min-height`.
- Keep `max-height` below the viewport height so chat remains reachable.
- Keep `.pdf-single-view` as the internal scroll container.

Example:

```css
@media (max-width: 980px) {
  .session-layout {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .session-page .pdf-viewer-shell {
    height: min(72dvh, 760px);
    min-height: 55dvh;
    max-height: 82dvh;
  }
}
```

### Avoid Resize Feedback Loops

`PdfViewer` uses `ResizeObserver` to recompute `baseScale` from `.pdf-single-view.clientWidth/clientHeight`. Therefore CSS must keep the viewport client box stable across zoom.

- The PDF canvas may change `scrollWidth/scrollHeight`.
- The viewport `clientWidth/clientHeight` must stay stable.
- If containment fails and the viewport changes size during zoom, the e2e test should fail because that can produce `zoom -> layout resize -> baseScale recalc -> render resize` feedback.

## Module Changes

- `apps/web/src/styles/global.css`
  - Replace the late desktop `height: auto` session layout override with a bounded desktop height.
  - Add direct-child containment constraints for PDF and chat shells.
  - Add containment to `.pdf-single-view`.
  - Keep mobile overrides explicit so stacked layouts are not accidentally constrained to desktop height.
- `apps/web/src/components/pdf/PdfViewer.tsx`
  - Add `data-testid="pdf-viewer-shell"` to the outer PDF shell.
- `apps/web/src/routes/Session.tsx`
  - Add stable `data-testid` attributes to the session grid and chat shell only:
    - `data-testid="session-layout"`;
    - `data-testid="session-chat-shell"`.
- `apps/web/src/components/chat/ChatPanel.tsx`
  - Add `data-testid="session-chat-panel"` to the scrollable `.chat-panel` root.
- `apps/web/src/components/chat/ChatBubble.tsx`
  - Add `data-testid="session-chat-bubble"` to each rendered `.chat-bubble` root.
- `e2e/pdf-viewer-pan-zoom.spec.ts`
  - Extend the existing zoom/pan test to snapshot session layout and chat dimensions before and after slider zoom.
  - Assert that the chat panel dimensions stay effectively stable while zooming to 200%.
  - Assert that the PDF viewport dimensions stay stable while only internal scroll extent grows.
  - Assert chat bubble computed font size and first bubble dimensions do not change across PDF zoom.
  - Include a small desktop viewport check, for example `1180x560`, so hard desktop minimums or late `height: auto` regressions fail.
  - Include at least one compact/mobile viewport check with an explicit size, for example `390x844`, that zoom still produces internal PDF overflow without growing the PDF shell.
  - Include a native scroll fallback check: at 200% zoom, a normal wheel event without ctrl/meta should move internal `scrollTop` or `scrollLeft` and must not zoom the PDF.

## Data And Control Flow

1. User moves the zoom slider.
2. `PdfViewer` updates `zoomRatio`.
3. `react-pdf` renders a larger canvas inside `.pdf-pan-surface`.
4. `.pdf-single-view` gains internal scrollable overflow.
5. `.session-layout`, `.pdf-viewer-shell`, and `.session-chat-shell` keep their outer dimensions.
6. User can drag inside the PDF viewport to inspect hidden areas.

## Failure Handling

- If the viewport is too small, internal PDF scrolling is preferred over outer layout growth.
- If mobile stacks the layout, desktop fixed-height constraints must not make the page unusable.
- If CSS padding changes, existing computed padding logic in `PdfViewer` keeps fit-scale aligned with the real viewport content box.
- If pointer capture, drag pan, or `canPan` state is temporarily wrong, the PDF viewport must still expose native scrollbars/wheel/touch scrolling as a fallback because overflow lives in `.pdf-single-view`.
- If `pointercancel` or `lostpointercapture` occurs, existing pan cleanup continues to prevent stuck panning; containment changes must not remove those handlers.
- If a future CSS edit reintroduces desktop `height: auto`, the zoom-stability e2e should fail by detecting changed session/chat/PDF shell dimensions.
- If a future CSS edit reintroduces a desktop hard minimum that exceeds the available viewport height, the small-desktop e2e should fail by detecting outer layout growth.
- If drag panning is broken, users should still be able to inspect the zoomed PDF through native internal wheel/scroll behavior; e2e should verify this fallback directly.

## Test Strategy

- Run `npm run build -w apps/web`.
- Run `npx playwright test e2e/pdf-viewer-pan-zoom.spec.ts --project=chromium`.
- During design validation, missing test IDs or missing e2e assertions in the current code are not themselves design failures if this document explicitly assigns their implementation owner and acceptance criteria. During implementation validation, those missing items are failures.
- The Playwright test must verify:
  - slider/readout still work;
  - zoom to 200% creates internal PDF overflow;
  - left/right drag pan still changes `scrollLeft`;
  - reset returns to 100% and no artificial overflow;
  - `.session-layout`, `.pdf-viewer-shell`, `.session-chat-shell`, and `[data-testid="pdf-viewport"]` bounding boxes remain stable within 1-2px between 100% and 200% zoom;
  - `[data-testid="session-chat-panel"]` and first `[data-testid="session-chat-bubble"]` bounding boxes remain stable within 1-2px between 100% and 200% zoom;
  - PDF viewport `clientWidth/clientHeight` stay stable while `scrollWidth/scrollHeight` increase at 200%;
  - first chat bubble bounding box and computed font size stay stable across PDF zoom;
  - PDF viewport bounding box remains stable across zoom;
  - chat shell bounding box remains stable across zoom;
  - small desktop viewport `1180x560` keeps session/PDF/chat boxes bounded while zoom creates internal PDF overflow;
  - compact/mobile viewport `390x844` keeps the PDF shell bounded while zoom creates internal PDF overflow;
  - normal wheel scrolling without ctrl/meta at 200% moves internal PDF viewport scroll and leaves zoom readout unchanged;
  - late page-change stream race guard still passes.

## Scenario Changes

Before:

- Moving the PDF zoom slider could make the PDF card and the adjacent AI tutor panel appear to grow because the session grid height was content-driven.

After:

- Moving the PDF zoom slider enlarges only the PDF canvas inside the PDF viewport.
- The outer session UI remains stable.
- Hidden PDF areas are inspected with internal scroll/drag pan.

## Open Risks

- The CSS file has multiple late overrides; the final containment rules must be placed where they win the cascade.
- Very small mobile viewports should remain usable, so mobile-specific height behavior must stay separate from desktop behavior.
