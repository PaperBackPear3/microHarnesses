import { MetricNames } from "../observability/metricNames";
import type {
  Attributes,
  Counter,
  ErrorCategory,
  Histogram,
  LogLevel,
  ObservabilityProvider,
  Span,
  StreamEvent,
  StreamEventType,
  TraceContext,
  UpDownCounter,
} from "../observability/types";

export interface RunObserverBinding {
  runId: string;
  sessionId?: string;
  rootSessionId?: string;
  depth?: number;
  /** Parent span context, when this run is a spawned subagent (trace linking). */
  parentTrace?: TraceContext;
}

type ActionKind = "tool" | "skill";
type RunStatus = "ok" | "error" | "limit_reached";

/**
 * Owns all observability for a single run: the run/iteration/model/action span
 * tree, the metric instruments, structured logs, and the latency-sensitive live
 * stream. Replaces the old RunEmitter/EventSink so the runtime speaks one
 * observability vocabulary (traces + metrics + logs + stream).
 */
export class RunObserver {
  readonly runId: string;
  readonly sessionId?: string;
  readonly provider: ObservabilityProvider;
  readonly runSpan: Span;

  private readonly binding: RunObserverBinding;
  private readonly m: {
    runs: Counter;
    iterations: Counter;
    runDuration: Histogram;
    modelCalls: Counter;
    modelCallDuration: Histogram;
    modelTokens: Counter;
    modelReasoningChars: Counter;
    modelStreamChars: Counter;
    toolCalls: Counter;
    toolCallDuration: Histogram;
    toolErrors: Counter;
    skillCalls: Counter;
    skillCallDuration: Histogram;
    policyDecisions: Counter;
    approvalRequests: Counter;
    approvalDenied: Counter;
    contextTurnsTotal: UpDownCounter;
    contextTurnsWorking: UpDownCounter;
    contextTurnsOverflow: UpDownCounter;
    contextCompression: Counter;
    contextUsedTokens: UpDownCounter;
    contextFreeTokens: UpDownCounter;
    contextMaxTokens: UpDownCounter;
    contextUtilization: UpDownCounter;
    limitReached: Counter;
    errors: Counter;
  };

  constructor(
    provider: ObservabilityProvider,
    binding: RunObserverBinding,
    runAttributes?: Attributes,
  ) {
    this.provider = provider;
    this.binding = binding;
    this.runId = binding.runId;
    this.sessionId = binding.sessionId;

    const meter = provider.meter;
    this.m = {
      runs: meter.createCounter(MetricNames.agentRuns),
      iterations: meter.createCounter(MetricNames.agentIterations),
      runDuration: meter.createHistogram(MetricNames.agentRunDuration, { unit: "ms" }),
      modelCalls: meter.createCounter(MetricNames.modelCalls),
      modelCallDuration: meter.createHistogram(MetricNames.modelCallDuration, { unit: "ms" }),
      modelTokens: meter.createCounter(MetricNames.modelTokens, { unit: "token" }),
      modelReasoningChars: meter.createCounter(MetricNames.modelReasoningChars, { unit: "char" }),
      modelStreamChars: meter.createCounter(MetricNames.modelStreamChars, { unit: "char" }),
      toolCalls: meter.createCounter(MetricNames.toolCalls),
      toolCallDuration: meter.createHistogram(MetricNames.toolCallDuration, { unit: "ms" }),
      toolErrors: meter.createCounter(MetricNames.toolErrors),
      skillCalls: meter.createCounter(MetricNames.skillCalls),
      skillCallDuration: meter.createHistogram(MetricNames.skillCallDuration, { unit: "ms" }),
      policyDecisions: meter.createCounter(MetricNames.policyDecisions),
      approvalRequests: meter.createCounter(MetricNames.approvalRequests),
      approvalDenied: meter.createCounter(MetricNames.approvalDenied),
      contextTurnsTotal: meter.createUpDownCounter(MetricNames.contextTurnsTotal),
      contextTurnsWorking: meter.createUpDownCounter(MetricNames.contextTurnsWorking),
      contextTurnsOverflow: meter.createUpDownCounter(MetricNames.contextTurnsOverflow),
      contextCompression: meter.createCounter(MetricNames.contextCompressionCount),
      contextUsedTokens: meter.createUpDownCounter(MetricNames.contextWindowUsedTokens, {
        unit: "token",
      }),
      contextFreeTokens: meter.createUpDownCounter(MetricNames.contextWindowFreeTokens, {
        unit: "token",
      }),
      contextMaxTokens: meter.createUpDownCounter(MetricNames.contextWindowMaxTokens, {
        unit: "token",
      }),
      contextUtilization: meter.createUpDownCounter(MetricNames.contextWindowUtilization),
      limitReached: meter.createCounter(MetricNames.runtimeLimitReached),
      errors: meter.createCounter(MetricNames.errors),
    };

    this.runSpan = provider.tracer.startSpan("agent.run", {
      kind: "run",
      ...(binding.parentTrace ? { parent: binding.parentTrace } : {}),
      attributes: {
        "run.id": binding.runId,
        ...(binding.sessionId ? { "session.id": binding.sessionId } : {}),
        ...(binding.rootSessionId ? { "session.root_id": binding.rootSessionId } : {}),
        ...(typeof binding.depth === "number" ? { "session.depth": binding.depth } : {}),
        ...(runAttributes ?? {}),
      },
    });
  }

