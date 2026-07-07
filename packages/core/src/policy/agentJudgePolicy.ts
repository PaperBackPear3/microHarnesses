import type { ModelProfile } from "../model/types";
import type { AgentHandle, RunOptions } from "../runtime/types";
import type { ToolInputAnnotation } from "../tools/types";
import type { PolicyRule, ToolPolicyEvaluation } from "./types";

export interface AgentJudgePolicyOptions {
  judge: AgentHandle;
  profile: ModelProfile;
  modelOverride?: string;
  maxIterations?: number;
  appliesTo?: (toolName: string, call: Record<string, unknown>) => boolean;
  buildPrompt?: (input: {
    toolName: string;
    call: Record<string, unknown>;
    safetyMode?: string;
  }) => string;
  parseVerdict?: (summary: string) => ToolPolicyEvaluation["decision"] | undefined;
}

const HEURISTIC_TOOL_PATTERN = /bash|shell|exec|cmd/i;
const HEURISTIC_COMMAND_FIELDS = ["command", "cmd", "script"] as const;

export function agentJudgePolicy(options: AgentJudgePolicyOptions): PolicyRule {
  const maxIterations = options.maxIterations ?? 2;
  return async (tool, call, context) => {
    const shouldJudge = options.appliesTo
      ? options.appliesTo(tool.name, call.input)
      : hasCommandPayload(tool.name, tool.inputAnnotations, call.input);
    if (!shouldJudge) return undefined;

    const prompt =
      options.buildPrompt?.({
        toolName: tool.name,
        call: call.input,
        safetyMode: context.safetyMode,
      }) ?? defaultJudgePrompt(tool.name, call.input, context.safetyMode);

    const execution: RunOptions = {
      maxIterations,
      snapshotEvery: 1,
      profile: options.profile,
      ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
      goal: `Judge tool call safety for ${tool.name}`,
    };

    try {
      const result = await options.judge.invoke({
        prompt,
        execution,
      });
      const decision = options.parseVerdict?.(result.summary) ?? parseDecision(result.summary);
      if (!decision) {
        return {
          decision: "deny",
          reason: "judge returned an unparseable verdict",
        };
      }
      return {
        decision,
        reason: `agent_judge (${options.judge.promptName}): ${result.summary.trim()}`,
      };
    } catch (error) {
      return {
        decision: "deny",
        reason: `agent_judge failed closed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

function defaultJudgePrompt(
  toolName: string,
  call: Record<string, unknown>,
  safetyMode?: string,
): string {
  return [
    "You are a safety judge for tool execution.",
    "Return your verdict in the first token: allow, deny, or require_approval.",
    "Then provide one concise reason.",
    `safety_mode: ${safetyMode ?? "balanced"}`,
    `tool_name: ${toolName}`,
    `tool_input_json: ${JSON.stringify(call)}`,
  ].join("\n");
}

function parseDecision(summary: string): ToolPolicyEvaluation["decision"] | undefined {
  const normalized = summary.trim().toLowerCase();
  if (normalized.startsWith("deny")) return "deny";
  if (normalized.startsWith("allow")) return "allow";
  if (normalized.startsWith("require_approval")) return "require_approval";
  if (normalized.startsWith("require approval")) return "require_approval";
  return undefined;
}

function hasCommandPayload(
  toolName: string,
  annotations: ToolInputAnnotation[] | undefined,
  input: Record<string, unknown>,
): boolean {
  const effective =
    annotations && annotations.length > 0 ? annotations : inferAnnotations(toolName, input);
  for (const annotation of effective) {
    if (annotation.kind !== "shell_command") continue;
    const value = readField(input, annotation.field);
    if (typeof value === "string" && value.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function inferAnnotations(toolName: string, input: Record<string, unknown>): ToolInputAnnotation[] {
  if (!HEURISTIC_TOOL_PATTERN.test(toolName)) return [];
  const annotations: ToolInputAnnotation[] = [];
  for (const field of HEURISTIC_COMMAND_FIELDS) {
    if (typeof input[field] === "string") {
      annotations.push({ field, kind: "shell_command" });
    }
  }
  return annotations;
}

function readField(input: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let cursor: unknown = input;
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
