type ParseMode = "throw" | "ignore";

interface ParseOptions {
  mode: ParseMode;
  flag?: string;
}

export const IGNORE_INVALID_PARSE: ParseOptions = { mode: "ignore" };

export function throwOnInvalid(flag: string): ParseOptions {
  return { mode: "throw", flag };
}

export function parsePositiveInteger(
  raw: string | undefined,
  options: ParseOptions,
): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return invalid(options, "must be a positive integer");
  }
  return parsed;
}

export function parseIterationLimit(
  raw: string | undefined,
  options: ParseOptions,
): number | "unlimited" | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  if (raw.trim().toLowerCase() === "unlimited") return "unlimited";
  return parsePositiveInteger(raw, options);
}

export function parseRatio(raw: string | undefined, options: ParseOptions): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return invalid(options, "must be a number between 0 and 1");
  }
  return parsed;
}

function invalid(options: ParseOptions, requirement: string): undefined {
  if (options.mode === "ignore") {
    return undefined;
  }
  throw new Error(`${options.flag ?? "value"} ${requirement}`);
}
