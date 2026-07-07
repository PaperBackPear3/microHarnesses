# microHarnesses

microHarnesses is a package-first TypeScript ecosystem for building agent runtimes.

The core package gives you runtime primitives (loop, context, policy, tools, plugins, providers, skills, channels, subagents, MCP, observability, and model routing). Plugin packages add focused capabilities you can compose based on your safety model and product needs.

## Latest updates

- Declarative agents: `defineAgent()` / `defineAgentAsync()` compose prompts,
  providers, tools, skills, subagents, and MCP servers with less boilerplate.
- Model routing: `DefaultModelRouter`, model route catalogs, live provider
  discovery, known pricing/context metadata, `list_model_routes`, CLI `/route`,
  and `--routing-preference`.
- Provider stack: OpenAI, Anthropic, Ollama, and generic OpenAI-compatible
  adapters, with provider-aware token counters and Ollama context-window
  detection.
- Agent capabilities: filesystem skills, channels, async subagent supervisor,
  tool-output artifacts, default/agentic compression, harness modes, and
  OTel-shaped observability.

## Documentation

- Website: https://paperbackpear3.github.io/microHarnesses/
- Project + architecture: [`docs/what-is-microharnesses.md`](docs/what-is-microharnesses.md)
- How runtime works: [`docs/how-runtime-works.md`](docs/how-runtime-works.md)
- Concepts + adoption choices: [`docs/concepts-and-decision-guide.md`](docs/concepts-and-decision-guide.md)
- Package concepts + functionality: [`docs/package-reference.md`](docs/package-reference.md)
- Runtime interfaces reference: [`docs/reference-runtime-interfaces.md`](docs/reference-runtime-interfaces.md)
- Getting started: [`docs/how-to-get-started.md`](docs/how-to-get-started.md)
- Plugin composition: [`docs/how-to-compose-plugins.md`](docs/how-to-compose-plugins.md)

## Packages

| Package | Purpose |
| --- | --- |
| [`@micro-harnesses/core`](packages/core) | Runtime loop, tools/channels/skills registries, MCP tools, policy engine, harness modes, session/context system, compression (default + agentic), plugin host, provider adapters (OpenAI/Anthropic/Ollama + generic OpenAI-compatible), model routing, declarative agents, and subagent runner/supervisor primitives. |
| [`@micro-harnesses/plugin-basic-tools`](plugins/basic-tools) | Workspace-scoped file mutation tools and shell execution tool. |
| [`@micro-harnesses/plugin-example-tools`](plugins/example-tools) | Minimal reference plugin (`echo`, `time`) for plugin authoring. |
| [`@micro-harnesses/cli`](apps/cli) | Agentic coding CLI (React/Ink TUI) built as a thin composition layer over core and plugins. |

## Design principles

- Package-first architecture.
- Capability-driven plugin model with explicit declarations.
- Composable policy and safety screening.
- Clear separation between reusable library runtime and app-specific composition.

## Build and test

```bash
npm install
npm run build
npm test
npm run lint
```

## Bump versions for a release

Use the monorepo bump script to set a new version everywhere (root/workspaces,
internal dependency ranges, lockfile):

```bash
npm run version:bump -- 3.2.0
```

Then create/push the matching tag (for example `v3.2.0`) to trigger the
release workflow.

## Install packages

```bash
npm install @micro-harnesses/core @micro-harnesses/plugin-basic-tools @micro-harnesses/plugin-example-tools @micro-harnesses/cli
```

## Plugin capabilities

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "observability"`

## License

MIT
