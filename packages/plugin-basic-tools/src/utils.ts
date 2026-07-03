import { readFile } from "node:fs/promises";
import path from "node:path";
import { safeResolve, truncate } from "@micro-harness/core";

export function resolveWorkspacePath(rootDir: string, requestedPath: string): string {
  return safeResolve(rootDir, requestedPath);
}

export function relativeToRoot(rootDir: string, absolutePath: string): string {
  const relative = path.relative(rootDir, absolutePath);
  return relative.length === 0 ? "." : relative;
}

export async function readTextFileCapped(
  filePath: string,
  maxChars: number,
): Promise<{ text: string; truncated: boolean }> {
  const raw = await readFile(filePath, "utf8");
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false };
  }
  return { text: raw.slice(0, maxChars), truncated: true };
}

export function parseRequiredString(
  input: Record<string, unknown>,
  key: string,
  toolName: string,
): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName}: "${key}" must be a non-empty string`);
  }
  return value;
}

export function parseRequiredText(
  input: Record<string, unknown>,
  key: string,
  toolName: string,
): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`${toolName}: "${key}" must be a string`);
  }
  return value;
}

export function parseOptionalString(
  input: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

export function parseOptionalBoolean(
  input: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = input[key];
  if (typeof value !== "boolean") {
    return fallback;
  }
  return value;
}

export function parseOptionalInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(input[key]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  return Math.min(max, Math.max(min, parsed));
}

export function safeSnippet(line: string, maxChars: number): string {
  return truncate(line, maxChars);
}
