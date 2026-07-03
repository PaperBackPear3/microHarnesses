import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HarnessPlugin, PluginApi, ToolDefinition } from "@micro-harness/core";

export interface PlanModePluginOptions {
  rootDir?: string;
  maxExploreFiles?: number;
  maxDepth?: number;
  maxSnippetLength?: number;
}

export class PlanModePlugin implements HarnessPlugin {
  readonly name = "plan-mode-plugin";
  private readonly rootDir: string;
  private readonly maxExploreFiles: number;
  private readonly maxDepth: number;
  private readonly maxSnippetLength: number;

  constructor(options: PlanModePluginOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.maxExploreFiles = options.maxExploreFiles ?? 25;
    this.maxDepth = options.maxDepth ?? 5;
    this.maxSnippetLength = options.maxSnippetLength ?? 220;
  }

  register(api: PluginApi): void {
    api.registerTool(this.planAgentTool());
    api.registerTool(this.exploreAgentTool());
    api.registerTool(this.planModeInfoTool());
  }

  private planAgentTool(): ToolDefinition {
    return {
      name: "plan_agent",
      description: "Read-only planner that turns a goal into prioritized execution steps.",
      risk: "low",
      async execute(input) {
        const goal = String(input.goal ?? "").trim();
        if (!goal) {
          throw new Error("plan_agent requires 'goal'");
        }

        const scope = normalizeStringList(input.scope);
        const constraints = normalizeStringList(input.constraints);
        const maxSteps = clampNumber(input.max_steps, 3, 12, 6);

        const steps = buildPlanSteps(goal, maxSteps, scope, constraints);
        const milestones = [
          "Validate requirements and constraints",
          "Implement minimal vertical slice",
          "Verify behavior and document operations"
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
            "Use explore_agent to gather codebase facts before finalizing the plan."
          ]
        };
      }
    };
  }

  private exploreAgentTool(): ToolDefinition {
    return {
      name: "explore_agent",
      description: "Read-only explorer for file names and relevant snippets under a root directory.",
      risk: "low",
      execute: async (input) => {
        const query = String(input.query ?? "").trim();
        if (!query) {
          throw new Error("explore_agent requires 'query'");
        }

        const requestedRoot = String(input.root_path ?? "").trim();
        const absoluteRoot = requestedRoot ? safeResolve(this.rootDir, requestedRoot) : this.rootDir;
        const maxFiles = clampNumber(input.max_files, 1, this.maxExploreFiles, 8);
        const maxDepth = clampNumber(input.max_depth, 1, this.maxDepth, 4);

        const files = await listFiles(absoluteRoot, maxDepth, maxFiles * 4);
        const results = [];
        const queryLower = query.toLowerCase();

        for (const filePath of files) {
          if (results.length >= maxFiles) {
            break;
          }
          const raw = await readTextFileSafely(filePath);
          if (!raw) {
            continue;
          }

          const lines = raw.split(/\r?\n/);
          const matches = lines
            .map((line, index) => ({ index: index + 1, line }))
            .filter((entry) => entry.line.toLowerCase().includes(queryLower))
            .slice(0, 4);

          if (matches.length === 0) {
            continue;
          }

          results.push({
            file: path.relative(absoluteRoot, filePath),
            matches: matches.map((entry) => ({
              line: entry.index,
              snippet: trim(entry.line, this.maxSnippetLength)
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

  private planModeInfoTool(): ToolDefinition {
    return {
      name: "plan_mode_info",
      description: "Returns capabilities and guarantees of plan mode read-only tools.",
      risk: "low",
      async execute() {
        return {
          mode: "plan_mode",
          tools: ["plan_agent", "explore_agent", "plan_mode_info"],
          guarantees: [
            "No file writes",
            "No process execution",
            "No network calls",
            "Planning and exploration only"
          ]
        };
      }
    };
  }
}

function buildPlanSteps(
  goal: string,
  maxSteps: number,
  scope: string[],
  constraints: string[]
): Array<{ id: string; title: string; detail: string; priority: "high" | "medium" | "low"; status: "pending" }> {
  const base = [
    {
      title: "Clarify objective and success criteria",
      detail: `Restate goal and define measurable outcome: ${goal}`
    },
    {
      title: "Inventory current state",
      detail: scope.length > 0 ? `Explore scoped areas: ${scope.join(", ")}` : "Explore code paths relevant to the goal"
    },
    {
      title: "Design minimal implementation path",
      detail:
        constraints.length > 0
          ? `Respect constraints while defining interfaces and boundaries: ${constraints.join(", ")}`
          : "Define interfaces and smallest vertical implementation"
    },
    {
      title: "Implement and integrate in slices",
      detail: "Apply changes in small slices that preserve existing behavior"
    },
    {
      title: "Validate and operationalize",
      detail: "Run targeted validation and document usage/ops behavior"
    },
    {
      title: "Break into execution tickets",
      detail: "Translate plan into independently executable tasks with dependencies"
    },
    {
      title: "Define rollback and safety boundaries",
      detail: "Specify failure handling and rollback checkpoints before risky steps"
    },
    {
      title: "Sequence implementation by risk",
      detail: "Do low-risk scaffolding first, high-risk changes last with guardrails"
    },
    {
      title: "Confirm observability requirements",
      detail: "Define what logs/metrics/events prove correctness in operation"
    },
    {
      title: "Prepare verification matrix",
      detail: "Map each requirement to a concrete validation method"
    },
    {
      title: "Document operator workflow",
      detail: "Capture runbook details for setup, resume, and recovery paths"
    },
    {
      title: "Finalize delivery checklist",
      detail: "Consolidate completion criteria and handoff artifacts"
    }
  ].slice(0, maxSteps);

  return base.map((step, index) => ({
    id: `step-${index + 1}`,
    title: step.title,
    detail: step.detail,
    priority: index === 0 ? "high" : index < 3 ? "medium" : "low",
    status: "pending"
  }));
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function safeResolve(rootDir: string, requestedPath: string): string {
  const resolved = path.resolve(rootDir, requestedPath);
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    throw new Error(`Path "${requestedPath}" escapes plugin root`);
  }
  return resolved;
}

async function listFiles(root: string, maxDepth: number, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const entries = await readdir(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absolute = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth + 1 <= maxDepth) {
          queue.push({ dir: absolute, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(absolute);
      }
      if (out.length >= maxFiles) {
        break;
      }
    }
  }

  return out;
}

async function readTextFileSafely(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    if (raw.length > 200_000) {
      return raw.slice(0, 200_000);
    }
    return raw;
  } catch {
    return undefined;
  }
}

function trim(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
