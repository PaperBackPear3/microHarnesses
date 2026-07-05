import type { SafetyMode, ToolPolicyEngine } from "../policy/types";
import type { RunEmitter } from "../runtime/runEmitter";
import type { ApprovalHandler, CapabilityScope, RuntimeLimits } from "../runtime/types";
import { ToolTimeoutError } from "../shared/errors";
import type { ToolCall, ToolDefinition, ToolResolver, ToolResult } from "./types";

export interface ToolExecutionEngineDeps {
  tools: ToolResolver;
  policy: ToolPolicyEngine;
  limits: RuntimeLimits;
  approvalHandler?: ApprovalHandler;
  /**
   * Label describing what kind of action this engine executes ("Tool" or
   * "Skill"). Only affects support-history/error phrasing; both kinds share the
   * same governed pipeline and `tool.*` events.
   */
  actionLabel?: string;
}

/** Shared, mutable call budget so tools and skills draw from one allowance. */
export interface ToolCallBudget {
  remaining: number;
}

export interface ToolExecutionRunContext {
  agentName: string;
  iteration: number;
  safetyMode?: SafetyMode;
  emitter: RunEmitter;
  capabilityScope?: CapabilityScope;
  /** Aborted when the run is killed; propagated into every tool execution. */
  signal?: AbortSignal;
  /** Shared allowance decremented per executed call. */
  budget?: ToolCallBudget;
  lineage?: {
    parentSessionId?: string;
    parentRunId?: string;
    rootSessionId?: string;
    depth?: number;
  };
  isCancelled(): boolean;
}

export interface ToolExecutionOutcome {
  results: ToolResult[];
  /** Number of calls actually handed to a tool's `execute`. */
  executed: number;
  /** True when at least one call was blocked because the run budget was exhausted. */
  limitReached: boolean;
}

/**
 * Executes the tool calls of a single step: scope/budget/policy evaluation,
 * cancellation checks, timeout/abort enforcement, and event/support-history
 * reporting. Tool failures never throw — they become `{ ok: false }` results.
 */
export class ToolExecutionEngine {
  private readonly tools: ToolResolver;
  private readonly policy: ToolPolicyEngine;
  private readonly limits: RuntimeLimits;
  private readonly approvalHandler?: ApprovalHandler;
  private readonly actionLabel: string;

  constructor(deps: ToolExecutionEngineDeps) {
    this.tools = deps.tools;
    this.policy = deps.policy;
    this.limits = deps.limits;
    this.approvalHandler = deps.approvalHandler;
    this.actionLabel = deps.actionLabel ?? "Tool";
  }

