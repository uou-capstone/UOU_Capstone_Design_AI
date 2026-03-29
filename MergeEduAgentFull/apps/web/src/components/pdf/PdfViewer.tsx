import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Props {
  pdfUrl: string;
  currentPage: number;
  knownNumPages?: number;
  onPageChange: (page: number) => Promise<void> | void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function PdfViewer({ pdfUrl, currentPage, knownNumPages, onPageChange }: Props) {
  const file = useMemo(() => ({ url: pdfUrl }), [pdfUrl]);
  const [zoomRatio, setZoomRatio] = useState(1.0);
  const [loadedNumPages, setLoadedNumPages] = useState<number | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageSize, setPageSize] = useState({ width: 595, height: 842 });
  const [viewportSize, setViewportSize] = useState({ width: 760, height: 860 });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const totalPages = loadedNumPages ?? knownNumPages ?? 1;
  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateSize = () => {
      setViewportSize({
        width: Math.max(320, element.clientWidth),
        height: Math.max(360, element.clientHeight)
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

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

  const baseScale = useMemo(() => {
    const horizontalFit = (viewportSize.width - 24) / pageSize.width;
    const verticalFit = (viewportSize.height - 24) / pageSize.height;
    const fit = Math.min(horizontalFit, verticalFit);
    return clamp(Number.isFinite(fit) ? fit : 1, 0.1, 4);
  }, [viewportSize.height, viewportSize.width, pageSize.height, pageSize.width]);

  const effectiveScale = useMemo(
    () => clamp(baseScale * zoomRatio, baseScale * 0.7, baseScale * 2),
    [baseScale, zoomRatio]
  );

  return (
    <section className="card pdf-viewer-shell">
      <div className="pdf-toolbar">
        <strong>PDF Viewer</strong>
        <div className="pdf-toolbar-controls">
          <button className="btn ghost" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={!canPrev}>
            이전
          </button>
          <span>
            {currentPage} / {totalPages} 페이지
          </span>
          <button
            className="btn ghost"
            onClick={() => onPageChange(clamp(currentPage + 1, 1, totalPages))}
            disabled={!canNext}
          >
            다음
          </button>
          <button className="btn ghost" onClick={() => setZoomRatio((prev) => clamp(prev - 0.03, 0.7, 2))}>
            -
          </button>
          <span>{Math.round(zoomRatio * 100)}%</span>
          <button className="btn ghost" onClick={() => setZoomRatio((prev) => clamp(prev + 0.03, 0.7, 2))}>
            +
          </button>
          <button className="btn ghost" onClick={() => setZoomRatio(1)}>
            맞춤
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="pdf-single-view"
        onWheel={(event) => {
          event.preventDefault();
          const step = clamp(Math.abs(event.deltaY) * 0.00012, 0.003, 0.015);
          const direction = event.deltaY < 0 ? 1 : -1;
          setZoomRatio((prev) => clamp(Number((prev + direction * step).toFixed(3)), 0.7, 2));
        }}
      >
        {pdfUrl ? (
          <Document
            file={file}
            loading={<div>PDF 로딩 중...</div>}
            onLoadSuccess={(doc) => {
              setLoadedNumPages(doc.numPages);
              setPdfDoc(doc);
            }}
          >
            <Page
              pageNumber={currentPage}
              scale={effectiveScale}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        ) : (
          <div>PDF URL 없음</div>
        )}
      </div>
    </section>
  );
}
