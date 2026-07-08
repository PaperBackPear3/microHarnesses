import type { AnalysisAssetView } from "../inputs/assets.js";
import { buildAnalysisDraftPrompt, buildUserContentParts } from "../inputs/assets.js";
import { parseAnalysisResult, mergeAnalysisResults, type AnalysisResult } from "../analysis/schema.js";
import type { AnalysisAgents } from "./agent.js";

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
  const imageViews = input.views.filter((view) => view.kind === "image");
  const documentViews = input.views.filter((view) => view.kind !== "image");
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

  const combinedDraft = drafts.length > 1 ? mergeAnalysisResults(drafts) : drafts[0];
  const synthesisPrompt = [
    "You are the synthesis step for a multimodal content analysis pipeline.",
    "Return strict JSON using the same schema as the drafts.",
    "Use the draft analyses as authoritative evidence and merge overlapping categories.",
    "Keep the summary concise but useful.",
    `Draft analyses:\n${JSON.stringify(combinedDraft, null, 2)}`,
  ].join("\n\n");

  const content = await buildUserContentParts(input.views);
  const response = await agents.synthesisAgent.invoke({
    prompt: synthesisPrompt,
    input: {
      text: input.text ?? input.instructions ?? "",
      content,
    },
    execution: {
      sessionId: input.sessionId,
      goal: "Synthesize content analysis into structured JSON",
      maxIterations: 4,
      snapshotEvery: 1,
      profile: { defaultModel: agents.config.model },
    },
  });

  try {
    const parsed = parseAnalysisResult(response.summary);
    return { ...parsed, rawAssistantMessage: response.summary };
  } catch {
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
  const response = await agent.invoke({
    prompt,
    input: {
      text: input.text ?? "",
      content: await buildUserContentParts(views),
    },
    execution: {
      sessionId: input.sessionId,
      goal: `Analyze ${title}`,
      maxIterations: 4,
      snapshotEvery: 1,
      profile: { defaultModel: agents.config.model },
    },
  });
  return parseAnalysisResult(response.summary);
}