  // -- content/meta redaction passthroughs -------------------------------------
  meta(attributes: Attributes): Attributes {
    return this.provider.redact(attributes, false);
  }
  content(attributes: Attributes): Attributes {
    return this.provider.redact(attributes, true);
  }

  // -- span factories ----------------------------------------------------------
  startIteration(iteration: number, attributes?: Attributes): Span {
    return this.provider.tracer.startSpan("agent.iteration", {
      kind: "iteration",
      parent: this.runSpan,
      attributes: { iteration, ...(attributes ?? {}) },
    });
  }
  startModel(parent: Span, attributes?: Attributes): Span {
    return this.provider.tracer.startSpan("model.step", {
      kind: "model",
      parent,
      attributes: attributes ?? {},
    });
  }
  startContext(parent: Span, attributes?: Attributes): Span {
    return this.provider.tracer.startSpan("context.build", {
      kind: "context",
      parent,
      attributes: attributes ?? {},
    });
  }
  startAction(kind: ActionKind, name: string, parent: Span, attributes?: Attributes): Span {
    return this.provider.tracer.startSpan(`${kind}.${name}`, {
      kind,
      parent,
      attributes: { [`${kind}.name`]: name, ...(attributes ?? {}) },
    });
  }

  // -- run/iteration metrics ---------------------------------------------------
  countRun(status: RunStatus): void {
    this.m.runs.add(1, { status });
  }
  recordRunDuration(ms: number, status: RunStatus): void {
    this.m.runDuration.record(ms, { status });
  }
  countIteration(attributes?: Attributes): void {
    this.m.iterations.add(1, attributes ?? {});
  }

  // -- model metrics -----------------------------------------------------------
  countModelCall(model: string, status: "ok" | "error"): void {
    this.m.modelCalls.add(1, { model, status });
  }
  recordModelDuration(ms: number, model: string): void {
    this.m.modelCallDuration.record(ms, { model });
  }
  countModelTokens(model: string, inputTokens?: number, outputTokens?: number): void {
    if (typeof inputTokens === "number") {
      this.m.modelTokens.add(inputTokens, { model, direction: "input" });
    }
    if (typeof outputTokens === "number") {
      this.m.modelTokens.add(outputTokens, { model, direction: "output" });
    }
  }
  countReasoningChars(chars: number): void {
    if (chars > 0) this.m.modelReasoningChars.add(chars);
  }
  countStreamChars(chars: number): void {
    if (chars > 0) this.m.modelStreamChars.add(chars);
  }

  // -- action metrics ----------------------------------------------------------
  countAction(kind: ActionKind, name: string, outcome: string): void {
    const counter = kind === "skill" ? this.m.skillCalls : this.m.toolCalls;
    counter.add(1, { [`${kind}.name`]: name, outcome });
  }
  recordActionDuration(kind: ActionKind, ms: number, name: string, outcome: string): void {
    const hist = kind === "skill" ? this.m.skillCallDuration : this.m.toolCallDuration;
    hist.record(ms, { [`${kind}.name`]: name, outcome });
  }
  countToolError(name: string, category: ErrorCategory): void {
    this.m.toolErrors.add(1, { "tool.name": name, category });
  }
  countPolicyDecision(decision: string, action: string): void {
    this.m.policyDecisions.add(1, { decision, action });
  }
  countApprovalRequest(action: string): void {
    this.m.approvalRequests.add(1, { action });
  }
  countApprovalDenied(action: string): void {
    this.m.approvalDenied.add(1, { action });
  }
  countLimitReached(action: string): void {
    this.m.limitReached.add(1, { action });
  }
  countError(category: ErrorCategory, action?: string): void {
    this.m.errors.add(1, { category, ...(action ? { action } : {}) });
  }

  // -- context metrics ---------------------------------------------------------
  recordContext(metrics: {
    totalTurns: number;
    workingTurns: number;
    overflowTurns: number;
    compressed: boolean;
    usedTokens: number;
    maxTokens: number;
    utilization: number;
  }): void {
    this.m.contextTurnsTotal.record(metrics.totalTurns);
    this.m.contextTurnsWorking.record(metrics.workingTurns);
    this.m.contextTurnsOverflow.record(metrics.overflowTurns);
    if (metrics.compressed) this.m.contextCompression.add(1);
    this.m.contextUsedTokens.record(metrics.usedTokens);
    this.m.contextFreeTokens.record(Math.max(0, metrics.maxTokens - metrics.usedTokens));
    this.m.contextMaxTokens.record(metrics.maxTokens);
    this.m.contextUtilization.record(metrics.utilization);
  }

  // -- logs --------------------------------------------------------------------
  log(level: LogLevel, message: string, attributes?: Attributes, span?: Span): void {
    this.provider.logger.log({
      level,
      message,
      ...(attributes ? { attributes: this.meta(attributes) } : {}),
      traceContext: (span ?? this.runSpan).context,
    });
  }

  // -- live stream -------------------------------------------------------------
  async stream(
    type: StreamEventType,
    payload: Record<string, unknown>,
    span?: Span,
  ): Promise<void> {
    const sink = this.provider.stream;
    if (!sink) return;
    const context = (span ?? this.runSpan).context;
    const event: StreamEvent = {
      type,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      traceId: context.traceId,
      spanId: context.spanId,
      payload,
    };
    await sink.push(event);
  }
}
