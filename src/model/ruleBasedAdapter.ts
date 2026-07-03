import { ModelAdapter, StepInput, StepPlan, ToolCall } from "../core/types";

export class RuleBasedAdapter implements ModelAdapter {
  async nextStep(input: StepInput): Promise<StepPlan> {
    const toolCalls: ToolCall[] = [];
    let spawnPrompt: string | undefined;

    if (input.userPrompt.includes("tool:echo")) {
      const text = input.userPrompt.split("tool:echo")[1]?.trim() ?? "";
      toolCalls.push({ name: "echo", input: { text } });
    }

    if (input.userPrompt.toLowerCase().includes("time")) {
      toolCalls.push({ name: "time", input: {} });
    }

    if (input.userPrompt.includes("spawn:")) {
      spawnPrompt = input.userPrompt.split("spawn:")[1]?.trim() ?? "empty spawn task";
    }

    return {
      assistantMessage: `Iteration ${input.iteration} complete.`,
      toolCalls,
      spawnRequest: spawnPrompt ? { prompt: spawnPrompt } : undefined,
      stop: input.iteration >= 2
    };
  }
}
