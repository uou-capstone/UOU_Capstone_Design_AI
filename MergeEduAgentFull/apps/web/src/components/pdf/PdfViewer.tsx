import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

interface Props {
  pdfUrl: string;
  currentPage: number;
  knownNumPages?: number;
  onPageChange: (page: number) => Promise<void> | void;
}

interface ViewportCenter {
  xRatio: number;
  yRatio: number;
}

type ScrollIntent =
  | { mode: "center"; center: ViewportCenter }
  | { mode: "reset" }
  | null;

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  captured: boolean;
  active: boolean;
}

const DEFAULT_PAGE_SIZE = { width: 595, height: 842 };
const MIN_ZOOM_RATIO = 0.7;
const MAX_ZOOM_RATIO = 2;
const ZOOM_SLIDER_STEP = 0.01;
const PAN_MOVE_THRESHOLD = 3;
const FIT_SCALE_PADDING_RATIO = 0.96;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasScrollableOverflow(element: HTMLElement): boolean {
  return (
    element.scrollWidth - element.clientWidth > 1 ||
    element.scrollHeight - element.clientHeight > 1
  );
}

function clampElementScroll(element: HTMLElement) {
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollLeft = clamp(element.scrollLeft, 0, maxLeft);
  element.scrollTop = clamp(element.scrollTop, 0, maxTop);
}

function getContentInset(element: HTMLElement): { horizontal: number; vertical: number } {
  const styles = window.getComputedStyle(element);
  const left = Number.parseFloat(styles.paddingLeft) || 0;
  const right = Number.parseFloat(styles.paddingRight) || 0;
  const top = Number.parseFloat(styles.paddingTop) || 0;
  const bottom = Number.parseFloat(styles.paddingBottom) || 0;
  return {
    horizontal: left + right,
    vertical: top + bottom
  };
}

