# microHarnesses

Library-first framework for bootstrapping agentic micro harnesses:

- **Prompt packs** — load system/developer/tool instructions from Markdown folders
- **Provider adapters** — OpenAI, Anthropic, Ollama (OpenAI-compatible)
- **Model selection** — per-run override, prompt hint, or profile default
- **Tool policy** — deny-by-default for high-risk tools, pre-execution kill/block
- **Loop orchestration** — iteration, checkpoint, session resume, agent spawning, plugins
- **Session durability** — append-only event journal, periodic snapshots, resume after failure

## Workspace layout

```
packages/
  core/               → @micro-harness/core   (reusable library)
  plugin-plan-mode/   → @micro-harness/plugin-plan-mode  (read-only planner + explorer)
apps/
  cli/                → reference CLI built on top of core
```

## Install and build

```bash
npm install
npm run build
```

> **Run tests after a build** — tests execute from compiled `dist/` output:
>
> ```bash
> npm run build && npm test
> ```

## Reference CLI

### Set credentials

```bash
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
# for local Ollama (optional — defaults to http://127.0.0.1:11434/v1)
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

### Run

```bash
npm run cli:run -- "summarise this task" --agent default --provider openai --model gpt-4.1-mini
```

Run locally with Ollama (no API key required):

```bash
ollama pull llama3.2:3b
npm run cli:run -- "summarise this task" --provider ollama --model llama3.2:3b
```

Available flags:

| Flag | Default | Description |
|---|---|---|
| `--agent <name>` | `default` | Prompt pack to load |
| `--provider <openai\|anthropic\|ollama>` | `openai` | LLM provider |
| `--model <name>` | provider default | Model name override |
| `--prompts-dir <path>` | `apps/cli/prompts` | Root directory for prompt packs |
| `--iterations <n>` | `4` | Maximum loop iterations |
| `--checkpoint-every <n>` | `2` | Save checkpoint every N iterations |
| `--snapshot-every <n>` | same as checkpoint | Save session snapshot every N iterations |
| `--session-id <id>` | new session | Re-use an existing session |
| `--resume` | off | Resume from latest session snapshot |
| `--goal <text>` | prompt text | Explicit goal persisted in session manifest |
| `--state-dir <path>` | `.micro-harness` | State and session storage root |
| `--plugins <path>` | none | Path to a `.js` plugin file |

## Session operations

Sessions are stored under `<state-dir>/sessions/<session-id>/`:

| File | Purpose |
|---|---|
| `manifest.json` | Session metadata and file pointers |
| `events.jsonl` | Append-only event/operation log |
| `snapshots/*.json` | Periodic state snapshots for fast resume |
| `support-history.jsonl` | Tool/policy failures and diagnostics |

```bash
node apps/cli/dist/index.js sessions list
node apps/cli/dist/index.js sessions show <session-id>
node apps/cli/dist/index.js sessions resume <session-id> "continue from last state"
```

## Checkpoints

```bash
node apps/cli/dist/index.js checkpoints list
node apps/cli/dist/index.js checkpoints show <checkpoint-id>
node apps/cli/dist/index.js checkpoints delete <checkpoint-id>
```

## Prompt pack convention

```
<prompts-dir>/<agent-name>/
  system.md          # required
  developer.md       # optional
  tools.md           # optional
  prompt.meta.json   # optional metadata (modelHint, safetyMode, tags)
```

Frontmatter (`---`) in Markdown is stripped before use. Variables follow `{{var_name}}` syntax.

## Plugin API

```js
// my-plugin.js
module.exports = {
  name: "my-plugin",
  register(api) {
    api.registerTool({
      name: "upper",
      description: "Uppercases text",
      risk: "low",
      async execute(input) {
        return { text: String(input.text || "").toUpperCase() };
      }
    });
  }
};
```

Load at runtime:

```bash
npm run cli:run -- "do something" --plugins ./my-plugin.js
```

## Plan Mode plugin

Package: `@micro-harness/plugin-plan-mode`

Three composable, **read-only** tools — no file writes, no process execution, no network calls:

| Tool | Description |
|---|---|
| `plan_agent` | Turns a goal + optional scope/constraints into a prioritised execution plan |
| `explore_agent` | Searches file names and content snippets under a root directory |
| `plan_mode_info` | Returns plan-mode tool list and safety guarantees |

### Use independently

```ts
import { PlannerPlugin } from "@micro-harness/plugin-plan-mode";
import { ExplorerPlugin } from "@micro-harness/plugin-plan-mode";

// Register only the planner (no filesystem access)
await runtime.registerPlugins([new PlannerPlugin()]);

// Or register both via the composite
import { PlanModePlugin } from "@micro-harness/plugin-plan-mode";
await runtime.registerPlugins([new PlanModePlugin({ rootDir: "./src" })]);
```

### Use via CLI

```bash
npm run cli:run -- "plan migration" --plugins apps/cli/plugins/plan-mode.plugin.js
```

`ExplorerPlugin` options:

| Option | Default | Description |
|---|---|---|
| `rootDir` | `process.cwd()` | Exploration is restricted to this directory |
| `maxExploreFiles` | `25` | Max files returned per query |
| `maxDepth` | `5` | Max directory depth |
| `maxSnippetLength` | `220` | Max characters per matched line |
