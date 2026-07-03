import path from "node:path";

/** Resolves a user-supplied path relative to rootDir, rejecting traversal attempts. */
export function safeResolve(rootDir: string, requestedPath: string): string {
  const resolved = path.resolve(rootDir, requestedPath);
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    throw new Error(`Path "${requestedPath}" escapes root "${rootDir}"`);
  }
  return resolved;
}
