import type {
  CredentialsResolver,
  HarnessPlugin,
  PluginApi,
  PluginCapability,
  ProviderAdapter,
} from "@micro-harness/core";
import { AnthropicAdapter, type AnthropicAdapterOptions } from "./anthropicAdapter";
import { AnthropicEnvCredentials, OllamaEnvCredentials, OpenAIEnvCredentials } from "./credentials";
import { OllamaAdapter, type OllamaAdapterOptions } from "./ollamaAdapter";
import { OpenAIAdapter, type OpenAIAdapterOptions } from "./openaiAdapter";

const PROVIDER_CAPABILITIES: PluginCapability[] = ["providers", "credentials"];

/**
 * Base plugin factory: registers a provider adapter + a credentials resolver
 * under the adapter's `providerId`. Used by the built-in provider plugins
 * below, but also exported so users can register their own providers with
 * the same shape.
 */
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

/** Convenience: the three built-in provider plugins with default env credentials. */
export function builtInProviderPlugins(): HarnessPlugin[] {
  return [
    createOpenAIProviderPlugin(),
    createAnthropicProviderPlugin(),
    createOllamaProviderPlugin(),
  ];
}
