/**
 * Centralized metric names so instruments, exporters, and dashboards agree.
 * Names follow a dotted, lowercase convention compatible with OpenTelemetry.
 */
export const MetricNames = {
  agentRuns: "agent.runs",
  agentIterations: "agent.iterations",
  agentRunDuration: "agent.run.duration",

  modelCalls: "model.calls",
  modelCallDuration: "model.call.duration",
  modelTokens: "model.tokens",
  modelReasoningChars: "model.reasoning.chars",
  modelStreamChars: "model.stream.chars",

  toolCalls: "tool.calls",
  toolCallDuration: "tool.call.duration",
  toolErrors: "tool.errors",

  skillCalls: "skill.calls",
  skillCallDuration: "skill.call.duration",

  policyDecisions: "policy.decisions",
  approvalRequests: "approval.requests",
  approvalDenied: "approval.denied",

  contextTurnsTotal: "context.turns.total",
  contextTurnsWorking: "context.turns.working",
  contextTurnsOverflow: "context.turns.overflow",
  contextCompressionCount: "context.compression.count",
  contextWindowUsedTokens: "context.window.used_tokens",
  contextWindowFreeTokens: "context.window.free_tokens",
  contextWindowMaxTokens: "context.window.max_tokens",
  contextWindowUtilization: "context.window.utilization",

  runtimeLimitReached: "runtime.limit_reached",
  errors: "errors",
} as const;

export type MetricName = (typeof MetricNames)[keyof typeof MetricNames];
