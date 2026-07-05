import type { ErrorCategory, Span } from "../observability/types";
import type { SafetyMode, ToolPolicyEngine } from "../policy/types";
import type { RunObserver } from "../runtime/runObserver";
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
   * "Skill"). Drives span kind, metric selection, and error phrasing; both
   * kinds share the same governed pipeline.
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
  observer: RunObserver;
  /** Iteration span the per-action spans are parented under. */
  parentSpan: Span;
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

type ActionKind = "tool" | "skill";

/**
 * Executes the model-requested actions (tools or skills) of a single step:
 * scope/budget/policy evaluation, cancellation checks, timeout/abort
 * enforcement, and full observability (per-action span, metrics, logs, live
 * stream). Both tools and skills flow through this one governed pipeline.
 * Failures never throw — they become `{ ok: false }` results.
 */
export class ActionExecutionEngine {
  private readonly tools: ToolResolver;
  private readonly policy: ToolPolicyEngine;
  private readonly limits: RuntimeLimits;
  private readonly approvalHandler?: ApprovalHandler;
  private readonly actionLabel: string;
  private readonly kind: ActionKind;

  constructor(deps: ActionExecutionEngineDeps) {
    this.tools = deps.tools;
    this.policy = deps.policy;
    this.limits = deps.limits;
    this.approvalHandler = deps.approvalHandler;
    this.actionLabel = deps.actionLabel ?? "Tool";
    this.kind = this.actionLabel === "Skill" ? "skill" : "tool";
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
        ctx.observer.countLimitReached(call.name);
        ctx.observer.countError("limit_reached", call.name);
        ctx.observer.log("warn", message, {
          action: call.name,
          category: "limit_reached",
          iteration: ctx.iteration,
        });
        await ctx.observer.stream(
          "limit.reached",
          { action: call.name, limit: this.limits.maxActionCallsPerRun, iteration: ctx.iteration },
          ctx.parentSpan,
        );
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      const single = await this.executeSingle(call, ctx);
      results.push(single.result);
      if (single.executed) executed += 1;
    }

