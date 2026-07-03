/**
 * Best-effort normalization for shell command strings. Defeats trivial
 * bypasses (backslash / quote splices, mixed segment separators) so that a
 * downstream matcher can screen against literal patterns.
 *
 * This is NOT a sandbox. Do not rely on it as a security boundary — use it
 * only as one layer of a defense-in-depth strategy.
 */

/** Strips backslash and quote splicing (`s\udo`, `"su"do`, `'su'do`). */
export function stripBypassChars(command: string): string {
  return command.replace(/\\(?!n|r|t|0)/g, "").replace(/["']/g, "");
}

/** Collapses runs of whitespace into single spaces and trims. */
export function normalizeWhitespace(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

/**
 * Segments a compound command on shell control operators. Returns the
 * individual commands (each already normalized). Handles: `;`, `&&`, `||`,
 * `|`, `&` (background), `$( … )`, and backtick command substitution.
 */
export function splitCommandSegments(command: string): string[] {
  const normalized = normalizeWhitespace(command);
  const substitutionsExtracted: string[] = [];

  // Extract $(...) and `...` substitutions as separate segments.
  const withoutSubs = normalized
    .replace(/\$\(([^()]+)\)/g, (_match, inner: string) => {
      substitutionsExtracted.push(inner);
      return "";
    })
    .replace(/`([^`]+)`/g, (_match, inner: string) => {
      substitutionsExtracted.push(inner);
      return "";
    });

  const segments = withoutSubs
    .split(/&&|\|\||;|\||&/g)
    .map((segment) => normalizeWhitespace(segment))
    .filter((segment) => segment.length > 0);

  return [...segments, ...substitutionsExtracted.map((sub) => normalizeWhitespace(sub))];
}

/**
 * Full pipeline: strips bypass chars, then segments. Returns an array of
 * canonical (whitespace-collapsed) sub-commands.
 */
export function normalizeCommand(command: string): string[] {
  const stripped = stripBypassChars(command);
  return splitCommandSegments(stripped);
}
