import type { SafetyMode, ToolPolicyEngine } from "../policy/types";
import type { RunEmitter } from "../runtime/runEmitter";
import type { RuntimeLimits } from "../runtime/types";
import { ToolTimeoutError } from "../shared/errors";
import type { ToolRegistry } from "./registry";
import type { ToolCall, ToolDefinition, ToolResult } from "./types";

export interface ToolExecutionEngineDeps {
  tools: ToolRegistry;
  policy: ToolPolicyEngine;
  limits: RuntimeLimits;
}

export interface ToolExecutionRunContext {
  agentName: string;
  iteration: number;
  safetyMode?: SafetyMode;
  emitter: RunEmitter;
  isCancelled(): boolean;
}

/**
 * Executes the tool calls of a single step: policy evaluation, cancellation
 * checks, timeout/abort enforcement, and event/support-history reporting.
 * Tool failures never throw — they become `{ ok: false }` results.
 */
export class ToolExecutionEngine {
  private readonly tools: ToolRegistry;
  private readonly policy: ToolPolicyEngine;
  private readonly limits: RuntimeLimits;
  private activeToolController?: AbortController;

  constructor(deps: ToolExecutionEngineDeps) {
    this.tools = deps.tools;
    this.policy = deps.policy;
    this.limits = deps.limits;
  }

  abort(reason: string): void {
    this.activeToolController?.abort(reason);
  }

  async executeCalls(calls: ToolCall[], ctx: ToolExecutionRunContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      if (ctx.isCancelled()) {
        await ctx.emitter.emit("tool.killed", {
          tool: call.name,
          reason: "runtime killed during tool phase",
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "killed",
          reason: "runtime killed during tool phase",
        });
        results.push({
          ok: false,
          output: {},
          error: "Tool skipped because runtime was killed",
        });
        continue;
      }

      let tool: ToolDefinition;
      try {
        tool = this.tools.get(call.name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown tool";
        await ctx.emitter.emit("tool.blocked", {
          tool: call.name,
          decision: "deny",
          reason: message,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "unknown_tool",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      if (call.malformedInput) {
        const message = `Tool "${call.name}" received malformed arguments from the model`;
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "malformed_args",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      const policy = await this.policy.evaluate(tool, call, {
        runId: ctx.emitter.runId,
        agentName: ctx.agentName,
        iteration: ctx.iteration,
        safetyMode: ctx.safetyMode,
      });

      if (policy.decision !== "allow") {
        await ctx.emitter.emit("tool.blocked", {
          tool: call.name,
          decision: policy.decision,
          reason: policy.reason,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "policy",
          reason: policy.reason,
        });
        results.push({ ok: false, output: {}, error: policy.reason });
        continue;
      }

      await ctx.emitter.emit("tool.allowed", { tool: call.name, iteration: ctx.iteration });

      try {
        this.activeToolController = new AbortController();
        const output = await withTimeout(
          (signal) => tool.execute(call.input, { signal }),
          this.limits.toolTimeoutMs,
          this.activeToolController,
        );
        results.push({ ok: true, output });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown tool error";
        const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "tool_error",
          reason: message,
          code,
        });
        results.push({ ok: false, output: {}, error: message });
      } finally {
        this.activeToolController = undefined;
      }
    }
    return results;
  }
}

async function withTimeout<T>(
  runner: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      controller.abort(`tool timeout ${timeoutMs}ms`);
      reject(new ToolTimeoutError(`Tool exceeded timeout of ${timeoutMs}ms`));
    }, timeoutMs);

    runner(controller.signal)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
