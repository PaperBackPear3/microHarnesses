import path from "node:path";
import { safeResolve } from "@micro-harnesses/core";

export function resolveWorkspacePath(rootDir: string, requestedPath: string): string {
  return safeResolve(rootDir, requestedPath);
}

export function relativeToRoot(rootDir: string, absolutePath: string): string {
  const relative = path.relative(rootDir, absolutePath);
  return relative.length === 0 ? "." : relative;
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
