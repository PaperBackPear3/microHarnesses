/**
 * Shared helpers for parsing loosely-typed tool/skill input records.
 * Used by core default tools and reusable by plugins.
 */

/** Reads a required non-empty string field, throwing a tool-scoped error otherwise. */
export function readRequiredString(
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

/** Reads a required string field that may be empty (e.g. file contents). */
export function readRequiredText(
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

/** Reads an optional string field, returning fallback when missing or blank. */
export function readOptionalString(
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

/** Reads an optional boolean field, returning fallback when missing or mistyped. */
export function readOptionalBoolean(
  input: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

/** Reads an optional integer field, clamped to [min, max], returning fallback when non-finite. */
export function readOptionalInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return clampNumber(input[key], min, max, fallback);
}

/** Clamps a numeric value to [min, max], falling back when the value is non-finite. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/** Normalises a string or array value into a trimmed, non-empty string array. */
export function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}