  async executeCalls(
    calls: ToolCall[],
    ctx: ToolExecutionRunContext,
  ): Promise<ToolExecutionOutcome> {
    const results: ToolResult[] = [];
    let executed = 0;
    let limitReached = false;

    for (const originalCall of calls) {
      const call = normalizeToolCallName(originalCall);

      if (ctx.budget && ctx.budget.remaining <= 0) {
        limitReached = true;
        const message = `${this.actionLabel} "${call.name}" skipped: run tool-call limit of ${this.limits.maxToolCallsPerRun} reached`;
        await ctx.emitter.emit("run.limit_reached", {
          tool: call.name,
          limit: this.limits.maxToolCallsPerRun,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "limit_reached",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      if (isOutOfScope(call.name, ctx.capabilityScope)) {
        const message = `${this.actionLabel} "${call.name}" is out of scope for this agent invocation`;
        await ctx.emitter.emit("tool.blocked", {
          tool: call.name,
          input: call.input,
          decision: "deny",
          reason: message,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          tool: call.name,
          category: "out_of_scope",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

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
          error: `${this.actionLabel} skipped because runtime was killed`,
        });
        continue;
      }

      let tool: ToolDefinition;
      try {
        tool = this.tools.get(call.name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : `Unknown ${this.actionLabel}`;
        await ctx.emitter.emit("tool.blocked", {
          tool: call.name,
          input: call.input,
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
        const message = `${this.actionLabel} "${call.name}" received malformed arguments from the model`;
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
        parentSessionId: ctx.lineage?.parentSessionId,
        parentRunId: ctx.lineage?.parentRunId,
        rootSessionId: ctx.lineage?.rootSessionId,
        depth: ctx.lineage?.depth,
      });

      // Re-check cancellation after the (async) policy evaluation.
      if (ctx.isCancelled()) {
        results.push({
          ok: false,
          output: {},
          error: `${this.actionLabel} skipped because runtime was killed`,
        });
        continue;
      }

      if (policy.decision !== "allow") {
        if (policy.decision === "require_approval") {
          const approved = await this.requestApproval(tool, call, policy.reason, ctx);
          if (!approved || ctx.isCancelled()) {
            const denialReason = ctx.isCancelled()
              ? "Approval abandoned because runtime was killed"
              : this.approvalHandler
                ? `Approval denied: ${policy.reason}`
                : `Approval required but no handler configured: ${policy.reason}`;
            await ctx.emitter.emit("tool.blocked", {
              tool: call.name,
              input: call.input,
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
            input: call.input,
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

      await ctx.emitter.emit("tool.allowed", {
        tool: call.name,
        input: call.input,
        iteration: ctx.iteration,
      });

      if (ctx.budget) {
        ctx.budget.remaining -= 1;
      }
      executed += 1;

      try {
        const output = await withTimeout(
          (signal) => tool.execute(call.input, { signal }),
          this.limits.toolTimeoutMs,
          ctx.signal,
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
      }
    }

    return { results, executed, limitReached };
  }

  private async requestApproval(
    tool: ToolDefinition,
    call: ToolCall,
    reason: string,
    ctx: ToolExecutionRunContext,
  ): Promise<boolean> {
    await ctx.emitter.emit("tool.approval_requested", {
      tool: call.name,
      input: call.input,
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
        parentSessionId: ctx.lineage?.parentSessionId,
        parentRunId: ctx.lineage?.parentRunId,
        rootSessionId: ctx.lineage?.rootSessionId,
        depth: ctx.lineage?.depth,
      });
      await ctx.emitter.emit(approved ? "tool.approval_approved" : "tool.approval_denied", {
        tool: call.name,
        input: call.input,
        iteration: ctx.iteration,
        reason,
      });
      return approved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval handler failed";
      await ctx.emitter.emit("tool.approval_denied", {
        tool: call.name,
        input: call.input,
        iteration: ctx.iteration,
        reason: `handler error: ${message}`,
      });
      return false;
    }
  }
}

function isOutOfScope(toolName: string, scope?: CapabilityScope): boolean {
  if (!scope) return false;
  if (scope.allowTools && scope.allowTools.length > 0 && !scope.allowTools.includes(toolName)) {
    return true;
  }
  if (scope.denyTools?.includes(toolName)) {
    return true;
  }
  return false;
}

/**
 * Runs a tool with a per-call timeout. The tool receives an AbortSignal that
 * fires on timeout OR when the run-level `externalSignal` aborts (kill). Tools
 * that ignore the signal cannot be forcibly stopped, but the outer promise
 * still rejects so the run does not hang.
 */
async function withTimeout<T>(
  runner: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      fn();
    };

    const timeoutId = setTimeout(() => {
      controller.abort(`tool timeout ${timeoutMs}ms`);
      finish(() => reject(new ToolTimeoutError(`Tool exceeded timeout of ${timeoutMs}ms`)));
    }, timeoutMs);

    function onExternalAbort(): void {
      controller.abort(externalSignal?.reason);
      finish(() => reject(new Error("Tool aborted because the run was cancelled")));
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort();
        return;
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    runner(controller.signal)
      .then((value) => finish(() => resolve(value)))
      .catch((error) => finish(() => reject(error)));
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
