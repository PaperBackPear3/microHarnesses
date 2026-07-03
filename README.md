# microHarnesses

Library-first framework to bootstrap agentic micro harnesses with:
- prompt packs from Markdown folders
- provider adapters (OpenAI + Anthropic + Ollama)
- model selection strategy
- tool policy enforcement (deny/allow before execution)
- loop orchestration, checkpoints, local agent spawning, plugins

## Workspace layout

- `packages/core`: reusable library (`@micro-harness/core`)
- `apps/cli`: reference CLI implementation using the core library

## Install and build

```bash
npm install
npm run build
```

Run tests:

```bash
npm test
```

## Run the reference CLI

Set provider credentials:

```bash
export OPENAI_API_KEY=...
# or
export ANTHROPIC_API_KEY=...
# for local ollama (optional override)
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

Then run:

```bash
npm run cli:run -- "summarize this task" --agent default --provider openai --model gpt-4.1-mini
```

Run locally with Ollama:

```bash
ollama pull llama3.2:3b
npm run cli:run -- "summarize this task" --agent default --provider ollama --model llama3.2:3b
```

Useful flags:
- `--agent <name>`
- `--prompts-dir <path>`
- `--provider <openai|anthropic|ollama>`
- `--model <name>`
- `--iterations <n>`
- `--checkpoint-every <n>`
- `--snapshot-every <n>`
- `--session-id <id>`
- `--resume`
- `--goal <text>`
- `--state-dir <path>`
- `--plugins <path-to-plugin.js>`

## Session operations and resume

Sessions are persisted under `<state-dir>/sessions` as:
- `manifest.json` (session metadata + pointers)
- `events.jsonl` (append-only operation/event log)
- `snapshots/*.json` (periodic snapshots for fast resume)
- `support-history.jsonl` (tool/policy failures and operational diagnostics)

Commands:

```bash
node apps/cli/dist/index.js sessions list
node apps/cli/dist/index.js sessions show <session-id>
node apps/cli/dist/index.js sessions resume <session-id> "continue from where we stopped"
```

## Prompt pack convention

`<prompts-dir>/<agent-name>/`:
- `system.md` (required)
- `developer.md` (optional)
- `tools.md` (optional)
- `prompt.meta.json` (optional metadata)

Frontmatter in markdown is accepted and stripped. Variables use `{{var_name}}`.

## Checkpoints

```bash
node apps/cli/dist/index.js checkpoints list
node apps/cli/dist/index.js checkpoints show <checkpoint-id>
node apps/cli/dist/index.js checkpoints delete <checkpoint-id>
```

## Plugin shape

```js
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

## Built-in Plan Mode plugin (read-only planning + exploration)

Distributed package: `@micro-harness/plugin-plan-mode`.

A ready plugin file is included at:
- `apps/cli/plugins/plan-mode.plugin.js`

Use with CLI:

```bash
npm run cli:run -- "plan migration work" --plugins apps/cli/plugins/plan-mode.plugin.js
```

This registers read-only tools:
- `plan_agent`: produces structured plans from a goal/scope/constraints
- `explore_agent`: explores files/snippets for a query under plugin root
- `plan_mode_info`: returns plan mode guarantees/capabilities

The plugin is intentionally read-only: it does not write files, execute processes, or call network APIs.
