export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
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
  userPrompt: string;
  workingTurns: Turn[];
  iteration: number;
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

export interface ModelAdapter {
  nextStep(input: StepInput): Promise<StepPlan>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AgentSpawner {
  spawn(request: SpawnRequest): Promise<string>;
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
}
