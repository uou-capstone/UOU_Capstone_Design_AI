import { describe, expect, it } from "vitest";
import { buildBoundedCumulativeContext, PdfIngestService } from "../services/pdf/PdfIngestService.js";
import { PdfPageIndex } from "../services/pdf/PdfTextIndex.js";

function makePdf(pages: string[]): Buffer {
  const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const fontObjectId = 3 + pages.length * 2;
  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj`
  ];

  pages.forEach((text, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const stream = `BT /F1 18 Tf 72 720 Td (${escapeText(text)}) Tj ET`;
    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj`
    );
    objects.push(`${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj`);
  });
  objects.push(`${fontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  let body = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = Buffer.byteLength(body);
    body += `${object}\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf-8");
}

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

  it("extracts studio PDF context within page and character budgets", async () => {
    const service = new PdfIngestService();
    const result = await service.extractBoundedTextFromBuffer(
      makePdf(["alpha beta gamma", "second page should not be read"]),
      {
        maxChars: 10,
        maxPages: 1,
        timeoutMs: 1000
      }
    );

    expect(result.text).toBe("alpha beta");
    expect(result.numPages).toBe(2);
    expect(result.text).not.toContain("second page");
    expect(result.truncated).toBe(true);
  });

  it("rejects invalid PDF signatures before studio extraction", async () => {
    const service = new PdfIngestService();

    await expect(service.ensurePdfMagic(Buffer.from("not-a-pdf"))).rejects.toThrow("Invalid PDF signature");
  });
});
