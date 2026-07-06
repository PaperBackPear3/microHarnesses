# microHarnesses

microHarnesses is a package-first TypeScript ecosystem for building agent runtimes.

The core package gives you runtime primitives (loop, context, policy, tools, plugins). Plugin packages add focused capabilities you can compose based on your safety model and product needs.

## Latest updates

- Core now includes a deterministic subagent supervisor with async spawn and
  wait/join defaults, so model-facing agents can delegate work and explicitly
  wait for child summaries.
- CLI chat layout now keeps the composer anchored at the bottom and renders runtime status in a dedicated footer below input.
- Autopilot mode is now instructed to continue until the goal is actually completed (instead of stopping after announcing a next step).

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
| [`@micro-harnesses/core`](packages/core) | Runtime loop, tools/channels/skills registries, policy engine, session/context system, plugin host, subagent runner/supervisor primitives. |
| [`@micro-harnesses/plugin-basic-tools`](plugins/basic-tools) | Workspace-scoped file mutation tools and shell execution tool. |
| [`@micro-harnesses/plugin-plan-mode`](plugins/plan-mode) | Read-only planning and code exploration tools. |
| [`@micro-harnesses/plugin-example-tools`](plugins/example-tools) | Minimal reference plugin (`echo`, `time`) for plugin authoring. |

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

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents"`

## License

MIT
