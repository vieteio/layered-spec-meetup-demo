import OpenAI from "openai";
import { config } from "@/server/config";
import type { ParsedPageBundle } from "@/server/types";
import { chunkPages } from "@/server/pdf/extractPdfPages";

const openai = config.openAiApiKey
  ? new OpenAI({ apiKey: config.openAiApiKey })
  : null;

function buildBatchPrompt(
  originalFilename: string,
  batch: ParsedPageBundle[],
): string {
  const pageSummaries = batch
    .map(
      (page) =>
        `Page ${page.pageNumber} (${page.pageWidth}x${page.pageHeight}):\n` +
        `Warnings: ${page.warnings.join("; ") || "none"}\n` +
        `Text spans: ${
          page.extractedTextSpans.length > 0
            ? page.extractedTextSpans.map((span) => span.text).join(" | ")
            : "none detected"
        }`,
    )
    .join("\n\n");

  return [
    "You are parsing a construction drawing PDF into page-aware markdown.",
    `Source filename: ${originalFilename}`,
    "For each page, produce markdown sections with page summary, text blocks, image descriptions, and layout/relationship notes.",
    "Preserve page numbers and include position notes using [x, y, w, h] placeholders when exact coordinates are unknown.",
    "",
    pageSummaries,
  ].join("\n");
}

function buildMockParsedMarkdown(
  originalFilename: string,
  pages: ParsedPageBundle[],
): string {
  const pageSections = pages
    .map(
      (page) => `## Page ${page.pageNumber}
### Page summary
Construction drawing page ${page.pageNumber} from ${originalFilename}.

### Text blocks
- \`[x=0, y=0, w=${page.pageWidth}, h=${page.pageHeight}]\` Placeholder text extraction for page ${page.pageNumber}.

### Image descriptions
- \`[x=0, y=0, w=${page.pageWidth}, h=${page.pageHeight}]\` Drawing symbols, dimensions, and annotations are expected on this page.

### Layout and relationships
- Page geometry preserved for downstream estimation.`,
    )
    .join("\n\n");

  return `# Parsed Construction Drawing

## Document notes
- Source filename: ${originalFilename}
- Parse warnings: limited embedded text extraction in first slice

${pageSections}`;
}

/** Implements: call the parse model and compose parsed markdown. */
export async function parseConstructionPdfToMarkdown(params: {
  originalFilename: string;
  pages: ParsedPageBundle[];
  batchSize: number;
}): Promise<{ markdown: string; pageCount: number; warnings: string[] }> {
  const batches = chunkPages(params.pages, params.batchSize);
  const warnings = params.pages.flatMap((page) => page.warnings);
  const batchMarkdown: string[] = [];

  for (const batch of batches) {
    if (config.llmMock || !openai) {
      batchMarkdown.push(buildMockParsedMarkdown(params.originalFilename, batch));
      continue;
    }

    const response = await openai.chat.completions.create({
      model: config.parseModel,
      messages: [
        {
          role: "system",
          content:
            "Return only markdown for the requested construction drawing pages.",
        },
        {
          role: "user",
          content: buildBatchPrompt(params.originalFilename, batch),
        },
      ],
    });

    batchMarkdown.push(response.choices[0]?.message?.content ?? "");
  }

  const combined = config.llmMock || !openai
    ? buildMockParsedMarkdown(params.originalFilename, params.pages)
    : `# Parsed Construction Drawing

## Document notes
- Source filename: ${params.originalFilename}
- Parse warnings: ${warnings.length > 0 ? warnings.join("; ") : "none"}

${batchMarkdown.join("\n\n")}`;

  return {
    markdown: combined,
    pageCount: params.pages.length,
    warnings,
  };
}
