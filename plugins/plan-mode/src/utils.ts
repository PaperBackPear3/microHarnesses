import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export { safeResolve, truncate } from "@micro-harnesses/core";

/** Recursively lists files under root up to maxDepth, capped at maxFiles entries. */
export async function listFiles(
  root: string,
  maxDepth: number,
  maxFiles: number,
): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift()!;
    const entries = await readdir(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth + 1 <= maxDepth) {
          queue.push({ dir: absolute, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(absolute);
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out;
}

/** Reads a text file safely, returning undefined on error and capping at 200 KB. */
export async function readTextFileSafely(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.length > 200_000 ? raw.slice(0, 200_000) : raw;
  } catch {
    return undefined;
  }
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

/** Clamps a numeric value, falling back to fallback when the value is non-finite. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
