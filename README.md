# microHarnesses

microHarnesses is a package-first TypeScript ecosystem for building agent runtimes.

The core package gives you runtime primitives (loop, context, policy, tools, plugins). Plugin packages add focused capabilities you can compose based on your safety model and product needs.

## Latest updates

- Core now owns the full harness capability set: harness modes (`plan` /
  `accept-edits` / `autopilot`) with a mode-aware approval policy and the
  autopilot execution contract, an effort-based model selector with default
  provider model profiles, and Ollama context-window detection.
- New generic `OpenAICompatAdapter` lets you register any OpenAI-compatible
  endpoint (OpenRouter, Groq, Azure OpenAI, LM Studio, vLLM, …) in one line via
  `createOpenAICompatProviderPlugin`; the OpenAI and Ollama adapters are now
  thin presets of it, with hardened SSE parsing and finish-reason mapping.
- `FsSkillSource` now loads real executable skills from disk (`SKILL.md` +
  optional `skill.meta.json` and resource files); the CLI wires them up via
  `--skills-dir` (default `<state-dir>/skills`).
- Context-window token estimation is now provider-aware: built-in OpenAI-compatible
  providers use `js-tiktoken`, adapters can expose custom token counters, and
  runtime usage is fed back to calibrate compaction/utilization over time.

## Documentation

- Website: https://paperbackpear3.github.io/microHarnesses/
- Project + architecture: [`docs/what-is-microharnesses.md`](docs/what-is-microharnesses.md)
- How runtime works: [`docs/how-runtime-works.md`](docs/how-runtime-works.md)
- Concepts + adoption choices: [`docs/concepts-and-decision-guide.md`](docs/concepts-and-decision-guide.md)
- Package concepts + functionality: [`docs/package-reference.md`](docs/package-reference.md)
- Runtime interfaces reference: [`docs/reference-runtime-interfaces.md`](docs/reference-runtime-interfaces.md)
- Getting started: [`docs/how-to-get-started.md`](docs/how-to-get-started.md)
- Tutorial (build a sample app): [`docs/tutorial-build-sample-app.md`](docs/tutorial-build-sample-app.md)
- Plugin composition: [`docs/how-to-compose-plugins.md`](docs/how-to-compose-plugins.md)

## Packages

| Package | Purpose |
| --- | --- |
| [`@micro-harnesses/core`](packages/core) | Runtime loop, tools/channels/skills registries, policy engine, harness modes, session/context system, plugin host, provider adapters (OpenAI/Anthropic/Ollama + generic OpenAI-compatible), subagent runner/supervisor primitives. |
| [`@micro-harnesses/plugin-basic-tools`](plugins/basic-tools) | Workspace-scoped file mutation tools and shell execution tool. |
| [`@micro-harnesses/plugin-plan-mode`](plugins/plan-mode) | Read-only planning and code exploration tools. |
| [`@micro-harnesses/plugin-agentic-compression`](plugins/agentic-compression) | Subagent-driven context compression (summarizes older turns via a spawned agent). |
| [`@micro-harnesses/plugin-example-tools`](plugins/example-tools) | Minimal reference plugin (`echo`, `time`) for plugin authoring. |
| [`@micro-harnesses/cli`](apps/cli) | Agentic coding CLI (React/Ink TUI) built as a thin composition layer over core and the plugins. |

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

## Install packages

```bash
npm install @micro-harnesses/core @micro-harnesses/plugin-basic-tools @micro-harnesses/plugin-plan-mode @micro-harnesses/plugin-example-tools @micro-harnesses/cli
```

## Plugin capabilities

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "observability"`

## License

MIT
