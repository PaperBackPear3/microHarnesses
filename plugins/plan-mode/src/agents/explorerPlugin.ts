import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  HarnessPlugin,
  PluginApi,
  PluginCapability,
  ToolDefinition,
} from "@micro-harnesses/core";
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
            description:
              "Optional text to search for in file contents and filenames. When omitted, returns inventory.",
          },
          targets: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of file/directory paths (relative to plugin root) to explore in one call.",
          },
          root_path: {
            type: "string",
            description: "Legacy single-path input (file or directory, relative to plugin root).",
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
        additionalProperties: false,
      },
      async execute(input) {
        const query = String(input.query ?? "").trim();
        const requestedRoot = String(input.root_path ?? input.root_directory ?? "").trim();
        const requestedTargets = normalizeTargets(input, requestedRoot);
        const maxFiles = clampNumber(input.max_files, 1, maxExploreFiles, 8);
        const depth = clampNumber(input.max_depth, 1, maxDepth, 4);

        const resolvedTargets = await resolveExploreTargets(
          rootDir,
          requestedTargets,
          depth,
          maxFiles * 4,
        );
        const files = resolvedTargets.files;
        const results = [];
        const inventory: Array<{
          file: string;
          matches: Array<{ line: number; snippet: string }>;
        }> = [];
        const queryLower = query.toLowerCase();
        const hasQuery = query.length > 0;

        for (const filePath of files) {
          if (results.length >= maxFiles && inventory.length >= maxFiles) break;
          const raw = await readTextFileSafely(filePath);
          if (!raw) continue;
          const relativePath = path.relative(rootDir, filePath);

          if (inventory.length < maxFiles) {
            inventory.push({
              file: relativePath,
              matches: [firstLineSnippet(raw, maxSnippetLength)],
            });
          }

          const matches = raw
            .split(/\r?\n/)
            .map((line, index) => ({ index: index + 1, line }))
            .filter((entry) => hasQuery && entry.line.toLowerCase().includes(queryLower))
            .slice(0, 4);

          const filenameMatches = hasQuery && relativePath.toLowerCase().includes(queryLower);
          if (matches.length === 0 && !filenameMatches) continue;

          const effectiveMatches =
            matches.length > 0 ? matches : [{ index: 0, line: `filename match: ${relativePath}` }];

          results.push({
            file: relativePath,
            matches: effectiveMatches.map((entry) => ({
              line: entry.index,
              snippet: truncate(entry.line, maxSnippetLength),
            })),
          });
        }

        const outputResults = results.length > 0 ? results : inventory;
        const fallbackUsed = !hasQuery || results.length === 0;

        return {
          mode: "explore",
          read_only: true,
          query,
          root_path: requestedRoot || ".",
          targets: requestedTargets,
          fallback: fallbackUsed ? "inventory" : "match",
          total_results: outputResults.length,
          report: {
            query_provided: hasQuery,
            scanned_files: files.length,
            matched_files: results.length,
            returned_files: outputResults.length,
            explored_targets: resolvedTargets.targets,
          },
          results: outputResults,
        };
      },
    };
  }
}

function firstLineSnippet(
  raw: string,
  maxSnippetLength: number,
): { line: number; snippet: string } {
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

function normalizeTargets(input: Record<string, unknown>, requestedRoot: string): string[] {
  const requested = Array.isArray(input.targets)
    ? input.targets
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  if (requested.length > 0) return requested;
  return [requestedRoot || "."];
}

async function resolveExploreTargets(
  rootDir: string,
  requestedTargets: string[],
  depth: number,
  maxFiles: number,
): Promise<{
  files: string[];
  targets: Array<{ requested: string; resolved: string; kind: "file" | "directory" }>;
}> {
  const deduped = new Set<string>();
  const targets: Array<{ requested: string; resolved: string; kind: "file" | "directory" }> = [];
  for (const requested of requestedTargets) {
    const absoluteRoot = safeResolve(rootDir, requested);
    const rootInfo = await stat(absoluteRoot);
    if (rootInfo.isFile()) {
      deduped.add(absoluteRoot);
      targets.push({ requested, resolved: absoluteRoot, kind: "file" });
      continue;
    }
    targets.push({ requested, resolved: absoluteRoot, kind: "directory" });
    const files = await listFiles(absoluteRoot, depth, maxFiles);
    for (const file of files) {
      deduped.add(file);
      if (deduped.size >= maxFiles) break;
    }
    if (deduped.size >= maxFiles) break;
  }
  return { files: Array.from(deduped), targets };
}
