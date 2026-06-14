export type ProcessingStatus =
  | "queued"
  | "parsing"
  | "parsed"
  | "estimating"
  | "completed"
  | "failed";

export type FailureStage = "upload" | "parsing" | "estimating";

export type DocumentRunEventType =
  | "document.run.updated"
  | "document.run.completed"
  | "document.run.failed";

export type DocumentRunEvent = {
  type: DocumentRunEventType;
  documentId: string;
  processingRunId: string;
  status: ProcessingStatus;
  occurredAt: string;
  failureStage: FailureStage | null;
  failureMessage: string | null;
};

export type DocumentSummary = {
  id: string;
  originalFilename: string;
  status: ProcessingStatus;
  createdAt: string;
  updatedAt: string;
};

export type DocumentListItem = DocumentSummary & {
  hasCompletedResult: boolean;
};

export type DocumentDetailResponse = {
  id: string;
  originalFilename: string;
  status: ProcessingStatus;
  failureStage: FailureStage | null;
  failureMessage: string | null;
  latestRunId: string;
  parsedMarkdown: string | null;
  estimationMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ParsedPageBundle = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  extractedTextSpans: Array<{
    text: string;
    boundingBox: string;
    readingOrder: number;
  }>;
  warnings: string[];
};
