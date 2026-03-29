export interface PageTextEntry {
  page: number;
  text: string;
}

export interface PdfPageIndex {
  lectureId: string;
  numPages: number;
  pages: PageTextEntry[];
  createdAt: string;
}
