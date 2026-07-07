import { truncate } from "../shared/text";
import { createToolTextPreview } from "./outputArtifacts";
import type { ToolResult } from "./types";

export interface RenderToolResultFeedbackOptions {
  maxCallInputChars?: number;
  maxResultChars?: number;
}

const DEFAULT_CALL_INPUT_CHARS = 300;
const DEFAULT_RESULT_CHARS = 6_000;

export function renderToolResultFeedback(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  results: ToolResult[],
  options: RenderToolResultFeedbackOptions = {},
): string {
  const callLines = calls.map((call, index) => {
    const input = truncate(
      safeJson(call.input),
      options.maxCallInputChars ?? DEFAULT_CALL_INPUT_CHARS,
    );
    return `${index + 1}. ${call.name} input=${input}`;
  });
  const resultLines = results.map((result, index) =>
    renderToolResultLine(result, index + 1, options.maxResultChars ?? DEFAULT_RESULT_CHARS),
  );
  return [
    "Tool execution feedback from the previous step:",
    "Tool calls:",
    ...(callLines.length > 0 ? callLines : ["(none)"]),
    "Tool results:",
    ...(resultLines.length > 0 ? resultLines : ["(none)"]),
    "Use this feedback to decide the next action. If the request is satisfied, return the final answer.",
  ].join("\n");
}

function renderToolResultLine(result: ToolResult, index: number, maxResultChars: number): string {
  if (!result.ok) {
    return `${index}. error=${result.error ?? "unknown error"}`;
  }
  if (looksLikeShellOutput(result.output)) {
    return renderShellResultLine(index, result.output, maxResultChars);
  }
  const serialized = safeJson(result.output);
  const outputText = truncate(serialized, maxResultChars);
  const hints = artifactHints(result.output);
  if (hints.length === 0) {
    return `${index}. output=${outputText}`;
  }
  return `${index}. output=${outputText}\n   retrieve: ${hints.join(" | ")}`;
}

function renderShellResultLine(
  index: number,
  output: Record<string, unknown>,
  maxResultChars: number,
): string {
  const stdout = asOptionalString(output.stdout);
  const stderr = asOptionalString(output.stderr);
  const hasStdout = typeof stdout === "string";
  const hasStderr = typeof stderr === "string";
  const visibleStreams = Number(hasStdout) + Number(hasStderr);
  const streamBudget = Math.max(
    200,
    Math.floor((maxResultChars - 200) / Math.max(1, visibleStreams)),
  );

  const parts: string[] = [];
  if (hasStdout) {
    parts.push(`stdout=${createToolTextPreview(stdout, streamBudget).text}`);
  }
  if (hasStderr && stderr.length > 0) {
    parts.push(`stderr=${createToolTextPreview(stderr, streamBudget).text}`);
  }

  const scalarKeys = ["exitCode", "signal", "timedOut", "truncated", "stdoutTruncated", "stderrTruncated"];
  for (const key of scalarKeys) {
    const value = output[key];
    if (value === undefined) continue;
    parts.push(`${key}=${String(value)}`);
  }

  const baseLine = `${index}. ${parts.join(" | ")}`.trimEnd();
  const hints = artifactHints(output);
  if (hints.length === 0) {
    return truncate(baseLine, maxResultChars);
  }
  return `${truncate(baseLine, maxResultChars)}\n   retrieve: ${hints.join(" | ")}`;
}

function artifactHints(output: Record<string, unknown>): string[] {
  const hints: string[] = [];
  for (const [key, value] of Object.entries(output)) {
    if (!key.toLowerCase().includes("artifact")) continue;
    if (!isRecord(value)) continue;
    const id = asOptionalString(value.id);
    const artifactPath = asOptionalString(value.path);
    if (id) {
      hints.push(`tool_output_read id=${id}`);
      continue;
    }
    if (artifactPath) {
      hints.push(`tool_output_read path=${artifactPath}`);
    }
  }
  return [...new Set(hints)];
}

function looksLikeShellOutput(output: Record<string, unknown>): boolean {
  return (
    "stdout" in output ||
    "stderr" in output ||
    "stdoutArtifact" in output ||
    "stderrArtifact" in output
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
