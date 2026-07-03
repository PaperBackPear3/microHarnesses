# @micro-harness/plugin-plan-mode

Read-only planning and file exploration plugin for [`@micro-harness/core`](../core).

Ships three composable tools — **no file writes, no process execution, no network calls**:

| Tool | Description |
|---|---|
| `plan_agent` | Turns a goal + optional scope/constraints into a prioritised execution plan |
| `explore_agent` | Searches file names and content snippets under a root directory |
| `plan_mode_info` | Returns plan-mode tool list and safety guarantees |

## Install

```bash
npm install @micro-harness/core @micro-harness/plugin-plan-mode
```

## Usage

```ts
import { PlanModePlugin } from "@micro-harness/plugin-plan-mode";

await pluginHost.register([new PlanModePlugin({ rootDir: process.cwd() })]);
```

Or register only the planner (no filesystem access):

```ts
import { PlannerPlugin } from "@micro-harness/plugin-plan-mode";
await pluginHost.register([new PlannerPlugin()]);
```

## `ExplorerPlugin` options

| Option | Default | Description |
|---|---|---|
| `rootDir` | `process.cwd()` | Exploration is restricted to this directory |
| `maxExploreFiles` | `25` | Max files returned per query |
| `maxDepth` | `5` | Max directory depth |
| `maxSnippetLength` | `220` | Max characters per matched line |

## Capabilities

`["tools"]` — declared by each plugin. No providers, policy rules, or hooks
are registered.

## License

MIT
