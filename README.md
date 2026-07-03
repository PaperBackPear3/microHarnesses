# microHarnesses

Library-first framework to bootstrap agentic micro harnesses with:
- prompt packs from Markdown folders
- provider adapters (OpenAI + Anthropic)
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
```

Then run:

```bash
npm run cli:run -- "summarize this task" --agent default --provider openai --model gpt-4.1-mini
```

Useful flags:
- `--agent <name>`
- `--prompts-dir <path>`
- `--provider <openai|anthropic>`
- `--model <name>`
- `--iterations <n>`
- `--checkpoint-every <n>`
- `--state-dir <path>`
- `--plugins <path-to-plugin.js>`

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
