import type { SubagentService, SubagentWaitOptions } from "../../subagents/types";
import type { ToolDefinition } from "../../tools/types";

export interface SpawnSubagentToolOptions {
  toolName?: string;
  defaultPromptName?: string;
  maxIterations?: number;
}

const SPAWN_TOOL_NAME = "spawn_subagent";
const WAIT_TOOL_NAME = "wait_subagents";

export function createSpawnSubagentTool(
  subagents: SubagentService,
  options: SpawnSubagentToolOptions = {},
): ToolDefinition {
  const toolName = options.toolName ?? SPAWN_TOOL_NAME;
  const defaultPromptName = options.defaultPromptName;
  const maxIterations = options.maxIterations ?? 8;

  return {
    name: toolName,
    description:
      "Delegate a task to a fresh child agent and return a running subagent handle. Use name for UI label, promptName for installed prompt-pack persona.",
    risk: "high",
    capabilities: ["agent.spawn", "subagent.invoke"],
    tags: ["subagent", "delegation"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        promptName: { type: "string" },
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
        typeof input.promptName === "string" && input.promptName.trim().length > 0
          ? input.promptName
          : defaultPromptName;
      const requestedName = typeof input.name === "string" ? input.name.trim() : "";
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

      const spawned = await subagents.spawn({
        ...(requestedName.length > 0 ? { name: requestedName } : {}),
        prompt,
        promptName: requestedAgent,
        allowedTools: requestedTools,
        maxIterations: requestedMaxIterations,
        goal,
        signal: context?.signal,
        ...(context?.traceContext ? { parentTrace: context.traceContext } : {}),
      });
      return {
        subagentId: spawned.id,
        launchIndex: spawned.launchIndex,
        status: spawned.status,
        ...(requestedName.length > 0 ? { name: requestedName } : {}),
        ...(spawned.sessionId ? { sessionId: spawned.sessionId } : {}),
      };
    },
  };
}

export interface WaitSubagentsToolOptions {
  toolName?: string;
}

export function createWaitSubagentsTool(
  subagents: SubagentService,
  options: WaitSubagentsToolOptions = {},
): ToolDefinition {
  const toolName = options.toolName ?? WAIT_TOOL_NAME;
  return {
    name: toolName,
    description:
      "Wait for tracked subagents. By default returns the next completed subagent summary and remaining running subagents; use mode=all to join every currently running subagent.",
    risk: "low",
    capabilities: ["agent.wait", "subagent.join"],
    tags: ["subagent", "delegation", "wait"],
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        mode: { type: "string", enum: ["next", "all"] },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      const ids = Array.isArray(input.ids)
        ? input.ids.filter((item): item is string => typeof item === "string")
        : undefined;
      const mode = input.mode === "all" ? "all" : "next";
      const waitOptions: SubagentWaitOptions = {
        mode,
        signal: context?.signal,
        ...(ids && ids.length > 0 ? { ids } : {}),
      };
      const result = await subagents.wait(waitOptions);
      return {
        completed: result.completed,
        running: result.running,
        remaining: result.running.length,
      };
    },
  };
}
