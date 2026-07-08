import { OpenAICompatAdapter } from "./openaiCompatAdapter";

export interface OllamaAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
  /**
   * When `true`, adds `format: "json"` to every request body so Ollama
   * enforces JSON output regardless of the model's default behaviour.
   * Recommended when using models like Gemma that tend to respond conversationally.
   */
  forceJsonMode?: boolean;
}

const DEFAULT_MODEL = "llama3.2:3b";

/** Ollama preset of the generic OpenAI-compatible adapter (local, no auth header). */
export class OllamaAdapter extends OpenAICompatAdapter {
  constructor(options: OllamaAdapterOptions = {}) {
    super({
      providerId: "ollama",
      defaultModel: options.defaultModel ?? DEFAULT_MODEL,
      defaultBaseUrl: "http://127.0.0.1:11434/v1",
      authStyle: "none",
      mapDeveloperRoleToSystem: true,
      forceJsonMode: options.forceJsonMode ?? false,
      fetchImpl: options.fetchImpl,
    });
  }
}
