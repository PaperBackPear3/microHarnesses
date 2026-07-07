import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { clampNumber, normalizeStringList } from "../../shared/inputParsing";
import { safeResolve } from "../../shared/paths";
import { truncate } from "../../shared/text";
import type { ToolDefinition } from "../../tools/types";

type PlanStepTemplate = {
  title: string;
  detail: string;
};

const PLAN_STEP_TEMPLATES: PlanStepTemplate[] = [
  {
    title: "Clarify the target outcome",
    detail: "Define success criteria, constraints, and any compatibility requirements.",
  },
  {
    title: "Explore relevant surfaces",
    detail: "Inspect files and dependencies touched by the requested change.",
  },
  {
    title: "Design the change set",
    detail: "Choose the smallest coherent implementation that covers all impacted areas.",
  },
  {
    title: "Implement incrementally",
    detail: "Apply focused changes in logical order while preserving existing behavior.",
  },
  {
    title: "Validate behavior",
    detail: "Run targeted checks for correctness and regressions in changed surfaces.",
  },
  {
    title: "Finalize integration details",
    detail: "Align docs, config, and package wiring with the implementation.",
  },
  {
    title: "Review edge cases",
    detail: "Confirm behavior for invalid input paths and boundary conditions.",
  },
  {
    title: "Harden failure handling",
    detail: "Ensure errors are explicit and follow existing error handling conventions.",
  },
  {
    title: "Check cross-surface consistency",
    detail: "Verify behavior stays coherent across CLI/runtime/docs and public interfaces.",
  },
  {
    title: "Prepare rollout notes",
    detail: "Capture migration impacts and user-facing behavior changes.",
  },
  {
    title: "Confirm non-goals",
    detail: "Explicitly note what is intentionally out of scope for this change set.",
  },
  {
    title: "Define follow-up opportunities",
    detail: "List deferred improvements that are safe to postpone beyond this implementation.",
  },
];

export interface PlanModeToolsOptions {
  /** Root directory that exploration is restricted to. */
  rootDir: string;
  /** Maximum number of matching files to include in a single result. Default: 25. */
  maxExploreFiles?: number;
  /** Maximum directory depth to traverse. Default: 5. */
  maxDepth?: number;
  /** Maximum length of each matched line snippet. Default: 220. */
  maxSnippetLength?: number;
}

interface ResolvedPlanModeOptions {
  rootDir: string;
  maxExploreFiles: number;
  maxDepth: number;
  maxSnippetLength: number;
}

export function createPlanModeTools(options: PlanModeToolsOptions): ToolDefinition[] {
  const resolved = resolvePlanModeOptions(options);
  return [
    createPlanAgentTool(),
    createExploreAgentTool(resolved),
    createPlanModeInfoTool(),
  ];
}

function resolvePlanModeOptions(options: PlanModeToolsOptions): ResolvedPlanModeOptions {
  return {
    rootDir: path.resolve(options.rootDir),
    maxExploreFiles: options.maxExploreFiles ?? 25,
    maxDepth: options.maxDepth ?? 5,
    maxSnippetLength: options.maxSnippetLength ?? 220,
  };
}

function createPlanAgentTool(): ToolDefinition {
  return {
    name: "plan_agent",
    description: "Read-only planner that turns a goal into prioritised execution steps.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "Required planning goal.",
        },
        scope: {
          oneOf: [
            { type: "string", description: "Comma-separated scoped areas." },
            {
              type: "array",
              items: { type: "string" },
              description: "List of scoped areas.",
            },
          ],
        },
        constraints: {
          oneOf: [
            { type: "string", description: "Comma-separated constraints." },
            {
              type: "array",
              items: { type: "string" },
              description: "List of constraints.",
            },
          ],
        },
        max_steps: {
          type: "number",
          description: "Optional desired number of steps; clamped to [3, 12].",
        },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    async execute(input) {
      const goal = String(input.goal ?? "").trim();
      if (!goal) throw new Error("plan_agent requires 'goal'");

      const scope = normalizeStringList(input.scope);
      const constraints = normalizeStringList(input.constraints);
      const maxSteps = clampNumber(input.max_steps, 3, 12, 6);
      const steps = buildPlanSteps(goal, maxSteps, scope, constraints);
      const milestones = [
        "Validate requirements and constraints",
        "Implement minimal vertical slice",
        "Verify behaviour and document operations",
      ].slice(0, Math.min(3, steps.length));

      return {
        mode: "plan",
        read_only: true,
        goal,
        scope,
        constraints,
        requested_max_steps: maxSteps,
        actual_steps: steps.length,
        milestones,
        steps,
        notes: [
          "This tool is read-only and does not execute actions.",
          "Use explore_agent to gather codebase facts before finalising the plan.",
        ],
      };
    },
  };
}

function buildPlanSteps(
  goal: string,
  maxSteps: number,
  scope: string[],
  constraints: string[],
): Array<{
  id: string;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  status: "pending";
}> {
  const templates = PLAN_STEP_TEMPLATES.slice(0, maxSteps);
  return templates.map((step, index) => {
    let detail = step.detail;
    if (index === 0) detail = `${detail} Goal: ${goal}`;
    if (index === 1 && scope.length > 0) detail = `Explore scoped areas: ${scope.join(", ")}`;
    if (index === 2 && constraints.length > 0) {
      detail = `Respect constraints: ${constraints.join(", ")}. ${detail}`;
    }

    return {
      id: `step-${index + 1}`,
      title: step.title,
      detail,
      priority: index === 0 ? "high" : index < 3 ? "medium" : "low",
      status: "pending",
    };
  });
}

function createExploreAgentTool(options: ResolvedPlanModeOptions): ToolDefinition {
  const { rootDir, maxExploreFiles, maxDepth, maxSnippetLength } = options;
  return {
    name: "explore_agent",
    description: "Read-only explorer that searches file names and content snippets.",
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
            "Optional list of file/directory paths (relative to root) to explore in one call.",
        },
        root_path: {
          type: "string",
          description: "Legacy single-path input (file or directory, relative to root).",
        },
        root_directory: {
          type: "string",
          description:
            "Alias for root_path. Supported for compatibility with OpenAI/Ollama prompts.",
        },
        max_files: {
          type: "number",
          description: "Optional cap on result files. Clamped to configured limits.",
        },
        max_depth: {
          type: "number",
          description: "Optional traversal depth. Clamped to configured limits.",
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
      const results: Array<{ file: string; matches: Array<{ line: number; snippet: string }> }> =
        [];
      const inventory: Array<{ file: string; matches: Array<{ line: number; snippet: string }> }> =
        [];
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

async function listFiles(root: string, maxDepth: number, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift();
    if (!current) break;
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

async function readTextFileSafely(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.length > 200_000 ? raw.slice(0, 200_000) : raw;
  } catch {
    return undefined;
  }
}

function firstLineSnippet(
  raw: string,
  maxSnippetLength: number,
): { line: number; snippet: string } {
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    return {
      line: index + 1,
      snippet: truncate(line, maxSnippetLength),
    };
  }
  return { line: 1, snippet: "" };
}

function createPlanModeInfoTool(): ToolDefinition {
  return {
    name: "plan_mode_info",
    description: "Returns capabilities and guarantees of the plan-mode read-only tools.",
    risk: "low",
    async execute() {
      return {
        mode: "plan_mode",
        tools: ["plan_agent", "explore_agent", "plan_mode_info"],
        guarantees: [
          "No file writes",
          "No process execution",
          "No network calls",
          "Planning and exploration only",
        ],
      };
    },
  };
}
