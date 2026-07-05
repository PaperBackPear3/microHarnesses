import type { SafetyMode, ToolPolicyEngine } from "../policy/types";
import type { RunEmitter } from "../runtime/runEmitter";
import type { ApprovalHandler, CapabilityScope, RuntimeLimits } from "../runtime/types";
import { ToolTimeoutError } from "../shared/errors";
import type { ToolCall, ToolDefinition, ToolResolver, ToolResult } from "../tools/types";

export interface ActionExecutionEngineDeps {
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
export interface ActionCallBudget {
  remaining: number;
}

export interface ActionExecutionContext {
  promptName: string;
  iteration: number;
  safetyMode?: SafetyMode;
  emitter: RunEmitter;
  capabilityScope?: CapabilityScope;
  /** Aborted when the run is killed; propagated into every tool execution. */
  signal?: AbortSignal;
  /** Shared allowance decremented per executed call. */
  budget?: ActionCallBudget;
  lineage?: {
    parentSessionId?: string;
    parentRunId?: string;
    rootSessionId?: string;
    depth?: number;
  };
  isCancelled(): boolean;
}

export interface ActionExecutionOutcome {
  results: ToolResult[];
  /** Number of calls actually handed to a tool's `execute`. */
  executed: number;
  /** True when at least one call was blocked because the run budget was exhausted. */
  limitReached: boolean;
}

/**
 * Executes the model-requested actions (tools or skills) of a single step:
 * scope/budget/policy evaluation, cancellation checks, timeout/abort
 * enforcement, and event/support-history reporting. Both tools and skills flow
 * through this one governed pipeline. Failures never throw — they become
 * `{ ok: false }` results.
 */
export class ActionExecutionEngine {
  private readonly tools: ToolResolver;
  private readonly policy: ToolPolicyEngine;
  private readonly limits: RuntimeLimits;
  private readonly approvalHandler?: ApprovalHandler;
  private readonly actionLabel: string;

  constructor(deps: ActionExecutionEngineDeps) {
    this.tools = deps.tools;
    this.policy = deps.policy;
    this.limits = deps.limits;
    this.approvalHandler = deps.approvalHandler;
    this.actionLabel = deps.actionLabel ?? "Tool";
  }

  async executeCalls(
    calls: ToolCall[],
    ctx: ActionExecutionContext,
  ): Promise<ActionExecutionOutcome> {
    const results: ToolResult[] = [];
    let executed = 0;
    let limitReached = false;

    for (const originalCall of calls) {
      const call = normalizeToolCallName(originalCall);

      if (ctx.budget && ctx.budget.remaining <= 0) {
        limitReached = true;
        const message = `${this.actionLabel} "${call.name}" skipped: run tool-call limit of ${this.limits.maxActionCallsPerRun} reached`;
        await ctx.emitter.emit("run.limit_reached", {
          action: call.name,
          limit: this.limits.maxActionCallsPerRun,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          action: call.name,
          category: "limit_reached",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      if (isOutOfScope(call.name, ctx.capabilityScope)) {
        const message = `${this.actionLabel} "${call.name}" is out of scope for this agent invocation`;
        await ctx.emitter.emit("action.blocked", {
          action: call.name,
          input: call.input,
          decision: "deny",
          reason: message,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          action: call.name,
          category: "out_of_scope",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      if (ctx.isCancelled()) {
        await ctx.emitter.emit("action.killed", {
          action: call.name,
          reason: "runtime killed during tool phase",
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          action: call.name,
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
        await ctx.emitter.emit("action.blocked", {
          action: call.name,
          input: call.input,
          decision: "deny",
          reason: message,
          iteration: ctx.iteration,
        });
        await ctx.emitter.support({
          iteration: ctx.iteration,
          action: call.name,
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
          action: call.name,
          category: "malformed_args",
          reason: message,
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      const policy = await this.policy.evaluate(tool, call, {
        runId: ctx.emitter.runId,
        promptName: ctx.promptName,
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
            await ctx.emitter.emit("action.blocked", {
              action: call.name,
              input: call.input,
              decision: "require_approval",
              reason: denialReason,
              iteration: ctx.iteration,
            });
            await ctx.emitter.support({
              iteration: ctx.iteration,
              action: call.name,
              category: "approval_denied",
              reason: denialReason,
            });
            results.push({ ok: false, output: {}, error: denialReason });
            continue;
          }
        } else {
          await ctx.emitter.emit("action.blocked", {
            action: call.name,
            input: call.input,
            decision: policy.decision,
            reason: policy.reason,
            iteration: ctx.iteration,
          });
          await ctx.emitter.support({
            iteration: ctx.iteration,
            action: call.name,
            category: "policy",
            reason: policy.reason,
          });
          results.push({ ok: false, output: {}, error: policy.reason });
          continue;
        }
      }

      await ctx.emitter.emit("action.allowed", {
        action: call.name,
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
          action: call.name,
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
    ctx: ActionExecutionContext,
  ): Promise<boolean> {
    await ctx.emitter.emit("action.approval_requested", {
      action: call.name,
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
        promptName: ctx.promptName,
        tool,
        call,
        reason,
        safetyMode: ctx.safetyMode,
        parentSessionId: ctx.lineage?.parentSessionId,
        parentRunId: ctx.lineage?.parentRunId,
        rootSessionId: ctx.lineage?.rootSessionId,
        depth: ctx.lineage?.depth,
      });
      await ctx.emitter.emit(approved ? "action.approval_approved" : "action.approval_denied", {
        action: call.name,
        input: call.input,
        iteration: ctx.iteration,
        reason,
      });
      return approved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval handler failed";
      await ctx.emitter.emit("action.approval_denied", {
        action: call.name,
        input: call.input,
        iteration: ctx.iteration,
        reason: `handler error: ${message}`,
      });
      return false;
    }
  }
}

function isOutOfScope(actionName: string, scope?: CapabilityScope): boolean {
  if (!scope) return false;
  if (
    scope.allowActions &&
    scope.allowActions.length > 0 &&
    !scope.allowActions.includes(actionName)
  ) {
    return true;
  }
  if (scope.denyActions?.includes(actionName)) {
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
