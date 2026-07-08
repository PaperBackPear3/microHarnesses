import assert from "node:assert/strict";
import test from "node:test";
import { mergeAnalysisResults, parseAnalysisResult } from "./schema.js";

test("parseAnalysisResult accepts fenced JSON output", () => {
  const result = parseAnalysisResult(`\`\`\`json
{
  "summary": "A screenshot of a receipt",
  "categories": [{"name":"receipt","confidence":"high","reason":"Totals and line items are visible"}],
  "clarifications": [],
  "items": [{"source":"x","mimeType":"image/png","summary":"Receipt image","categories":["receipt"]}]
}
\`\`\``);

  assert.equal(result.summary, "A screenshot of a receipt");
  assert.equal(result.categories[0]?.name, "receipt");
  assert.equal(result.items[0]?.mimeType, "image/png");
});

test("mergeAnalysisResults deduplicates categories and clarifications", () => {
  const merged = mergeAnalysisResults([
    {
      summary: "first",
      categories: [{ name: "invoice", confidence: "medium", reason: "Looks like billing" }],
      clarifications: [{ issue: "blurry", bestEffortInterpretation: "text is faint", whatWouldHelp: "higher resolution" }],
      items: [],
    },
    {
      summary: "second",
      categories: [{ name: "invoice", confidence: "high", reason: "Contains totals" }],
      clarifications: [{ issue: "BLURRY", bestEffortInterpretation: "text is faint", whatWouldHelp: "higher resolution" }],
      items: [],
    },
  ]);

  assert.equal(merged.summary, "first");
  assert.equal(merged.categories[0]?.confidence, "high");
  assert.equal(merged.clarifications.length, 1);
});
