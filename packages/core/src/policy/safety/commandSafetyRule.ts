import type { ToolInputAnnotation, ToolInputAnnotationKind } from "../../tools/types";
import type { PolicyRule, SafetyMode, ToolPolicyEvaluation } from "../types";
import { normalizeCommand } from "./commandNormalizer";
import {
  type CommandPatternRule,
  DEFAULT_COMMAND_RULES,
  DEFAULT_PATH_RULES,
  type PathPatternRule,
  type Severity,
} from "./defaultRules";

export interface CommandSafetyRuleOptions {
  /** Additional patterns to apply on top of DEFAULT_COMMAND_RULES. */
  extraCommandRules?: CommandPatternRule[];
  /** Additional path patterns to apply on top of DEFAULT_PATH_RULES. */
  extraPathRules?: PathPatternRule[];
  /**
   * If true (default), tools whose name matches `/bash|shell|exec|cmd/i`
   * and have no annotations are heuristically treated as if their `command`
   * / `cmd` / `script` field were annotated `shell_command`.
   */
  useHeuristicFallback?: boolean;
}

/**
 * Composable policy rule that screens tool inputs for dangerous shell
 * commands and file paths. Consumes `ToolDefinition.inputAnnotations` when
 * present; falls back to a name+field heuristic otherwise (see options).
 *
 * Not a sandbox — screening only. See `defaultRules.ts` for the (deliberately
 * non-exhaustive) starter ruleset.
 */
export function createCommandSafetyRule(options: CommandSafetyRuleOptions = {}): PolicyRule {
  const commandRules = [...DEFAULT_COMMAND_RULES, ...(options.extraCommandRules ?? [])];
  const pathRules = [...DEFAULT_PATH_RULES, ...(options.extraPathRules ?? [])];
  const useHeuristic = options.useHeuristicFallback ?? true;

  return (tool, call, context) => {
    const annotations =
      tool.inputAnnotations && tool.inputAnnotations.length > 0
        ? tool.inputAnnotations
        : useHeuristic
          ? inferAnnotations(tool.name, call.input)
          : [];

    if (annotations.length === 0) {
      return undefined;
    }

    const findings: Finding[] = [];

    for (const annotation of annotations) {
      const value = readField(call.input, annotation.field);
      if (typeof value !== "string" || value.length === 0) continue;

      if (annotation.kind === "shell_command") {
        for (const segment of normalizeCommand(value)) {
          for (const rule of commandRules) {
            if (rule.test(segment)) {
              findings.push({
                severity: rule.severity,
                reason: `${rule.description} (rule=${rule.id}, field=${annotation.field})`,
              });
            }
          }
        }
      } else if (annotation.kind === "file_path") {
        for (const rule of pathRules) {
          if (rule.test(value)) {
            findings.push({
              severity: rule.severity,
              reason: `${rule.description} (rule=${rule.id}, field=${annotation.field})`,
            });
          }
        }
      }
    }

    if (findings.length === 0) {
      return undefined;
    }

    const highest = findings.reduce((worst, current) =>
      SEVERITY_ORDER[current.severity] > SEVERITY_ORDER[worst.severity] ? current : worst,
    );
    return {
      decision: decisionFor(highest.severity, context.safetyMode ?? "balanced"),
      reason: findings.map((f) => f.reason).join("; "),
    };
  };
}

interface Finding {
  severity: Severity;
  reason: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { medium: 1, high: 2, critical: 3 };

function decisionFor(severity: Severity, mode: SafetyMode): ToolPolicyEvaluation["decision"] {
  if (severity === "critical") {
    return mode === "open" ? "require_approval" : "deny";
  }
  if (severity === "high") {
    return mode === "strict" ? "deny" : "require_approval";
  }
  // medium
  return mode === "open" ? "allow" : "require_approval";
}

const HEURISTIC_TOOL_PATTERN = /bash|shell|exec|cmd/i;
const HEURISTIC_COMMAND_FIELDS = ["command", "cmd", "script"] as const;

function inferAnnotations(toolName: string, input: Record<string, unknown>): ToolInputAnnotation[] {
  if (!HEURISTIC_TOOL_PATTERN.test(toolName)) return [];
  const annotations: ToolInputAnnotation[] = [];
  for (const field of HEURISTIC_COMMAND_FIELDS) {
    if (typeof input[field] === "string") {
      annotations.push({ field, kind: "shell_command" satisfies ToolInputAnnotationKind });
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
