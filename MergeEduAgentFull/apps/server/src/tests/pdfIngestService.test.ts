import { describe, expect, it } from "vitest";
import { buildBoundedCumulativeContext } from "../services/pdf/PdfIngestService.js";
import { PdfPageIndex } from "../services/pdf/PdfTextIndex.js";

describe("PdfIngestService", () => {
  it("builds cumulative context only until the character budget is reached", () => {
    let accessedPages = 0;
    const index: PdfPageIndex = {
      lectureId: "lec_pdf",
      numPages: 3,
      createdAt: new Date().toISOString(),
      pages: [
        {
          page: 1,
          get text() {
            accessedPages += 1;
            return "a".repeat(200);
          }
        },
        {
          page: 2,
          get text() {
            accessedPages += 1;
            return "b".repeat(200);
          }
        },
        {
          page: 3,
          get text() {
            accessedPages += 1;
            return "c".repeat(200);
          }
        }
      ]
    };

    const result = buildBoundedCumulativeContext(index, 3, 40);

    expect(result).toBe("[p.1] " + "a".repeat(34));
    expect(result).toHaveLength(40);
    expect(accessedPages).toBe(1);
  });

  it("includes later pages until budget and stops before unused pages", () => {
    let accessedPages = 0;
    const index: PdfPageIndex = {
      lectureId: "lec_pdf",
      numPages: 3,
      createdAt: new Date().toISOString(),
      pages: [
        {
          page: 1,
          get text() {
            accessedPages += 1;
            return "first";
          }
        },
        {
          page: 2,
          get text() {
            accessedPages += 1;
            return "second page is long";
          }
        },
        {
          page: 3,
          get text() {
            accessedPages += 1;
            return "third";
          }
        }
      ]
    };

    const result = buildBoundedCumulativeContext(index, 3, 24);

    expect(result).toBe("[p.1] first\n\n[p.2] secon");
    expect(result).toHaveLength(24);
    expect(accessedPages).toBe(2);
  });
});
