import type { ModelRoutingPreference } from "../../model/types";
import type {
  SubagentAssignedTodo,
  SubagentService,
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

const ROUTING_PREFERENCES = ["auto", "cost", "speed", "intelligence", "balanced"] as const;
const EFFORT_LEVELS = ["low", "medium", "high"] as const;

/**
 * Parses a provider-qualified model id of the form `provider/model` (e.g.
 * `ollama/lfm2.5:8b`, `anthropic/claude-haiku-4-5`) into a
 * `{ providerId, model }` pair. Only the first `/` is treated as the
 * separator so model tags like `:8b` are preserved untouched. Returns
 * `{ model }` when no `/` is present.
 */
export function parseModelInput(raw: string): { model: string; providerId?: string } {
  const slash = raw.indexOf("/");
  if (slash === -1) return { model: raw };
  return { providerId: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

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
      "Delegate a task to a fresh child agent and return a running subagent handle. " +
      "Use 'name' for UI display labels. " +
      "Use 'model' for model selection — supports plain ids ('gpt-5.4-mini') and " +
      "provider-qualified ids ('ollama/lfm2.5:8b', 'anthropic/claude-haiku-4-5'). " +
      "Use 'providerId' to override the provider when 'model' is not provider-qualified. " +
      "Use 'promptName' only for installed prompt-pack persona ids ('coder', 'planner', etc.) — " +
      "not for model names or display labels.",
    risk: "high",
    capabilities: ["agent.spawn", "subagent.invoke"],
    tags: ["subagent", "delegation"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "UI display label for this subagent." },
        prompt: { type: "string", description: "Task or instructions for the child agent." },
        promptName: {
          type: "string",
          description:
            "Prompt-pack persona id (e.g. 'coder', 'planner'). Not for model names — use 'model' instead.",
        },
        model: {
          type: "string",
          description:
            "Model to use. Accepts plain ids ('gpt-5.4-mini') or provider-qualified ids ('ollama/lfm2.5:8b').",
        },
        providerId: {
          type: "string",
          description: "Provider id override when 'model' is not provider-qualified.",
        },
        routingPreference: {
          type: "string",
          enum: [...ROUTING_PREFERENCES],
          description: "Router preference: auto, cost, speed, intelligence, or balanced.",
        },
        effort: {
          type: "string",
          enum: [...EFFORT_LEVELS],
          description: "Effort level: low, medium, or high.",
        },
        allowedTools: { type: "array", items: { type: "string" } },
        maxIterations: { type: "number" },
        goal: { type: "string" },
        assignedTodos: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                  priority: { type: "number" },
                },
                required: ["text"],
                additionalProperties: false,
              },
            ],
          },
          description: "Optional todos assigned by the parent for the child to complete.",
        },
        assigned_todos: {
          type: "array",
          items: {
            oneOf: [{ type: "string" }, { type: "object" }],
          },
          description: "Alias for assignedTodos.",
        },
        todos: {
          type: "array",
          items: {
            oneOf: [{ type: "string" }, { type: "object" }],
          },
          description: "Alias for assignedTodos.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      if (!prompt) {
        throw new Error(`${toolName}: "prompt" is required`);
      }

      // Resolve model/providerId — supports provider-qualified shorthand.
      let resolvedModel: string | undefined;
      let resolvedProviderId: string | undefined;
      if (typeof input.model === "string" && input.model.trim().length > 0) {
        const parsed = parseModelInput(input.model.trim());
        resolvedModel = parsed.model;
        resolvedProviderId = parsed.providerId;
      }
      // Explicit providerId wins over what was parsed from the model string.
      if (typeof input.providerId === "string" && input.providerId.trim().length > 0) {
        resolvedProviderId = input.providerId.trim();
      }

      // Resolve promptName / compatibility shim.
      // If promptName looks like "provider/model" (contains a slash) and no
      // explicit model was given, treat it as a model override and fall back
      // to the default persona — this handles the common mistake of passing a
      // model id where a persona id belongs.
      let requestedAgent: string | undefined;
      const rawPromptName =
        typeof input.promptName === "string" ? input.promptName.trim() : undefined;
      if (rawPromptName) {
        if (rawPromptName.includes("/") && !resolvedModel) {
          const parsed = parseModelInput(rawPromptName);
          resolvedModel = parsed.model;
          resolvedProviderId = parsed.providerId;
          requestedAgent = defaultPromptName;
        } else {
          requestedAgent = rawPromptName;
        }
      } else {
        requestedAgent = defaultPromptName;
      }

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
      const assignedTodos = normalizeAssignedTodos(
        input.assignedTodos ?? input.assigned_todos ?? input.todos,
      );

      const rawPreference =
        typeof input.routingPreference === "string" ? input.routingPreference : undefined;
      const routingPreference =
        rawPreference && (ROUTING_PREFERENCES as readonly string[]).includes(rawPreference)
          ? (rawPreference as ModelRoutingPreference)
          : undefined;

      const rawEffort = typeof input.effort === "string" ? input.effort : undefined;
      const effort =
        rawEffort && (EFFORT_LEVELS as readonly string[]).includes(rawEffort)
          ? (rawEffort as "low" | "medium" | "high")
          : undefined;

      const spawned = await subagents.spawn({
        ...(requestedName.length > 0 ? { name: requestedName } : {}),
        prompt,
        promptName: requestedAgent,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
        ...(routingPreference ? { routingPreference } : {}),
        ...(effort ? { effort } : {}),
        allowedTools: requestedTools,
        maxIterations: requestedMaxIterations,
        goal,
        ...(assignedTodos.length > 0 ? { assignedTodos } : {}),
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

function normalizeAssignedTodos(raw: unknown): SubagentAssignedTodo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): SubagentAssignedTodo[] => {
    if (typeof item === "string") {
      const text = item.trim();
      return text ? [{ text }] : [];
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.text !== "string" || record.text.trim().length === 0) return [];
    return [
      {
        ...(typeof record.id === "string" && record.id.trim().length > 0
          ? { id: record.id.trim() }
          : {}),
        text: record.text.trim(),
        ...(typeof record.priority === "number" && Number.isFinite(record.priority)
          ? { priority: record.priority }
          : {}),
      },
    ];
  });
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
    executionTimeoutMs: "none",
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
