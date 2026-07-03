import type {
  HarnessPlugin,
  PluginApi,
  PluginCapability,
  ToolDefinition,
} from "@micro-harness/core";
import STEPS from "../steps.json";
import { clampNumber, normalizeStringList } from "../utils";

type StepTemplate = { title: string; detail: string };

export class PlannerPlugin implements HarnessPlugin {
  readonly name = "planner-plugin";
  readonly capabilities: PluginCapability[] = ["tools"];

  register(api: PluginApi): void {
    api.registerTool(this.planAgentTool());
  }

  private planAgentTool(): ToolDefinition {
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
  const templates = (STEPS as StepTemplate[]).slice(0, maxSteps);

  return templates.map((step, index) => {
    let detail = step.detail;
    if (index === 0) detail = `${detail} Goal: ${goal}`;
    if (index === 1 && scope.length > 0) detail = `Explore scoped areas: ${scope.join(", ")}`;
    if (index === 2 && constraints.length > 0)
      detail = `Respect constraints: ${constraints.join(", ")}. ${detail}`;

    return {
      id: `step-${index + 1}`,
      title: step.title,
      detail,
      priority: index === 0 ? "high" : index < 3 ? "medium" : "low",
      status: "pending",
    };
  });
}
