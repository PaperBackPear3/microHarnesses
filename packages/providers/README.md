# @micro-harness/providers

Built-in provider plugins for [`@micro-harness/core`](../core).
Reusable package-first building blocks for composing your own harness runtime.
The repository's `apps/cli` consumes these plugins as a reference composition.

Each provider is a `HarnessPlugin` that registers a `ProviderAdapter` and an
env-based `CredentialsResolver` under the provider's id.

## Install

```bash
npm install @micro-harness/core @micro-harness/providers
```

## Usage

```ts
import { PluginHost } from "@micro-harness/core";
import { builtInProviderPlugins } from "@micro-harness/providers";

await pluginHost.register(builtInProviderPlugins());
// registers: openai, anthropic, ollama
```

Or a single provider:

```ts
import { createOpenAIProviderPlugin } from "@micro-harness/providers";

await pluginHost.register([createOpenAIProviderPlugin()]);
```

## Environment variables

| Provider | Variables |
|---|---|
| OpenAI | `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (optional) |
| Anthropic | `ANTHROPIC_API_KEY` (required), `ANTHROPIC_BASE_URL` (optional) |
| Ollama | `OLLAMA_API_KEY` (optional, default `ollama`), `OLLAMA_BASE_URL` (optional, default `http://127.0.0.1:11434/v1`) |

## Custom credentials

Swap the resolver at plugin construction:

```ts
import { createAnthropicProviderPlugin } from "@micro-harness/providers";
import type { CredentialsResolver } from "@micro-harness/core";

class VaultCreds implements CredentialsResolver {
  async resolve() { return { apiKey: await vault.get("anthropic") }; }
}

pluginHost.register([createAnthropicProviderPlugin({ credentials: new VaultCreds() })]);
```

## Testing with injected `fetch`

All three adapters accept a `fetchImpl` option for testing:

```ts
import { OpenAIAdapter } from "@micro-harness/providers";

const adapter = new OpenAIAdapter({
  fetchImpl: async () => new Response('{"choices":[{"message":{"content":"hi"},"finish_reason":"stop"}]}', { status: 200 }),
});
```

## License

MIT
