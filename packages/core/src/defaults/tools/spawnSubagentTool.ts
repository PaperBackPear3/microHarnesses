import type {
  SubagentRunner,
  SubagentSupervisor,
  SubagentWaitOptions,
} from "../../subagents/types";
import type { ToolDefinition } from "../../tools/types";

export interface SpawnSubagentToolOptions {
  toolName?: string;
  defaultPromptName?: string;
  maxIterations?: number;
}

const SPAWN_TOOL_NAME = "spawn_subagent";
const WAIT_TOOL_NAME = "wait_subagents";

export function createSpawnSubagentTool(
  runner: SubagentRunner,
  options: SpawnSubagentToolOptions = {},
): ToolDefinition {
  const toolName = options.toolName ?? SPAWN_TOOL_NAME;
  const defaultPromptName = options.defaultPromptName;
  const maxIterations = options.maxIterations ?? 8;

  return {
    name: toolName,
    description:
      "Delegate a task to a fresh child agent. With a subagent supervisor, returns a handle immediately; otherwise runs the child to completion and returns a summary.",
    risk: "high",
    capabilities: ["agent.spawn", "subagent.invoke"],
    tags: ["subagent", "delegation"],
    inputSchema: {
      type: "object",
      properties: {
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

      if (isSubagentSupervisor(runner)) {
        const spawned = await runner.spawn({
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
          ...(spawned.sessionId ? { sessionId: spawned.sessionId } : {}),
        };
      }

      const result = await runner.run({
        prompt,
        promptName: requestedAgent,
        allowedTools: requestedTools,
        maxIterations: requestedMaxIterations,
        goal,
        signal: context?.signal,
        ...(context?.traceContext ? { parentTrace: context.traceContext } : {}),
      });
      return {
        summary: result.summary,
        turns: result.state.turns.length,
        sessionId: result.state.sessionId,
      };
    },
  };
}

export interface WaitSubagentsToolOptions {
  toolName?: string;
}

export function createWaitSubagentsTool(
  supervisor: SubagentSupervisor,
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
      const result = await supervisor.wait(waitOptions);
      return {
        completed: result.completed,
        running: result.running,
        remaining: result.running.length,
      };
    },
  };
}

export function isSubagentSupervisor(runner: SubagentRunner): runner is SubagentSupervisor {
  const candidate = runner as Partial<SubagentSupervisor>;
  return (
    typeof candidate.spawn === "function" &&
    typeof candidate.wait === "function" &&
    typeof candidate.list === "function"
  );
}
