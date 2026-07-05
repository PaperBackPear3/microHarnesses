import type { HarnessPlugin, PluginApi, PluginCapability } from "../../plugins/types";
import type { CredentialsRegistry } from "../../providers/credentialsRegistry";
import type { ProviderRegistry } from "../../providers/registry";
import type { CredentialsResolver, ProviderAdapter } from "../../providers/types";
import { AnthropicAdapter, type AnthropicAdapterOptions } from "./anthropicAdapter";
import { AnthropicEnvCredentials, OllamaEnvCredentials, OpenAIEnvCredentials } from "./credentials";
import { OllamaAdapter, type OllamaAdapterOptions } from "./ollamaAdapter";
import { OpenAIAdapter, type OpenAIAdapterOptions } from "./openaiAdapter";

const PROVIDER_CAPABILITIES: PluginCapability[] = ["providers", "credentials"];

export function createProviderPlugin(
  name: string,
  adapter: ProviderAdapter,
  credentials: CredentialsResolver,
): HarnessPlugin {
  return {
    name,
    capabilities: PROVIDER_CAPABILITIES,
    register(api: PluginApi) {
      api.registerProvider(adapter);
      api.registerCredentialsResolver(adapter.providerId, credentials);
    },
  };
}

export interface OpenAIProviderPluginOptions extends OpenAIAdapterOptions {
  credentials?: CredentialsResolver;
}

export function createOpenAIProviderPlugin(
  options: OpenAIProviderPluginOptions = {},
): HarnessPlugin {
  const { credentials, ...adapterOptions } = options;
  return createProviderPlugin(
    "openai-provider",
    new OpenAIAdapter(adapterOptions),
    credentials ?? new OpenAIEnvCredentials(),
  );
}

export interface AnthropicProviderPluginOptions extends AnthropicAdapterOptions {
  credentials?: CredentialsResolver;
}

export function createAnthropicProviderPlugin(
  options: AnthropicProviderPluginOptions = {},
): HarnessPlugin {
  const { credentials, ...adapterOptions } = options;
  return createProviderPlugin(
    "anthropic-provider",
    new AnthropicAdapter(adapterOptions),
    credentials ?? new AnthropicEnvCredentials(),
  );
}

export interface OllamaProviderPluginOptions extends OllamaAdapterOptions {
  credentials?: CredentialsResolver;
}

export function createOllamaProviderPlugin(
  options: OllamaProviderPluginOptions = {},
): HarnessPlugin {
  const { credentials, ...adapterOptions } = options;
  return createProviderPlugin(
    "ollama-provider",
    new OllamaAdapter(adapterOptions),
    credentials ?? new OllamaEnvCredentials(),
  );
}

export function builtInProviderPlugins(): HarnessPlugin[] {
  return [
    createOpenAIProviderPlugin(),
    createAnthropicProviderPlugin(),
    createOllamaProviderPlugin(),
  ];
}

export function registerBuiltInProviders(
  providers: ProviderRegistry,
  credentials: CredentialsRegistry,
): void {
  providers.register(new OpenAIAdapter());
  credentials.register("openai", new OpenAIEnvCredentials());
  providers.register(new AnthropicAdapter());
  credentials.register("anthropic", new AnthropicEnvCredentials());
  providers.register(new OllamaAdapter());
  credentials.register("ollama", new OllamaEnvCredentials());
}
