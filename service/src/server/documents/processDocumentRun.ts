import { readFile } from "node:fs/promises";
import { prisma } from "@/server/db/prisma";
import { config } from "@/server/config";
import { resolvePdfAbsolutePath } from "@/server/storage/pdfStore";
import { extractPdfPages } from "@/server/pdf/extractPdfPages";
import { parseConstructionPdfToMarkdown } from "@/server/llm/parseConstructionPdf";
import { generateEstimationMarkdown } from "@/server/llm/generateEstimationMarkdown";
import { publishDocumentRunEvent } from "@/server/realtime/documentUpdatesHub";
import type { ProcessingStatus } from "@/server/types";

const activeRuns = new Set<string>();

async function updateRunStatus(params: {
  runId: string;
  documentId: string;
  userId: string;
  status: ProcessingStatus;
  failureStage?: string | null;
  failureMessage?: string | null;
  parseModel?: string | null;
  estimationModel?: string | null;
  markStarted?: boolean;
  markFinished?: boolean;
}): Promise<void> {
  await prisma.documentProcessingRun.update({
    where: { id: params.runId },
    data: {
      status: params.status,
      failureStage: params.failureStage ?? null,
      failureMessage: params.failureMessage ?? null,
      parseModel: params.parseModel,
      estimationModel: params.estimationModel,
      startedAt: params.markStarted ? new Date() : undefined,
      finishedAt: params.markFinished ? new Date() : undefined,
    },
  });

  await prisma.document.update({
    where: { id: params.documentId },
    data: { updatedAt: new Date() },
  });

  publishDocumentRunEvent({
    userId: params.userId,
    documentId: params.documentId,
    processingRunId: params.runId,
    status: params.status,
    failureStage: params.failureStage,
    failureMessage: params.failureMessage,
  });
}

/** Implements: own the parsing-stage orchestration. */
export async function runParseStage(runId: string): Promise<string> {
  const run = await prisma.documentProcessingRun.findUnique({
    where: { id: runId },
    include: { document: true },
  });

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const pdfBytes = await readFile(
    resolvePdfAbsolutePath(run.document.storagePath),
  );
  const { pages } = await extractPdfPages(pdfBytes);

  if (pages.length === 0) {
    throw new Error("No pages could be extracted from the PDF");
  }

  const parsed = await parseConstructionPdfToMarkdown({
    originalFilename: run.document.originalFilename,
    pages,
    batchSize: config.parsePageBatchSize,
  });

  await prisma.documentArtifact.create({
    data: {
      processingRunId: run.id,
      kind: "parsed_markdown",
      markdown: parsed.markdown,
      metadataJson: JSON.stringify({
        pageCount: parsed.pageCount,
        warnings: parsed.warnings,
        batchSize: config.parsePageBatchSize,
      }),
    },
  });

  return parsed.markdown;
}

/** Implements: own the estimation-stage orchestration. */
export async function runEstimationStage(
  runId: string,
  parsedMarkdown: string,
): Promise<string> {
  const run = await prisma.documentProcessingRun.findUnique({
    where: { id: runId },
    include: { document: true },
  });

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const estimationMarkdown = await generateEstimationMarkdown({
    originalFilename: run.document.originalFilename,
    parsedMarkdown,
  });

  await prisma.documentArtifact.create({
    data: {
      processingRunId: run.id,
      kind: "estimation_markdown",
      markdown: estimationMarkdown,
      metadataJson: JSON.stringify({
        assumptions: "model-inferred",
      }),
    },
  });

  return estimationMarkdown;
}

/** Implements: process queued document runs asynchronously. */
export async function processDocumentRun(runId: string): Promise<void> {
  if (activeRuns.has(runId)) {
    return;
  }

  activeRuns.add(runId);

  try {
    const run = await prisma.documentProcessingRun.findUnique({
      where: { id: runId },
      include: { document: true },
    });

    if (!run || run.status !== "queued") {
      return;
    }

    const { document } = run;

    await updateRunStatus({
      runId,
      documentId: document.id,
      userId: document.userId,
      status: "parsing",
      parseModel: config.parseModel,
      markStarted: true,
    });

    let parsedMarkdown: string;
    try {
      parsedMarkdown = await runParseStage(runId);
    } catch (error) {
      await updateRunStatus({
        runId,
        documentId: document.id,
        userId: document.userId,
        status: "failed",
        failureStage: "parsing",
        failureMessage:
          error instanceof Error ? error.message : "PDF parsing failed",
        markFinished: true,
      });
      return;
    }

    await updateRunStatus({
      runId,
      documentId: document.id,
      userId: document.userId,
      status: "parsed",
    });

    await updateRunStatus({
      runId,
      documentId: document.id,
      userId: document.userId,
      status: "estimating",
      estimationModel: config.estimationModel,
    });

    try {
      await runEstimationStage(runId, parsedMarkdown);
    } catch (error) {
      await updateRunStatus({
        runId,
        documentId: document.id,
        userId: document.userId,
        status: "failed",
        failureStage: "estimating",
        failureMessage:
          error instanceof Error ? error.message : "Estimation failed",
        markFinished: true,
      });
      return;
    }

    await prisma.document.update({
      where: { id: document.id },
      data: {
        latestSuccessfulRunId: runId,
        updatedAt: new Date(),
      },
    });

    await updateRunStatus({
      runId,
      documentId: document.id,
      userId: document.userId,
      status: "completed",
      markFinished: true,
    });
  } finally {
    activeRuns.delete(runId);
  }
}
