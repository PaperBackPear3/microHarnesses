import path from "node:path";

export interface BasicToolsPluginOptions {
  rootDir?: string;
  maxReadChars?: number;
  maxListEntries?: number;
  maxTraversalDepth?: number;
  maxSearchFiles?: number;
  maxSearchMatches?: number;
  defaultShellTimeoutMs?: number;
  maxShellTimeoutMs?: number;
  maxShellOutputChars?: number;
}

export interface BasicToolsResolvedOptions {
  rootDir: string;
  maxReadChars: number;
  maxListEntries: number;
  maxTraversalDepth: number;
  maxSearchFiles: number;
  maxSearchMatches: number;
  defaultShellTimeoutMs: number;
  maxShellTimeoutMs: number;
  maxShellOutputChars: number;
}

const DEFAULTS = {
  maxReadChars: 100_000,
  maxListEntries: 1_000,
  maxTraversalDepth: 8,
  maxSearchFiles: 300,
  maxSearchMatches: 300,
  defaultShellTimeoutMs: 20_000,
  maxShellTimeoutMs: 120_000,
  maxShellOutputChars: 80_000,
} as const;

export function resolveOptions(options: BasicToolsPluginOptions = {}): BasicToolsResolvedOptions {
  return {
    rootDir: path.resolve(options.rootDir ?? process.cwd()),
    maxReadChars: clampInt(options.maxReadChars, 1_000, 2_000_000, DEFAULTS.maxReadChars),
    maxListEntries: clampInt(options.maxListEntries, 1, 10_000, DEFAULTS.maxListEntries),
    maxTraversalDepth: clampInt(options.maxTraversalDepth, 0, 64, DEFAULTS.maxTraversalDepth),
    maxSearchFiles: clampInt(options.maxSearchFiles, 1, 10_000, DEFAULTS.maxSearchFiles),
    maxSearchMatches: clampInt(options.maxSearchMatches, 1, 10_000, DEFAULTS.maxSearchMatches),
    defaultShellTimeoutMs: clampInt(
      options.defaultShellTimeoutMs,
      500,
      300_000,
      DEFAULTS.defaultShellTimeoutMs,
    ),
    maxShellTimeoutMs: clampInt(
      options.maxShellTimeoutMs,
      500,
      600_000,
      DEFAULTS.maxShellTimeoutMs,
    ),
    maxShellOutputChars: clampInt(
      options.maxShellOutputChars,
      1_000,
      2_000_000,
      DEFAULTS.maxShellOutputChars,
    ),
  };
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
