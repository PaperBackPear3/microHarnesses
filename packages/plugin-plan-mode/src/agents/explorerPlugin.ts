import path from "node:path";
import { HarnessPlugin, PluginApi, ToolDefinition } from "@micro-harness/core";
import {
  clampNumber,
  listFiles,
  readTextFileSafely,
  safeResolve,
  truncate
} from "../utils";

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
      description: "Read-only explorer that searches file names and content snippets under a root directory.",
      risk: "low",
      async execute(input) {
        const query = String(input.query ?? "").trim();
        if (!query) throw new Error("explore_agent requires 'query'");

        const requestedRoot = String(input.root_path ?? "").trim();
        const absoluteRoot = requestedRoot ? safeResolve(rootDir, requestedRoot) : rootDir;
        const maxFiles = clampNumber(input.max_files, 1, maxExploreFiles, 8);
        const depth = clampNumber(input.max_depth, 1, maxDepth, 4);

        const files = await listFiles(absoluteRoot, depth, maxFiles * 4);
        const results = [];
        const queryLower = query.toLowerCase();

        for (const filePath of files) {
          if (results.length >= maxFiles) break;
          const raw = await readTextFileSafely(filePath);
          if (!raw) continue;

          const matches = raw
            .split(/\r?\n/)
            .map((line, index) => ({ index: index + 1, line }))
            .filter((entry) => entry.line.toLowerCase().includes(queryLower))
            .slice(0, 4);

          if (matches.length === 0) continue;

          results.push({
            file: path.relative(absoluteRoot, filePath),
            matches: matches.map((entry) => ({
              line: entry.index,
              snippet: truncate(entry.line, maxSnippetLength)
            }))
          });
        }

        return {
          mode: "explore",
          read_only: true,
          query,
          root_path: requestedRoot || ".",
          total_results: results.length,
          results
        };
      }
    };
  }
}
