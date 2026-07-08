import type { AnalysisAssetView } from "../inputs/assets.js";
import { buildAnalysisDraftPrompt, buildUserContentParts } from "../inputs/assets.js";
import { parseAnalysisResult, mergeAnalysisResults, type AnalysisResult } from "../analysis/schema.js";
import type { AnalysisAgents } from "./agent.js";
import { log } from "./logger.js";

export interface AnalyzeSessionInput {
  sessionId: string;
  runId: string;
  views: AnalysisAssetView[];
  text?: string;
  instructions?: string;
}

export interface AnalyzeSessionOutput extends AnalysisResult {
  rawAssistantMessage: string;
}

export async function analyzeSession(
  agents: AnalysisAgents,
  input: AnalyzeSessionInput,
): Promise<AnalyzeSessionOutput> {
  log("info", "analyze", `Start session=${input.sessionId} run=${input.runId} views=${input.views.length}`);

  const imageViews = input.views.filter((view) => view.kind === "image");
  const documentViews = input.views.filter((view) => view.kind !== "image");
  log("info", "analyze", `imageViews=${imageViews.length} documentViews=${documentViews.length}`);
  const drafts: AnalysisResult[] = [];

  if (imageViews.length > 0) {
    drafts.push(
      await runAnalysisAgent(agents.visualAgent, "visual analysis", imageViews, input, agents),
    );
  }

  if (documentViews.length > 0) {
    drafts.push(
      await runAnalysisAgent(agents.documentAgent, "document analysis", documentViews, input, agents),
    );
  }

  if (drafts.length === 0) {
    drafts.push(
      await runAnalysisAgent(agents.mainAgent, "general content analysis", input.views, input, agents),
    );
  }

  // Skip synthesis entirely when there is only one draft — it adds a full LLM
  // round-trip (~3–5 min on a local model) with no benefit. For single-source
  // requests this is always the case.
  if (drafts.length === 1) {
    log("info", "synthesis", "Single draft — skipping synthesis pass");
    return { ...drafts[0], rawAssistantMessage: JSON.stringify(drafts[0], null, 2) };
  }

  const combinedDraft = mergeAnalysisResults(drafts);
  const synthesisPrompt = [
    "You are the synthesis step for a multimodal content analysis pipeline.",
    "Return strict JSON using the same schema as the drafts.",
    "Use the draft analyses as authoritative evidence and merge overlapping categories.",
    "Keep the summary concise but useful.",
    `Draft analyses:\n${JSON.stringify(combinedDraft, null, 2)}`,
  ].join("\n\n");

  const content = await buildUserContentParts(input.views);
  log("info", "synthesis", "Invoking synthesis agent");
  const response = await agents.synthesisAgent.invoke({
    prompt: synthesisPrompt,
    input: {
      // Synthesis receives the full draft JSON in the prompt; passing extra text
      // or media here would cause the model to try reading files it can't access.
      text: synthesisPrompt,
    },
    execution: {
      sessionId: input.sessionId,
      goal: "Synthesize content analysis into structured JSON",
      // Synthesis is a single-pass JSON merge — no tools, no iteration needed.
      maxIterations: 1,
      snapshotEvery: 1,
      profile: { defaultModel: agents.config.model },
    },
  });

  log("debug", "synthesis", `Raw response (${response.summary.length} chars)`, response.summary.slice(0, 800));

  try {
    const parsed = parseAnalysisResult(response.summary);
    log("info", "synthesis", "JSON parse succeeded");
    return { ...parsed, rawAssistantMessage: response.summary };
  } catch (parseErr) {
    log("warn", "synthesis", `JSON parse failed: ${String(parseErr)} — falling back to draft`);
    return {
      ...combinedDraft,
      rawAssistantMessage: response.summary,
    };
  }
}

async function runAnalysisAgent(
  agent: AnalysisAgents["mainAgent"],
  title: string,
  views: AnalysisAssetView[],
  input: AnalyzeSessionInput,
  agents: AnalysisAgents,
): Promise<AnalysisResult> {
  const prompt = await buildAnalysisDraftPrompt(title, views, input.instructions ?? "");
  log("info", "agent", `Invoking ${title} (${views.length} views)`);

  const execution = {
    sessionId: input.sessionId,
    goal: `Analyze ${title}`,
    maxIterations: 4,
    snapshotEvery: 1,
    profile: { defaultModel: agents.config.model },
  };

  const response = await agent.invoke({
    prompt,
    input: {
      text: input.text ?? "",
      content: await buildUserContentParts(views),
    },
    execution,
  });

  log("debug", "agent", `${title} raw response (${response.summary.length} chars)`, response.summary.slice(0, 800));

  try {
    const result = parseAnalysisResult(response.summary);
    log("info", "agent", `${title} JSON parse succeeded`);
    return result;
  } catch (firstErr) {
    log("warn", "agent", `${title} JSON parse failed: ${String(firstErr)} — retrying with JSON-only prompt`);

    // One retry: ask the model to reformat its own output as JSON only.
    const retryPrompt = [
      "Your previous response could not be parsed as JSON.",
      "You MUST respond with a single JSON object and nothing else — no explanation, no prose, no markdown.",
      "Use this exact schema:",
      JSON.stringify({
        summary: "string",
        categories: [{ name: "string", confidence: "low|medium|high", reason: "string" }],
        clarifications: [{ issue: "string", bestEffortInterpretation: "string", whatWouldHelp: "string" }],
        items: [{ source: "string", mimeType: "string", summary: "string", categories: ["string"] }],
      }, null, 2),
      `Previous response to reformat:\n${response.summary}`,
    ].join("\n\n");

    const retryResponse = await agent.invoke({
      prompt: retryPrompt,
      input: { text: "" },
      execution,
    });

    log("debug", "agent", `${title} retry response (${retryResponse.summary.length} chars)`, retryResponse.summary.slice(0, 800));

    try {
      const result = parseAnalysisResult(retryResponse.summary);
      log("info", "agent", `${title} retry JSON parse succeeded`);
      return result;
    } catch (retryErr) {
      log("error", "agent", `${title} retry also failed: ${String(retryErr)}`);
      // Final fallback: return a minimal result with the raw output as summary
      return {
        summary: response.summary.slice(0, 500),
        categories: [],
        clarifications: [{
          issue: "Model did not return structured JSON",
          bestEffortInterpretation: response.summary.slice(0, 300),
          whatWouldHelp: "Try a different model or add more specific content",
        }],
        items: views.map((v) => ({
          source: v.sourceLabel,
          mimeType: v.asset.mimeType,
          summary: "Could not be analyzed (model output was not valid JSON)",
          categories: [],
        })),
      };
    }
  }
}