export function PdfViewer({ pdfUrl, currentPage, knownNumPages, onPageChange }: Props) {
  const file = useMemo(() => ({ url: pdfUrl, withCredentials: true }), [pdfUrl]);
  const [loadError, setLoadError] = useState("");
  const [zoomRatio, setZoomRatio] = useState(1.0);
  const [loadedNumPages, setLoadedNumPages] = useState<number | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [viewportSize, setViewportSize] = useState({ width: 760, height: 860 });
  const [viewportInset, setViewportInset] = useState({ horizontal: 20, vertical: 20 });
  const [canPan, setCanPan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<PanState | null>(null);
  const scrollIntentRef = useRef<ScrollIntent>(null);
  const renderScrollIntentRef = useRef<ScrollIntent>(null);
  const scrollRafRef = useRef<number | null>(null);
  const globalPointerCleanupRef = useRef<(() => void) | null>(null);
  const viewportSizeRef = useRef(viewportSize);
  const previousPageRef = useRef(currentPage);
  const previousPdfUrlRef = useRef(pdfUrl);

  const totalPages = loadedNumPages ?? knownNumPages ?? 1;
  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  const updateCanPan = useCallback(() => {
    const element = viewportRef.current;
    const nextCanPan = element ? hasScrollableOverflow(element) : false;
    setCanPan((previous) => (previous === nextCanPan ? previous : nextCanPan));
  }, []);

  const clearGlobalPointerListeners = useCallback(() => {
    globalPointerCleanupRef.current?.();
    globalPointerCleanupRef.current = null;
  }, []);

  const endPan = useCallback(() => {
    const pan = panRef.current;
    panRef.current = null;
    setIsPanning(false);
    clearGlobalPointerListeners();

    const element = viewportRef.current;
    if (!pan?.captured || !element) return;

    try {
      if (element.hasPointerCapture?.(pan.pointerId)) {
        element.releasePointerCapture(pan.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
  }, [clearGlobalPointerListeners]);

  const attachGlobalPointerFallback = useCallback((pointerId: number) => {
    clearGlobalPointerListeners();

    const handlePointerDone = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        endPan();
      }
    };

    window.addEventListener("pointerup", handlePointerDone, true);
    window.addEventListener("pointercancel", handlePointerDone, true);
    globalPointerCleanupRef.current = () => {
      window.removeEventListener("pointerup", handlePointerDone, true);
      window.removeEventListener("pointercancel", handlePointerDone, true);
    };
  }, [clearGlobalPointerListeners, endPan]);

  const snapshotViewportCenter = useCallback((): ViewportCenter | null => {
    const element = viewportRef.current;
    if (!element || element.scrollWidth <= 0 || element.scrollHeight <= 0) return null;

    return {
      xRatio: clamp((element.scrollLeft + element.clientWidth / 2) / element.scrollWidth, 0, 1),
      yRatio: clamp((element.scrollTop + element.clientHeight / 2) / element.scrollHeight, 0, 1)
    };
  }, []);

  const applyScrollIntent = useCallback((intent: ScrollIntent) => {
    const element = viewportRef.current;
    if (!element) return;

    if (intent?.mode === "reset") {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }

    if (intent?.mode === "center") {
      const nextLeft = (element.scrollWidth * intent.center.xRatio) - element.clientWidth / 2;
      const nextTop = (element.scrollHeight * intent.center.yRatio) - element.clientHeight / 2;
      element.scrollLeft = nextLeft;
      element.scrollTop = nextTop;
    }

    clampElementScroll(element);
    updateCanPan();
  }, [updateCanPan]);

  const scheduleScrollAdjustment = useCallback((intent?: ScrollIntent) => {
    if (intent !== undefined) {
      scrollIntentRef.current = intent;
      if (intent?.mode === "center" || intent?.mode === "reset") {
        renderScrollIntentRef.current = intent;
      }
    }
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const nextIntent = scrollIntentRef.current;
      scrollIntentRef.current = null;
      applyScrollIntent(nextIntent);
    });
  }, [applyScrollIntent]);

  const updateZoomRatio = useCallback((
    nextZoom: number | ((previous: number) => number),
    options?: { resetScroll?: boolean }
  ) => {
    endPan();
    const intent: ScrollIntent = options?.resetScroll
      ? { mode: "reset" }
      : { mode: "center", center: snapshotViewportCenter() ?? { xRatio: 0.5, yRatio: 0.5 } };
    scrollIntentRef.current = intent;
    setZoomRatio((previous) => {
      const resolved = typeof nextZoom === "function" ? nextZoom(previous) : nextZoom;
      return clamp(Number(resolved.toFixed(3)), MIN_ZOOM_RATIO, MAX_ZOOM_RATIO);
    });
    scheduleScrollAdjustment(intent);
  }, [endPan, scheduleScrollAdjustment, snapshotViewportCenter]);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateSize = () => {
      const nextSize = {
        width: Math.max(320, element.clientWidth),
        height: Math.max(240, element.clientHeight)
      };
      setViewportInset(getContentInset(element));
      const previousSize = viewportSizeRef.current;
      const sizeChanged =
        nextSize.width !== previousSize.width ||
        nextSize.height !== previousSize.height;

      if (sizeChanged) {
        const center = snapshotViewportCenter();
        if (center) {
          const intent: ScrollIntent = { mode: "center", center };
          scrollIntentRef.current = intent;
          renderScrollIntentRef.current = intent;
        }
        viewportSizeRef.current = nextSize;
      }

      if (sizeChanged) {
        setViewportSize({
          width: nextSize.width,
          height: nextSize.height
        });
      }
      updateCanPan();
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [snapshotViewportCenter, updateCanPan]);

  useEffect(() => {
    endPan();
    setLoadError("");
    setLoadedNumPages(null);
    setPdfDoc(null);
    setPageSize(DEFAULT_PAGE_SIZE);
    const intent: ScrollIntent = { mode: "reset" };
    renderScrollIntentRef.current = intent;
    scheduleScrollAdjustment(intent);
  }, [endPan, pdfUrl, scheduleScrollAdjustment]);

  useEffect(() => {
    if (!pdfDoc || !currentPage) return;
    let cancelled = false;

    pdfDoc
      .getPage(currentPage)
      .then((page: any) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setPageSize({
          width: vp.width,
          height: vp.height
        });
      })
      .catch(() => {
        // no-op
      });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage]);

  useEffect(() => {
    return () => {
      endPan();
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [endPan]);

  useEffect(() => {
    endPan();
  }, [currentPage, endPan]);

  const baseScale = useMemo(() => {
    const horizontalFit = (viewportSize.width - viewportInset.horizontal) / pageSize.width;
    const verticalFit = (viewportSize.height - viewportInset.vertical) / pageSize.height;
    const fit = Math.min(horizontalFit, verticalFit) * FIT_SCALE_PADDING_RATIO;
    return clamp(Number.isFinite(fit) ? fit : 1, 0.1, 4);
  }, [
    viewportInset.horizontal,
    viewportInset.vertical,
    viewportSize.height,
    viewportSize.width,
    pageSize.height,
    pageSize.width
  ]);

  const effectiveScale = useMemo(
    () => clamp(baseScale * zoomRatio, baseScale * MIN_ZOOM_RATIO, baseScale * MAX_ZOOM_RATIO),
    [baseScale, zoomRatio]
  );

  useLayoutEffect(() => {
    const pageOrPdfChanged =
      previousPageRef.current !== currentPage ||
      previousPdfUrlRef.current !== pdfUrl;

    if (pageOrPdfChanged) {
      const intent: ScrollIntent = { mode: "reset" };
      scrollIntentRef.current = intent;
      renderScrollIntentRef.current = intent;
      previousPageRef.current = currentPage;
      previousPdfUrlRef.current = pdfUrl;
    }

    scheduleScrollAdjustment();
  }, [
    currentPage,
    effectiveScale,
    pageSize.height,
    pageSize.width,
    pdfUrl,
    scheduleScrollAdjustment
  ]);

  const handleZoomSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateZoomRatio(Number(event.target.value));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = viewportRef.current;
    if (!element || !event.isPrimary || event.button !== 0 || !hasScrollableOverflow(element)) {
      return;
    }

    endPan();
    let captured = false;
    try {
      element.setPointerCapture(event.pointerId);
      captured = element.hasPointerCapture?.(event.pointerId) ?? true;
    } catch {
      captured = false;
    }

    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: element.scrollLeft,
      startScrollTop: element.scrollTop,
      captured,
      active: false
    };

    if (!captured) {
      attachGlobalPointerFallback(event.pointerId);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const element = viewportRef.current;
    if (!pan || !element || event.pointerId !== pan.pointerId) return;

    if ((event.buttons & 1) !== 1) {
      endPan();
      return;
    }

    const deltaX = event.clientX - pan.startX;
    const deltaY = event.clientY - pan.startY;
    if (!pan.active && Math.hypot(deltaX, deltaY) >= PAN_MOVE_THRESHOLD) {
      pan.active = true;
      setIsPanning(true);
    }

    if (!pan.active) return;
    event.preventDefault();
    element.scrollLeft = pan.startScrollLeft - deltaX;
    element.scrollTop = pan.startScrollTop - deltaY;
    updateCanPan();
  };

  const handlePointerDone = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      endPan();
    }
  };

  const handlePageRenderSuccess = () => {
    const intent = renderScrollIntentRef.current;
    renderScrollIntentRef.current = null;
    scheduleScrollAdjustment(intent ?? null);
  };

  return (
    <section className="card pdf-viewer-shell" data-testid="pdf-viewer-shell">
      <div className="pdf-toolbar">
        <div className="pdf-toolbar-title">
          <span className="pdf-toolbar-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 3h7l4 4v14H7V3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M14 3v5h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M10 13h5M10 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <strong>PDF Viewer</strong>
        </div>
        <div className="pdf-toolbar-controls">
          <button className="btn ghost" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={!canPrev}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>이전</span>
          </button>
          <span className="pdf-page-indicator">
            {currentPage} / {totalPages} 페이지
          </span>
          <button
            className="btn ghost"
            onClick={() => onPageChange(clamp(currentPage + 1, 1, totalPages))}
            disabled={!canNext}
          >
            <span>다음</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <label className="pdf-zoom-control">
            <span>확대</span>
            <input
              aria-label="PDF 확대 비율"
              data-testid="pdf-zoom-slider"
              type="range"
              min={MIN_ZOOM_RATIO}
              max={MAX_ZOOM_RATIO}
              step={ZOOM_SLIDER_STEP}
              value={zoomRatio}
              onChange={handleZoomSliderChange}
            />
          </label>
          <span className="pdf-zoom-readout" data-testid="pdf-zoom-readout">
            {Math.round(zoomRatio * 100)}%
          </span>
          <button
            className="btn ghost"
            data-testid="pdf-reset-fit"
            onClick={() => updateZoomRatio(1, { resetScroll: true })}
          >
            맞춤
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`pdf-single-view${canPan ? " can-pan" : ""}${isPanning ? " is-panning" : ""}`}
        data-testid="pdf-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerDone}
        onPointerCancel={handlePointerDone}
        onLostPointerCapture={handlePointerDone}
        onScroll={updateCanPan}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const step = clamp(Math.abs(event.deltaY) * 0.00012, 0.003, 0.015);
          const direction = event.deltaY < 0 ? 1 : -1;
          updateZoomRatio((prev) => prev + direction * step);
        }}
      >
        <div className="pdf-pan-surface" data-testid="pdf-pan-surface">
          {pdfUrl ? (
            <Document
              file={file}
              loading={<div>PDF 로딩 중...</div>}
              error={<div>{loadError || "PDF를 불러오지 못했습니다."}</div>}
              onLoadSuccess={(doc) => {
                setLoadError("");
                setLoadedNumPages(doc.numPages);
                setPdfDoc(doc);
              }}
              onLoadError={() => {
                setLoadError("PDF 접근 권한이 없거나 세션이 만료되었습니다.");
                setLoadedNumPages(null);
                setPdfDoc(null);
                setPageSize(DEFAULT_PAGE_SIZE);
              }}
            >
              <Page
                pageNumber={currentPage}
                scale={effectiveScale}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                onRenderSuccess={handlePageRenderSuccess}
              />
            </Document>
          ) : (
            <div>PDF URL 없음</div>
          )}
        </div>
      </div>
    </section>
  );
}
