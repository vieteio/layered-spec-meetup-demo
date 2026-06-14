import { processDocumentRun } from "@/server/documents/processDocumentRun";

const queued = new Set<string>();

/** Implements: hand the run id to the worker runtime. */
export function enqueueDocumentRun(runId: string): void {
  if (process.env.VITEST === "true") {
    return;
  }

  if (queued.has(runId)) {
    return;
  }

  queued.add(runId);
  setImmediate(async () => {
    try {
      await processDocumentRun(runId);
    } finally {
      queued.delete(runId);
    }
  });
}
