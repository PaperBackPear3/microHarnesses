import { OpenAICompatAdapter } from "./openaiCompatAdapter";

export interface OpenAIAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
}

const DEFAULT_MODEL = "gpt-5.4-mini";

/** OpenAI preset of the generic OpenAI-compatible adapter. */
export class OpenAIAdapter extends OpenAICompatAdapter {
  constructor(options: OpenAIAdapterOptions = {}) {
    super({
      providerId: "openai",
      defaultModel: options.defaultModel ?? DEFAULT_MODEL,
      defaultBaseUrl: "https://api.openai.com/v1",
      authStyle: "bearer",
      // OpenAI natively understands the "developer" role.
      mapDeveloperRoleToSystem: false,
      // Newer OpenAI models (o-series, gpt-5.x) require max_completion_tokens.
      useMaxCompletionTokens: true,
      // o-series and gpt-5.5+ are reasoning models that require reasoning_effort: "none"
      // when tool calls are used on /v1/chat/completions.
      reasoningModelPattern: /^(o[1-9]|gpt-5\.[5-9])/i,
      fetchImpl: options.fetchImpl,
    });
  }
}
