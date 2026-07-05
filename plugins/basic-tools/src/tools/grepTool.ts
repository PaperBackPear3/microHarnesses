import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@micro-harness/core";
import type { BasicToolsResolvedOptions } from "../options";
import {
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalString,
  parseRequiredString,
  relativeToRoot,
  resolveWorkspacePath,
  safeSnippet,
} from "../utils";

interface SearchQueueEntry {
  absolutePath: string;
  depth: number;
}

export function createGrepTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "grep_search",
    description: "Search text content under a workspace path using literal or regex matching.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search for." },
        root_path: {
          type: "string",
          description: "Workspace-relative root path (file or directory).",
        },
        is_regex: { type: "boolean", description: "Treat query as a regex pattern." },
        case_sensitive: { type: "boolean", description: "Case-sensitive matching." },
        max_files: { type: "number", description: "Maximum files to scan." },
        max_matches: { type: "number", description: "Maximum matches to return." },
        max_depth: { type: "number", description: "Maximum directory traversal depth." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "root_path", kind: "file_path" }],
    async execute(input) {
      const query = parseRequiredString(input, "query", "grep_search");
      const requestedRoot = parseOptionalString(input, "root_path", ".");
      const isRegex = parseOptionalBoolean(input, "is_regex", false);
      const caseSensitive = parseOptionalBoolean(input, "case_sensitive", false);
      const maxFiles = parseOptionalInteger(
        input,
        "max_files",
        options.maxSearchFiles,
        1,
        options.maxSearchFiles,
      );
      const maxMatches = parseOptionalInteger(
        input,
        "max_matches",
        options.maxSearchMatches,
        1,
        options.maxSearchMatches,
      );
      const maxDepth = parseOptionalInteger(
        input,
        "max_depth",
        options.maxTraversalDepth,
        0,
        options.maxTraversalDepth,
      );

      const root = resolveWorkspacePath(options.rootDir, requestedRoot);
      const rootInfo = await stat(root);
      const files = rootInfo.isFile() ? [root] : await collectFiles(root, maxDepth, maxFiles);

      const matcher = buildMatcher(query, isRegex, caseSensitive);
      const matches: Array<{ file: string; line: number; snippet: string }> = [];
      let scannedFiles = 0;
      let matchedFiles = 0;

      for (const filePath of files) {
        if (matches.length >= maxMatches) break;
        const fileMatches = await findMatchesInFile(
          filePath,
          matcher,
          maxMatches - matches.length,
          options.maxReadChars,
        );
        scannedFiles += 1;
        if (fileMatches.length > 0) {
          matchedFiles += 1;
          for (const match of fileMatches) {
            matches.push({
              file: relativeToRoot(options.rootDir, filePath),
              line: match.line,
              snippet: safeSnippet(match.snippet, 240),
            });
            if (matches.length >= maxMatches) break;
          }
        }
      }

      return {
        query,
        isRegex,
        caseSensitive,
        root: relativeToRoot(options.rootDir, root),
        scannedFiles,
        matchedFiles,
        totalMatches: matches.length,
        truncated: matches.length >= maxMatches,
        matches,
      };
    },
  };
}

async function collectFiles(root: string, maxDepth: number, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const queue: SearchQueueEntry[] = [{ absolutePath: root, depth: 0 }];

  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift() as SearchQueueEntry;
    const entries = await readdir(current.absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          queue.push({ absolutePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(absolutePath);
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out;
}

function buildMatcher(
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): (line: string) => boolean {
  if (!isRegex) {
    const expected = caseSensitive ? query : query.toLowerCase();
    return (line) => (caseSensitive ? line : line.toLowerCase()).includes(expected);
  }
  const flags = caseSensitive ? "" : "i";
  const regex = new RegExp(query, flags);
  return (line) => regex.test(line);
}

async function findMatchesInFile(
  filePath: string,
  matcher: (line: string) => boolean,
  maxMatches: number,
  maxReadChars: number,
): Promise<Array<{ line: number; snippet: string }>> {
  const content = await readFile(filePath, "utf8");
  const sliced = content.length > maxReadChars ? content.slice(0, maxReadChars) : content;
  const lines = sliced.split(/\r?\n/);
  const matches: Array<{ line: number; snippet: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!matcher(line)) continue;
    matches.push({ line: index + 1, snippet: line });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}