    return { results, executed, limitReached };
  }

  private async executeSingle(
    call: ToolCall,
    ctx: ActionExecutionContext,
  ): Promise<{ result: ToolResult; executed: boolean }> {
    const span = ctx.observer.startAction(this.kind, call.name, ctx.parentSpan, {
      iteration: ctx.iteration,
      ...ctx.observer.content({ input: safeJson(call.input) }),
    });
    try {
      return await this.governAndRun(call, ctx, span);
    } finally {
      span.end();
    }
  }

  private async governAndRun(
    call: ToolCall,
    ctx: ActionExecutionContext,
    span: Span,
  ): Promise<{ result: ToolResult; executed: boolean }> {
    if (isOutOfScope(call.name, ctx.capabilityScope)) {
      const message = `${this.actionLabel} "${call.name}" is out of scope for this agent invocation`;
      return this.blocked(ctx, span, call, "deny", "out_of_scope", message);
    }

    if (ctx.isCancelled()) {
      return this.killed(ctx, span, call, "runtime killed during tool phase");
    }

    let tool: ToolDefinition;
    try {
      tool = this.tools.get(call.name);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `Unknown ${this.actionLabel}`;
      return this.blocked(ctx, span, call, "deny", "unknown_tool", message);
    }

    if (call.malformedInput) {
      const message = `${this.actionLabel} "${call.name}" received malformed arguments from the model`;
      ctx.observer.countAction(this.kind, call.name, "malformed_args");
      ctx.observer.countError("malformed_args", call.name);
      ctx.observer.log(
        "warn",
        message,
        { action: call.name, category: "malformed_args", iteration: ctx.iteration },
        span,
      );
      span.recordException(new Error(message), "malformed_args");
      return { result: { ok: false, output: {}, error: message }, executed: false };
    }

    const policy = await this.policy.evaluate(tool, call, {
      runId: ctx.observer.runId,
      promptName: ctx.promptName,
      iteration: ctx.iteration,
      safetyMode: ctx.safetyMode,
      parentSessionId: ctx.lineage?.parentSessionId,
      parentRunId: ctx.lineage?.parentRunId,
      rootSessionId: ctx.lineage?.rootSessionId,
      depth: ctx.lineage?.depth,
    });
    ctx.observer.countPolicyDecision(policy.decision, call.name);
    span.addEvent("policy.evaluated", { decision: policy.decision, reason: policy.reason });

    // Re-check cancellation after the (async) policy evaluation.
    if (ctx.isCancelled()) {
      return this.killed(ctx, span, call, "runtime killed during tool phase");
    }

    if (policy.decision !== "allow") {
      if (policy.decision === "require_approval") {
        const approved = await this.requestApproval(tool, call, policy.reason, ctx, span);
        if (!approved || ctx.isCancelled()) {
          const denialReason = ctx.isCancelled()
            ? "Approval abandoned because runtime was killed"
            : this.approvalHandler
              ? `Approval denied: ${policy.reason}`
              : `Approval required but no handler configured: ${policy.reason}`;
          ctx.observer.countApprovalDenied(call.name);
          return this.blocked(ctx, span, call, "require_approval", "approval_denied", denialReason);
        }
      } else {
        return this.blocked(ctx, span, call, policy.decision, "policy", policy.reason);
      }
    }

    span.addEvent("action.allowed");
    await ctx.observer.stream(
      "tool.started",
      { action: call.name, kind: this.kind, iteration: ctx.iteration },
      span,
    );

    if (ctx.budget) {
      ctx.budget.remaining -= 1;
    }

    const startedAt = Date.now();
    try {
      const output = await withTimeout(
        (signal) => tool.execute(call.input, { signal, traceContext: span.context }),
        this.limits.toolTimeoutMs,
        ctx.signal,
      );
      const durationMs = Date.now() - startedAt;
      ctx.observer.countAction(this.kind, call.name, "ok");
      ctx.observer.recordActionDuration(this.kind, durationMs, call.name, "ok");
      span.setStatus({ code: "ok" });
      span.setAttributes(ctx.observer.content({ output: safeJson(output) }));
      await ctx.observer.stream(
        "tool.completed",
        { action: call.name, kind: this.kind, ok: true, durationMs, iteration: ctx.iteration },
        span,
      );
      return { result: { ok: true, output }, executed: true };
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "unknown tool error";
      const category: ErrorCategory = error instanceof ToolTimeoutError ? "timeout" : "tool_error";
      ctx.observer.countAction(this.kind, call.name, "error");
      ctx.observer.recordActionDuration(this.kind, durationMs, call.name, "error");
      ctx.observer.countToolError(call.name, category);
      ctx.observer.countError(category, call.name);
      ctx.observer.log(
        "error",
        message,
        { action: call.name, category, iteration: ctx.iteration },
        span,
      );
      span.recordException(error, category);
      await ctx.observer.stream(
        "tool.completed",
        { action: call.name, kind: this.kind, ok: false, durationMs, iteration: ctx.iteration },
        span,
      );
      return { result: { ok: false, output: {}, error: message }, executed: true };
    }
  }

  private blocked(
    ctx: ActionExecutionContext,
    span: Span,
    call: ToolCall,
    decision: "deny" | "require_approval",
    category: ErrorCategory,
    reason: string,
  ): { result: ToolResult; executed: boolean } {
    ctx.observer.countAction(this.kind, call.name, category);
    ctx.observer.countError(category, call.name);
    ctx.observer.log(
      "warn",
      reason,
      { action: call.name, category, decision, iteration: ctx.iteration },
      span,
    );
    span.recordException(new Error(reason), category);
    void ctx.observer.stream(
      "tool.blocked",
      { action: call.name, decision, reason, category, iteration: ctx.iteration },
      span,
    );
    return { result: { ok: false, output: {}, error: reason }, executed: false };
  }

  private killed(
    ctx: ActionExecutionContext,
    span: Span,
    call: ToolCall,
    reason: string,
  ): { result: ToolResult; executed: boolean } {
    ctx.observer.countError("killed", call.name);
    ctx.observer.log(
      "warn",
      reason,
      { action: call.name, category: "killed", iteration: ctx.iteration },
      span,
    );
    span.recordException(new Error(reason), "killed");
    return {
      result: {
        ok: false,
        output: {},
        error: `${this.actionLabel} skipped because runtime was killed`,
      },
      executed: false,
    };
  }

  private async requestApproval(
    tool: ToolDefinition,
    call: ToolCall,
    reason: string,
    ctx: ActionExecutionContext,
    span: Span,
  ): Promise<boolean> {
    ctx.observer.countApprovalRequest(call.name);
    span.addEvent("approval.requested", { reason });
    await ctx.observer.stream(
      "tool.approval_requested",
      { action: call.name, reason, iteration: ctx.iteration },
      span,
    );
    if (!this.approvalHandler) {
      return false;
    }
    try {
      const approved = await this.approvalHandler({
        runId: ctx.observer.runId,
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
      span.addEvent("approval.resolved", { approved });
      await ctx.observer.stream(
        "tool.approval_resolved",
        { action: call.name, approved, reason, iteration: ctx.iteration },
        span,
      );
      return approved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval handler failed";
      span.addEvent("approval.resolved", { approved: false, error: message });
      await ctx.observer.stream(
        "tool.approval_resolved",
        {
          action: call.name,
          approved: false,
          reason: `handler error: ${message}`,
          iteration: ctx.iteration,
        },
        span,
      );
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "<unserializable>";
  }
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
