import type { SafetyMode } from "../policy/types";

export interface PromptBundle {
  system: string;
  instructions: PromptInstruction[];
  task: string;
  metadata: PromptMetadata;
}

export interface PromptInstruction {
  role: "system" | "developer" | "tools" | "custom";
  name: string;
  content: string;
}

export interface PromptMetadata {
  name: string;
  modelHint?: string;
  taskTypeHint?: "default" | "reasoning" | "fast";
  safetyMode?: SafetyMode;
  tags?: string[];
}

export interface PromptSource {
  load(agentName: string, task: string, variables?: Record<string, string>): Promise<PromptBundle>;
}
