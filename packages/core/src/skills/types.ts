export interface SkillExecutionContext {
  signal?: AbortSignal;
}

export interface SkillDefinition {
  name: string;
  description: string;
  tags?: string[];
  capabilities?: string[];
  inputSchema?: Record<string, unknown>;
  execute(
    input: Record<string, unknown>,
    context?: SkillExecutionContext,
  ): Promise<Record<string, unknown>>;
}

export interface SkillCall {
  name: string;
  input: Record<string, unknown>;
}

export interface SkillResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
}

export interface SkillCatalogQuery {
  tag?: string;
  capability?: string;
}
