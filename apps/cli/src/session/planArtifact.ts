import type { HarnessMode, SessionStore } from "@micro-harnesses/core";

export interface PlanArtifactResult {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export function toPlanMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("#")) {
    return `# Plan\n\n${trimmed}\n`;
  }
  return `${trimmed}\n`;
}

export async function savePlanArtifactIfNeeded(args: {
  mode: HarnessMode;
  sessionStore: SessionStore;
  sessionId: string | undefined;
  assistantMessage: string;
}): Promise<PlanArtifactResult | undefined> {
  if (args.mode !== "plan" || !args.sessionId) return undefined;
  const summary = args.assistantMessage.trim();
  if (!summary) return undefined;
  const saved = await args.sessionStore.savePlan(args.sessionId, toPlanMarkdown(summary));
  return { path: saved.path, sizeBytes: saved.sizeBytes, updatedAt: saved.updatedAt };
}
