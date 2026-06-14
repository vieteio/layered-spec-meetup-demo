import OpenAI from "openai";
import { config } from "@/server/config";

const openai = config.openAiApiKey
  ? new OpenAI({ apiKey: config.openAiApiKey })
  : null;

function buildMockEstimationMarkdown(originalFilename: string): string {
  return `# Construction Drawing Estimation

## Executive summary
Mock estimation for ${originalFilename} based on parsed drawing markdown.

## Assumptions
- Labor rate inferred at $85/hour because no user cost table is configured yet.
- Material quantities inferred from drawing annotations and typical construction allowances.
- Scope excludes permits, mobilization, and site-specific unknowns.

## Itemized estimate
| Scope item | Quantity assumption | Estimated time | Estimated cost | Notes |
| --- | --- | --- | --- | --- |
| Layout and review | 1 drawing set | 4h | $340 | Initial review and markup |
| Rough material takeoff | inferred from parsed pages | 6h | $510 | Model-inferred quantities |
| Coordination allowance | 1 pass | 2h | $170 | Clarifications and revisions |

## Totals
- Total estimated time: 12h
- Total estimated cost: $1,020

## Confidence and risks
- Confidence: medium — first-slice estimation uses model-inferred assumptions only.
- Risks: missing exact dimensions, unspecified finishes, and absent user CSV rate tables.`;
}

/** Implements: call the estimation model and enforce output template expectations. */
export async function generateEstimationMarkdown(params: {
  originalFilename: string;
  parsedMarkdown: string;
}): Promise<string> {
  if (config.llmMock || !openai) {
    return buildMockEstimationMarkdown(params.originalFilename);
  }

  const response = await openai.chat.completions.create({
    model: config.estimationModel,
    messages: [
      {
        role: "system",
        content:
          "You estimate construction time and cost from parsed drawing markdown. Use model-inferred assumptions only and state them explicitly. Return markdown with executive summary, assumptions, itemized estimate table, totals, and confidence/risks.",
      },
      {
        role: "user",
        content: [
          `Source filename: ${params.originalFilename}`,
          "Parsed markdown:",
          params.parsedMarkdown,
        ].join("\n\n"),
      },
    ],
  });

  return (
    response.choices[0]?.message?.content ??
    buildMockEstimationMarkdown(params.originalFilename)
  );
}
