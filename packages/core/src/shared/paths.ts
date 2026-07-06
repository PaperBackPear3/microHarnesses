import path from "node:path";

/** Resolves a user-supplied path relative to rootDir, rejecting traversal attempts. */
export function safeResolve(rootDir: string, requestedPath: string): string {
  const resolved = path.resolve(rootDir, requestedPath);
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    throw new Error(`Path "${requestedPath}" escapes root "${rootDir}"`);
  }
  return resolved;
}

/** Alias of safeResolve for workspace-scoped tools. */
export function resolveWorkspacePath(rootDir: string, requestedPath: string): string {
  return safeResolve(rootDir, requestedPath);
}

/** Renders an absolute path relative to rootDir, using "." for the root itself. */
export function relativeToRoot(rootDir: string, absolutePath: string): string {
  const relative = path.relative(rootDir, absolutePath);
  return relative.length === 0 ? "." : relative;
}
