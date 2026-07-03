import type {
  HarnessPlugin,
  PluginApi,
  PluginCapability,
  ToolDefinition,
} from "@micro-harness/core";

const CAPABILITIES: PluginCapability[] = ["tools", "subagents"];

const SPAWN_TOOL_NAME = "spawn_subagent";

export interface SubagentsPluginOptions {
  /** Override the tool name (defaults to `spawn_subagent`). */
  toolName?: string;
  /**
   * Default `agentName` for children when the caller doesn't specify one.
   * When unset, the child inherits its parent's agent.
   */
  defaultAgentName?: string;
  /** Cap on child iterations (defaults to 8). */
  maxIterations?: number;
}

/**
 * Exposes an in-process `spawn_subagent` tool to the model. Requires the host
 * to have wired a `SubagentRunner` into the `PluginHost`.
 */
export class SubagentsPlugin implements HarnessPlugin {
  readonly name = "subagents-plugin";
  readonly capabilities = CAPABILITIES;
  private readonly toolName: string;
  private readonly defaultAgentName?: string;
  private readonly maxIterations: number;

  constructor(options: SubagentsPluginOptions = {}) {
    this.toolName = options.toolName ?? SPAWN_TOOL_NAME;
    this.defaultAgentName = options.defaultAgentName;
    this.maxIterations = options.maxIterations ?? 8;
  }

  register(api: PluginApi): void {
    api.registerTool(this.buildTool(api));
  }

  private buildTool(api: PluginApi): ToolDefinition {
    const toolName = this.toolName;
    const defaultAgent = this.defaultAgentName;
    const maxIterations = this.maxIterations;
    return {
      name: toolName,
      description:
        "Delegate a task to a fresh child agent. The child runs its own harness loop " +
        "with a filtered tool set (this tool is excluded by default to bound recursion) " +
        "and returns only its final assistant message as a summary.",
      risk: "high",
      async execute(input, context) {
        const prompt = typeof input.prompt === "string" ? input.prompt : "";
        if (!prompt.trim()) {
          throw new Error(`${toolName}: "prompt" is required`);
        }
        const agentName = typeof input.agentName === "string" ? input.agentName : defaultAgent;
        const allowedTools = Array.isArray(input.allowedTools)
          ? (input.allowedTools as unknown[]).filter(
              (item): item is string => typeof item === "string" && item !== toolName,
            )
          : undefined;
        const goal = typeof input.goal === "string" ? input.goal : undefined;
        const requested =
          typeof input.maxIterations === "number" && Number.isFinite(input.maxIterations)
            ? Math.max(1, Math.min(maxIterations, Math.floor(input.maxIterations)))
            : maxIterations;

        const result = await api.subagents.run({
          prompt,
          agentName,
          allowedTools,
          maxIterations: requested,
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
}

export const subagentsPlugin: HarnessPlugin = new SubagentsPlugin();
