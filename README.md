# microHarnesses

microHarnesses is a package-first TypeScript ecosystem for building agent runtimes.

## Packages

| Package | Purpose |
| --- | --- |
| [`@micro-harness/core`](packages/core) | Runtime loop, tools, channels, skills, sessions/context, policy, plugin host, subagent primitive, and core defaults. |
| [`@micro-harness/plugin-basic-tools`](plugins/basic-tools) | Workspace file/search/shell tools. |
| [`@micro-harness/plugin-plan-mode`](plugins/plan-mode) | Read-only planning and repository exploration tools. |
| [`@micro-harness/plugin-example-tools`](plugins/example-tools) | Minimal reference tools (`echo`, `time`). |

## Design principles

- Package-first architecture.
- First-class capability model: tools, channels, skills, agents.
- Unified agent/subagent invocation interface.
- Capability governance via policy + approval.
- Core ships sane defaults while keeping extension points explicit.

## Build and test

```bash
npm install
npm run build
npm test
npm run lint
```

## Plugin capabilities

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "tool-governance"`

## License

MIT
