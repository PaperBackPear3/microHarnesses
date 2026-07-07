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
      fetchImpl: options.fetchImpl,
    });
  }
}
