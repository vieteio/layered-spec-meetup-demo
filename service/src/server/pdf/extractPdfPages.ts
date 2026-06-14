import { PDFDocument } from "pdf-lib";
import type { ParsedPageBundle } from "@/server/types";

/** Implements: render pages and collect extracted text metadata. */
export async function extractPdfPages(pdfBytes: Buffer): Promise<{
  pageCount: number;
  pages: ParsedPageBundle[];
}> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();
  const pages: ParsedPageBundle[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.getPage(index);
    const { width, height } = page.getSize();
    pages.push({
      pageNumber: index + 1,
      pageWidth: Math.round(width),
      pageHeight: Math.round(height),
      extractedTextSpans: [],
      warnings: [
        "Embedded text extraction is limited in the first slice; page geometry is preserved for LLM parsing.",
      ],
    });
  }

  return { pageCount, pages };
}

export function chunkPages<T>(pages: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < pages.length; index += batchSize) {
    batches.push(pages.slice(index, index + batchSize));
  }
  return batches;
}
