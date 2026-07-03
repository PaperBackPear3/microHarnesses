export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
}

export interface PromptBundle {
  system: string;
  instructions: PromptInstruction[];
  task: string;
  metadata: PromptMetadata;
}

export interface PromptInstruction {
  role: "system" | "developer" | "tools" | "custom";
  name: string;
  content: string;
}

export interface PromptMetadata {
  name: string;
  modelHint?: string;
  safetyMode?: "strict" | "balanced" | "open";
  tags?: string[];
}

export interface PromptSource {
  load(agentName: string, task: string, variables?: Record<string, string>): Promise<PromptBundle>;
}

export interface ProviderAuth {
  apiKey: string;
  baseUrl?: string;
}

export interface ProviderCredentialsResolver {
  resolve(provider: ProviderId): Promise<ProviderAuth>;
}

export interface ProviderMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

export interface ProviderToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderResponse {
  assistantMessage: string;
  toolCalls: ProviderToolCall[];
  stop: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export type ProviderId = "openai" | "anthropic";

export interface CompletionRequest {
  model: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderAdapter {
  providerId: ProviderId;
  complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse>;
}

export interface ModelProfile {
  defaultModel: string;
  reasoningModel?: string;
  fastModel?: string;
}

export interface ModelSelectionInput {
  agentName: string;
  iteration: number;
  taskType?: "default" | "reasoning" | "fast";
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

export interface SpawnRequest {
  prompt: string;
}

export interface StepPlan {
  assistantMessage: string;
  toolCalls: ToolCall[];
  spawnRequest?: SpawnRequest;
  stop: boolean;
}

export interface Turn {
  id: string;
  iteration: number;
  userMessage: string;
  assistantMessage: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  spawnedAgentResult?: string;
}

export interface HarnessState {
  runId: string;
  startedAt: string;
  turns: Turn[];
}

export interface StepInput {
  agentName: string;
  userPrompt: string;
  bundle: PromptBundle;
  workingTurns: Turn[];
  iteration: number;
  selectedModel?: string;
}

export interface ModelAdapter {
  nextStep(input: StepInput): Promise<StepPlan>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: "low" | "high";
  execute(input: Record<string, unknown>, context?: ToolExecutionContext): Promise<Record<string, unknown>>;
}

export interface ToolExecutionContext {
  signal: AbortSignal;
}

export interface AgentSpawner {
  spawn(request: SpawnRequest): Promise<string>;
}

export type PolicyDecision = "allow" | "deny" | "require_approval" | "sandbox_only";

export interface ToolPolicyEvaluation {
  decision: PolicyDecision;
  reason: string;
}

export interface ToolPolicyContext {
  iteration: number;
  agentName: string;
  runId: string;
  safetyMode?: "strict" | "balanced" | "open";
}

export interface ToolPolicyEngine {
  evaluate(tool: ToolDefinition, call: ToolCall, context: ToolPolicyContext): Promise<ToolPolicyEvaluation>;
}

export interface RuntimeLimits {
  toolTimeoutMs: number;
  maxToolCallsPerRun: number;
}

export type BeforeLoopHook = (state: HarnessState, iteration: number) => Promise<void> | void;
export type AfterLoopHook = (state: HarnessState, iteration: number) => Promise<void> | void;
export type CompressorFn = (turns: Turn[]) => Promise<string> | string;

export interface PluginApi {
  registerTool: (tool: ToolDefinition) => void;
  onBeforeLoop: (hook: BeforeLoopHook) => void;
  onAfterLoop: (hook: AfterLoopHook) => void;
  setCompressor: (compressor: CompressorFn) => void;
}

export interface HarnessPlugin {
  name: string;
  register(api: PluginApi): Promise<void> | void;
}

export interface RunOptions {
  maxIterations: number;
  checkpointEvery: number;
  profile: ModelProfile;
  modelProvider: ProviderId;
}

export type ExecutionEventType =
  | "run.started"
  | "model.selected"
  | "tool.allowed"
  | "tool.blocked"
  | "tool.killed"
  | "run.limit_reached"
  | "run.completed";

export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: string;
  runId: string;
  payload: Record<string, unknown>;
}

export interface EventSink {
  push(event: ExecutionEvent): Promise<void>;
}
