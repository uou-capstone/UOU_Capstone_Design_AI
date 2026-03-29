import fs from "node:fs/promises";
import path from "node:path";
import pdf from "pdf-parse";
import { appConfig } from "../../config.js";
import { PdfPageIndex } from "./PdfTextIndex.js";

export class PdfIngestService {
  private readonly indexCache = new Map<string, PdfPageIndex>();

  private async loadPageIndex(indexPath: string): Promise<PdfPageIndex> {
    const cached = this.indexCache.get(indexPath);
    if (cached) return cached;

    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw) as PdfPageIndex;
    this.indexCache.set(indexPath, parsed);
    return parsed;
  }

  async ensurePdfMagic(buffer: Buffer): Promise<void> {
    const signature = buffer.subarray(0, 4).toString("utf-8");
    if (signature !== "%PDF") {
      throw new Error("Invalid PDF signature");
    }
  }

  async savePdf(lectureId: string, buffer: Buffer): Promise<string> {
    const fullPath = path.join(appConfig.uploadDir, `${lectureId}.pdf`);
    await fs.writeFile(fullPath, buffer);
    return fullPath;
  }

  async buildPageIndex(lectureId: string, buffer: Buffer): Promise<{ numPages: number; indexPath: string }> {
    const pages: string[] = [];
    const data = await pdf(buffer, {
      pagerender: async (pageData: { getTextContent: (arg: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{ items: Array<{ str: string }> }> }) => {
        const textContent = await pageData.getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false
        });
        const text = textContent.items.map((i) => i.str).join(" ").trim();
        pages.push(text);
        return text;
      }
    });

    const numPages = data.numpages || pages.length || 1;
    const normalizedPages = Array.from({ length: numPages }, (_, index) => ({
      page: index + 1,
      text: pages[index] ?? ""
    }));

    const pageIndex: PdfPageIndex = {
      lectureId,
      numPages,
      pages: normalizedPages,
      createdAt: new Date().toISOString()
    };

    const indexPath = path.join(appConfig.uploadDir, `${lectureId}.pageIndex.json`);
    await fs.writeFile(indexPath, `${JSON.stringify(pageIndex, null, 2)}\n`, "utf-8");
    this.indexCache.set(indexPath, pageIndex);

    return { numPages, indexPath };
  }

  async readPageContext(indexPath: string, page: number): Promise<{ pageText: string; prev: string; next: string }> {
    const index = await this.loadPageIndex(indexPath);
    const readText = (pageNumber: number): string => {
      if (pageNumber < 1 || pageNumber > index.pages.length) {
        return "";
      }
      return index.pages[pageNumber - 1]?.text ?? "";
    };

    const pageText = readText(page);
    const prev = readText(page - 1);
    const next = readText(page + 1);

    return {
      pageText: pageText.slice(0, appConfig.contextMaxChars),
      prev: prev.slice(0, Math.floor(appConfig.contextMaxChars / 2)),
      next: next.slice(0, Math.floor(appConfig.contextMaxChars / 2))
    };
  }

  async readCumulativeContext(indexPath: string, uptoPage: number): Promise<string> {
    const index = await this.loadPageIndex(indexPath);
    const chunks = index.pages
      .filter((page) => page.page >= 1 && page.page <= uptoPage)
      .map((page) => `[p.${page.page}] ${page.text}`);
    const merged = chunks.join("\n\n");
    return merged.slice(0, appConfig.contextMaxChars * 3);
  }
}
