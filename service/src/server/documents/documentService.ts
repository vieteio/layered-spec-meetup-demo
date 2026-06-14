import type { Document, DocumentProcessingRun } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { persistUploadedPdf } from "@/server/storage/pdfStore";
import { enqueueDocumentRun } from "@/server/jobs/documentQueue";
import type {
  DocumentDetailResponse,
  DocumentListItem,
  DocumentSummary,
  ProcessingStatus,
} from "@/server/types";

function mapRunStatus(run: DocumentProcessingRun | null): ProcessingStatus {
  return (run?.status ?? "queued") as ProcessingStatus;
}

export function toDocumentSummary(
  document: Document,
  run: DocumentProcessingRun | null,
): DocumentSummary {
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    status: mapRunStatus(run),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toDocumentListItem(
  document: Document,
  run: DocumentProcessingRun | null,
): DocumentListItem {
  return {
    ...toDocumentSummary(document, run),
    hasCompletedResult: Boolean(document.latestSuccessfulRunId),
  };
}

/** Implements: create document and initial run records for upload. */
export async function createDocumentForUpload(params: {
  userId: string;
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<DocumentSummary> {
  const documentId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  const persisted = await persistUploadedPdf({
    userId: params.userId,
    documentId,
    runId,
    bytes: params.bytes,
  });

  const document = await prisma.$transaction(async (tx) => {
    const createdDocument = await tx.document.create({
      data: {
        id: documentId,
        userId: params.userId,
        originalFilename: params.originalFilename,
        storagePath: persisted.storagePath,
        mimeType: params.mimeType,
        fileSizeBytes: persisted.fileSizeBytes,
        sha256: persisted.sha256,
        latestRunId: runId,
      },
    });

    await tx.documentProcessingRun.create({
      data: {
        id: runId,
        documentId,
        status: "queued",
      },
    });

    return createdDocument;
  });

  enqueueDocumentRun(runId);

  const run = await prisma.documentProcessingRun.findUnique({
    where: { id: runId },
  });

  return toDocumentSummary(document, run);
}

export async function listDocumentsForUser(
  userId: string,
): Promise<DocumentListItem[]> {
  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  const items: DocumentListItem[] = [];
  for (const document of documents) {
    const run = document.latestRunId
      ? await prisma.documentProcessingRun.findUnique({
          where: { id: document.latestRunId },
        })
      : null;
    items.push(toDocumentListItem(document, run));
  }

  return items;
}

export async function getDocumentDetailForUser(params: {
  userId: string;
  documentId: string;
}): Promise<DocumentDetailResponse | null> {
  const document = await prisma.document.findFirst({
    where: { id: params.documentId, userId: params.userId },
  });

  if (!document || !document.latestRunId) {
    return null;
  }

  const run = await prisma.documentProcessingRun.findUnique({
    where: { id: document.latestRunId },
    include: { artifacts: true },
  });

  if (!run) {
    return null;
  }

  const parsed = run.artifacts.find((artifact) => artifact.kind === "parsed_markdown");
  const estimation = run.artifacts.find(
    (artifact) => artifact.kind === "estimation_markdown",
  );

  return {
    id: document.id,
    originalFilename: document.originalFilename,
    status: mapRunStatus(run),
    failureStage: (run.failureStage as DocumentDetailResponse["failureStage"]) ?? null,
    failureMessage: run.failureMessage,
    latestRunId: run.id,
    parsedMarkdown: parsed?.markdown ?? null,
    estimationMarkdown: estimation?.markdown ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

const TERMINAL_STATUSES = new Set<ProcessingStatus>(["completed", "failed"]);

/** Implements: create a new run for an existing stored PDF. */
export async function reprocessDocument(params: {
  userId: string;
  documentId: string;
}): Promise<DocumentSummary | null> {
  const document = await prisma.document.findFirst({
    where: { id: params.documentId, userId: params.userId },
  });

  if (!document) {
    return null;
  }

  const runId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.documentProcessingRun.create({
      data: {
        id: runId,
        documentId: document.id,
        status: "queued",
      },
    });

    await tx.document.update({
      where: { id: document.id },
      data: { latestRunId: runId },
    });
  });

  enqueueDocumentRun(runId);

  const run = await prisma.documentProcessingRun.findUnique({
    where: { id: runId },
  });

  return toDocumentSummary(document, run);
}

/** Implements: delete an owned terminal-state document and its stored artifacts. */
export async function deleteTerminalDocument(params: {
  userId: string;
  documentId: string;
}): Promise<"deleted" | "not_found" | "active"> {
  const document = await prisma.document.findFirst({
    where: { id: params.documentId, userId: params.userId },
    include: {
      processingRuns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!document) {
    return "not_found";
  }

  const latestRun = document.processingRuns[0];
  if (!latestRun || !TERMINAL_STATUSES.has(latestRun.status as ProcessingStatus)) {
    return "active";
  }

  await prisma.document.delete({ where: { id: document.id } });

  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const { config } = await import("@/server/config");
  const documentDir = path.join(
    config.pdfStorageRoot,
    params.userId,
    document.id,
  );

  try {
    await rm(documentDir, { recursive: true, force: true });
  } catch {
    // Disk cleanup failure should not roll back DB deletion in the first slice.
  }

  return "deleted";
}
