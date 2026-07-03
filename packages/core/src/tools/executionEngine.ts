import type { SafetyMode, ToolPolicyEngine } from "../policy/types";
import type { RunEmitter } from "../runtime/runEmitter";
import type { ApprovalHandler, RuntimeLimits } from "../runtime/types";
import { ToolTimeoutError } from "../shared/errors";
import type { ToolRegistry } from "./registry";
import type { ToolCall, ToolDefinition, ToolResult } from "./types";

export interface ToolExecutionEngineDeps {
  tools: ToolRegistry;
  policy: ToolPolicyEngine;
  limits: RuntimeLimits;
  approvalHandler?: ApprovalHandler;
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
  private readonly approvalHandler?: ApprovalHandler;
  private activeToolController?: AbortController;

  constructor(deps: ToolExecutionEngineDeps) {
    this.tools = deps.tools;
    this.policy = deps.policy;
    this.limits = deps.limits;
    this.approvalHandler = deps.approvalHandler;
  }

  abort(reason: string): void {
    this.activeToolController?.abort(reason);
  }

  async executeCalls(calls: ToolCall[], ctx: ToolExecutionRunContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const originalCall of calls) {
      const call = normalizeToolCallName(originalCall);
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
        if (policy.decision === "require_approval") {
          const approved = await this.requestApproval(tool, call, policy.reason, ctx);
          if (approved) {
            // fall through to execution
          } else {
            const denialReason = this.approvalHandler
              ? `Approval denied: ${policy.reason}`
              : `Approval required but no handler configured: ${policy.reason}`;
            await ctx.emitter.emit("tool.blocked", {
              tool: call.name,
              decision: "require_approval",
              reason: denialReason,
              iteration: ctx.iteration,
            });
            await ctx.emitter.support({
              iteration: ctx.iteration,
              tool: call.name,
              category: "approval_denied",
              reason: denialReason,
            });
            results.push({ ok: false, output: {}, error: denialReason });
            continue;
          }
        } else {
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

  private async requestApproval(
    tool: ToolDefinition,
    call: ToolCall,
    reason: string,
    ctx: ToolExecutionRunContext,
  ): Promise<boolean> {
    await ctx.emitter.emit("tool.approval_requested", {
      tool: call.name,
      reason,
      iteration: ctx.iteration,
    });
    if (!this.approvalHandler) {
      return false;
    }
    try {
      const approved = await this.approvalHandler({
        runId: ctx.emitter.runId,
        iteration: ctx.iteration,
        agentName: ctx.agentName,
        tool,
        call,
        reason,
        safetyMode: ctx.safetyMode,
      });
      await ctx.emitter.emit(approved ? "tool.approval_approved" : "tool.approval_denied", {
        tool: call.name,
        iteration: ctx.iteration,
        reason,
      });
      return approved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval handler failed";
      await ctx.emitter.emit("tool.approval_denied", {
        tool: call.name,
        iteration: ctx.iteration,
        reason: `handler error: ${message}`,
      });
      return false;
    }
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

function normalizeToolCallName(call: ToolCall): ToolCall {
  const trimmed = call.name.trim();
  const match = /^([A-Za-z0-9_-]+)\(\)$/.exec(trimmed);
  const normalizedName = match ? match[1] : trimmed;
  if (normalizedName === call.name) {
    return call;
  }
  return { ...call, name: normalizedName };
}
