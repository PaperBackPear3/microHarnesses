import type { SubagentRunner } from "../../subagents/types";
import type { ToolDefinition } from "../../tools/types";

export interface SpawnSubagentToolOptions {
  toolName?: string;
  defaultAgentName?: string;
  maxIterations?: number;
}

const SPAWN_TOOL_NAME = "spawn_subagent";

export function createSpawnSubagentTool(
  runner: SubagentRunner,
  options: SpawnSubagentToolOptions = {},
): ToolDefinition {
  const toolName = options.toolName ?? SPAWN_TOOL_NAME;
  const defaultAgentName = options.defaultAgentName;
  const maxIterations = options.maxIterations ?? 8;

  return {
    name: toolName,
    description:
      "Delegate a task to a fresh child agent. The child runs with its own session and returns a summary.",
    risk: "high",
    capabilities: ["agent.spawn", "subagent.invoke"],
    tags: ["subagent", "delegation"],
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        agentName: { type: "string" },
        allowedTools: { type: "array", items: { type: "string" } },
        maxIterations: { type: "number" },
        goal: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      if (!prompt) {
        throw new Error(`${toolName}: "prompt" is required`);
      }
      const requestedAgent =
        typeof input.agentName === "string" && input.agentName.trim().length > 0
          ? input.agentName
          : defaultAgentName;
      const requestedTools = Array.isArray(input.allowedTools)
        ? input.allowedTools.filter(
            (item): item is string => typeof item === "string" && item !== toolName,
          )
        : undefined;
      const requestedMaxIterations =
        typeof input.maxIterations === "number" && Number.isFinite(input.maxIterations)
          ? Math.max(1, Math.min(maxIterations, Math.floor(input.maxIterations)))
          : maxIterations;
      const goal = typeof input.goal === "string" ? input.goal : undefined;

      const result = await runner.run({
        prompt,
        agentName: requestedAgent,
        allowedTools: requestedTools,
        maxIterations: requestedMaxIterations,
        goal,
        signal: context?.signal,
      });
      return {
        summary: result.summary,
        turns: result.state.turns.length,
        sessionId: result.state.sessionId,
      };
    },
  };
}
