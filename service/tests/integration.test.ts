import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createDocumentForUpload, deleteTerminalDocument } from "@/server/documents/documentService";
import { processDocumentRun } from "@/server/documents/processDocumentRun";
import { chunkPages } from "@/server/pdf/extractPdfPages";
import { MAX_PDF_SIZE_BYTES } from "@/server/config";

async function createSamplePdf(pageCount = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Construction drawing page ${index + 1}`, {
      x: 50,
      y: 700,
      size: 18,
      font,
    });
  }

  return Buffer.from(await pdf.save());
}

beforeEach(async () => {
  await prisma.documentArtifact.deleteMany();
  await prisma.documentProcessingRun.deleteMany();
  await prisma.document.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();
});

describe("pdf batching", () => {
  it("chunks pages into batches of ten", () => {
    const pages = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(chunkPages(pages, 10)).toEqual([
      pages.slice(0, 10),
      pages.slice(10, 20),
      pages.slice(20, 23),
    ]);
  });
});

describe("document upload", () => {
  it("creates a queued document run for a valid PDF", async () => {
    const user = await prisma.user.create({
      data: {
        googleSub: "google-1",
        email: "builder@example.com",
        name: "Builder",
      },
    });

    const document = await createDocumentForUpload({
      userId: user.id,
      originalFilename: "drawing.pdf",
      mimeType: "application/pdf",
      bytes: await createSamplePdf(3),
    });

    expect(document.status).toBe("queued");

    const run = await prisma.documentProcessingRun.findFirst({
      where: { documentId: document.id },
    });
    expect(run?.status).toBe("queued");
  });

  it("enforces the 32 MB upload limit constant", () => {
    expect(MAX_PDF_SIZE_BYTES).toBe(32 * 1024 * 1024);
  });

  it("processes a PDF through parse and estimation stages", async () => {
    const user = await prisma.user.create({
      data: {
        googleSub: "google-process",
        email: "process@example.com",
      },
    });

    const created = await createDocumentForUpload({
      userId: user.id,
      originalFilename: "twelve-pages.pdf",
      mimeType: "application/pdf",
      bytes: await createSamplePdf(12),
    });

    const run = await prisma.documentProcessingRun.findFirstOrThrow({
      where: { documentId: created.id },
    });

    await processDocumentRun(run.id);

    const updatedRun = await prisma.documentProcessingRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { artifacts: true },
    });

    expect(updatedRun.status).toBe("completed");
    expect(updatedRun.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      "estimation_markdown",
      "parsed_markdown",
    ]);
  });
});

describe("document deletion", () => {
  it("deletes terminal-state documents only", async () => {
    const user = await prisma.user.create({
      data: {
        googleSub: "google-2",
        email: "owner@example.com",
      },
    });

    const created = await createDocumentForUpload({
      userId: user.id,
      originalFilename: "terminal.pdf",
      mimeType: "application/pdf",
      bytes: await createSamplePdf(1),
    });

    await prisma.documentProcessingRun.update({
      where: { id: (await prisma.document.findUniqueOrThrow({
        where: { id: created.id },
      })).latestRunId! },
      data: { status: "estimating" },
    });

    expect(
      await deleteTerminalDocument({
        userId: user.id,
        documentId: created.id,
      }),
    ).toBe("active");

    const runId = (await prisma.document.findUniqueOrThrow({
      where: { id: created.id },
    })).latestRunId!;

    await prisma.documentProcessingRun.update({
      where: { id: runId },
      data: { status: "completed", finishedAt: new Date() },
    });

    expect(
      await deleteTerminalDocument({
        userId: user.id,
        documentId: created.id,
      }),
    ).toBe("deleted");
  });
});
