import type { CompressionResult } from "../context/types";
import type { PromptBundle } from "../prompts/types";
import type { Turn } from "../runtime/state";
import type { SkillCall } from "../skills/types";
import type { ToolDescriptor } from "../tools/types";
import type { ToolCall } from "../tools/types";

export interface ModelProfile {
  defaultModel: string;
  reasoningModel?: string;
  fastModel?: string;
}

export interface ModelSelectionInput {
  promptName: string;
  iteration: number;
  /** Explicit task-type hint from prompt metadata; when absent the selector may infer one. */
  taskType?: "default" | "reasoning" | "fast";
  /** Raw user prompt, available to selectors that infer task type heuristically. */
  userPrompt?: string;
  overrideModel?: string;
  promptHintModel?: string;
}

export interface ModelSelectionDecision {
  model: string;
  reason: "override" | "prompt-hint" | "profile";
}

export interface ModelSelector {
  select(input: ModelSelectionInput, profile: ModelProfile): ModelSelectionDecision;
}

export interface StepPlan {
  assistantMessage: string;
  toolCalls: ToolCall[];
  skillCalls?: SkillCall[];
  stop: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface StepInput {
  promptName: string;
  userPrompt: string;
  bundle: PromptBundle;
  workingTurns: Turn[];
  /** Compressed summary of older, overflowed turns to reinject as prior context. */
  summary?: CompressionResult;
  iteration: number;
  selectedModel?: string;
  /**
   * Provider id chosen by a {@link ModelRouter}, when routing is configured.
   * Adapters that can serve multiple providers (e.g. `ProviderModelAdapter`)
   * should prefer this over their static/dynamic default provider.
   */
  selectedProviderId?: string;
  /** Route-level max token override selected by a {@link ModelRouter}. */
  selectedMaxTokens?: number;
  availableTools?: ToolDescriptor[];
  availableSkills?: string[];
  /** Aborted when the run is killed; adapters should abandon in-flight requests. */
  signal?: AbortSignal;
  onAssistantDelta?: (delta: string) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export interface ModelAdapter {
  nextStep(input: StepInput): Promise<StepPlan>;
}

/**
 * Relative, provider-agnostic ratings used to compare candidate routes.
 * Values are unit-less and only meaningful relative to other routes in the
 * same catalog; consumers may leave any field unset when unknown.
 */
export interface ModelRouteMetadata {
  /** Relative cost rating; lower is cheaper. */
  cost?: number;
  /** Relative speed/latency rating; higher is faster. */
  speed?: number;
  /** Relative capability rating; higher is more intelligent/capable. */
  intelligence?: number;
  contextWindowTokens?: number;
  tags?: string[];
}

/** A single provider/model combination a {@link ModelRouter} can select. */
export interface ModelRoute {
  /** Stable identifier for this route, e.g. `"openai:gpt-4.1"`. */
  id: string;
  providerId: string;
  model: string;
  maxTokens?: number;
  /** Whether this route is currently usable. Defaults to `true` when unset. */
  available?: boolean;
  metadata?: ModelRouteMetadata;
}

/**
 * High-level routing intent. `"auto"` lets the router infer a preference from
 * task type/effort; the others bias scoring toward one dimension.
 */
export type ModelRoutingPreference = "auto" | "cost" | "speed" | "intelligence" | "balanced";

export interface ModelRoutingConstraints {
  minIntelligence?: number;
  maxCost?: number;
  /** Candidate routes must carry every tag listed here (when any route does). */
  requiredTags?: string[];
}

export interface ModelRoutingRequest {
  preference?: ModelRoutingPreference;
  constraints?: ModelRoutingConstraints;
  taskType?: "default" | "reasoning" | "fast";
  /** Name of the agent/prompt persona requesting a route (for diagnostics/overrides). */
  agentName?: string;
  agentKind?: "main" | "subagent";
  effort?: "low" | "medium" | "high";
  /** Hard override: select this exact route id when present, ignoring scoring. */
  overrideRouteId?: string;
  /** Hard override: select the route matching this provider id + model, ignoring scoring. */
  overrideProviderId?: string;
  overrideModel?: string;
  /** Whether this routing decision is surfaced to the user or made internally by an agent. */
  visibility?: "user-visible" | "internal";
}

export interface ModelRouteDecision {
  route: ModelRoute;
  reason: "override" | "constraint" | "preference" | "fallback";
  preference?: ModelRoutingPreference;
  /** Number of candidate routes left after filtering, before scoring. */
  candidatesConsidered?: number;
}

/** Selects a provider/model route from an explicit catalog of candidates. */
export interface ModelRouter {
  selectRoute(request: ModelRoutingRequest, routes: ModelRoute[]): ModelRouteDecision;
}
