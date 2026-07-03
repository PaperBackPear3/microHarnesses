import path from "node:path";
import type {
  HarnessPlugin,
  PluginApi,
  PluginCapability,
  ToolDefinition,
} from "@micro-harness/core";
import { clampNumber, listFiles, readTextFileSafely, safeResolve, truncate } from "../utils";

export interface ExplorerPluginOptions {
  /** Root directory that exploration is restricted to. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Maximum number of matching files to include in a single result. Default: 25. */
  maxExploreFiles?: number;
  /** Maximum directory depth to traverse. Default: 5. */
  maxDepth?: number;
  /** Maximum length of each matched line snippet. Default: 220. */
  maxSnippetLength?: number;
}

export class ExplorerPlugin implements HarnessPlugin {
  readonly name = "explorer-plugin";
  readonly capabilities: PluginCapability[] = ["tools"];
  private readonly rootDir: string;
  private readonly maxExploreFiles: number;
  private readonly maxDepth: number;
  private readonly maxSnippetLength: number;

  constructor(options: ExplorerPluginOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.maxExploreFiles = options.maxExploreFiles ?? 25;
    this.maxDepth = options.maxDepth ?? 5;
    this.maxSnippetLength = options.maxSnippetLength ?? 220;
  }

  register(api: PluginApi): void {
    api.registerTool(this.exploreAgentTool());
  }

  private exploreAgentTool(): ToolDefinition {
    const { rootDir, maxExploreFiles, maxDepth, maxSnippetLength } = this;

    return {
      name: "explore_agent",
      description:
        "Read-only explorer that searches file names and content snippets under a root directory.",
      risk: "low",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Required text to search for inside file contents.",
          },
          root_path: {
            type: "string",
            description: "Optional path (relative to plugin root) to narrow exploration scope.",
          },
          root_directory: {
            type: "string",
            description:
              "Alias for root_path. Supported for compatibility with OpenAI/Ollama prompts.",
          },
          max_files: {
            type: "number",
            description: "Optional cap on result files. Clamped to plugin limits.",
          },
          max_depth: {
            type: "number",
            description: "Optional traversal depth. Clamped to plugin limits.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(input) {
        const query = String(input.query ?? "").trim();
        if (!query) throw new Error("explore_agent requires 'query'");

        const requestedRoot = String(input.root_path ?? input.root_directory ?? "").trim();
        const absoluteRoot = requestedRoot ? safeResolve(rootDir, requestedRoot) : rootDir;
        const maxFiles = clampNumber(input.max_files, 1, maxExploreFiles, 8);
        const depth = clampNumber(input.max_depth, 1, maxDepth, 4);

        const files = await listFiles(absoluteRoot, depth, maxFiles * 4);
        const results = [];
        const inventory: Array<{ file: string; matches: Array<{ line: number; snippet: string }> }> =
          [];
        const queryLower = query.toLowerCase();

        for (const filePath of files) {
          if (results.length >= maxFiles && inventory.length >= maxFiles) break;
          const raw = await readTextFileSafely(filePath);
          if (!raw) continue;
          const relativePath = path.relative(absoluteRoot, filePath);

          if (inventory.length < maxFiles) {
            inventory.push({
              file: relativePath,
              matches: [firstLineSnippet(raw, maxSnippetLength)],
            });
          }

          const matches = raw
            .split(/\r?\n/)
            .map((line, index) => ({ index: index + 1, line }))
            .filter((entry) => entry.line.toLowerCase().includes(queryLower))
            .slice(0, 4);

          const filenameMatches = relativePath.toLowerCase().includes(queryLower);
          if (matches.length === 0 && !filenameMatches) continue;

          const effectiveMatches =
            matches.length > 0
              ? matches
              : [{ index: 0, line: `filename match: ${relativePath}` }];

          results.push({
            file: relativePath,
            matches: effectiveMatches.map((entry) => ({
              line: entry.index,
              snippet: truncate(entry.line, maxSnippetLength),
            })),
          });
        }

        const outputResults = results.length > 0 ? results : inventory;
        const fallbackUsed = results.length === 0;

        return {
          mode: "explore",
          read_only: true,
          query,
          root_path: requestedRoot || ".",
          fallback: fallbackUsed ? "inventory" : "match",
          total_results: outputResults.length,
          results: outputResults,
        };
      },
    };
  }
}

function firstLineSnippet(raw: string, maxSnippetLength: number): { line: number; snippet: string } {
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    return {
      line: index + 1,
      snippet: truncate(line, maxSnippetLength),
    };
  }
  return { line: 1, snippet: "" };
}
