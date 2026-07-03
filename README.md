# microHarnesses

Tiny, CLI-first framework for AI micro harnesses with:
- tool support
- loop orchestration
- lightweight context management (compress, checkpoint, discard)
- local agent spawning
- plugin extension points

## Install

```bash
npm install
npm run build
```

## Run

```bash
node dist/cli.js run "tool:echo hello and tell me time spawn: summarize this"
```

Useful flags:
- `--iterations <n>`
- `--checkpoint-every <n>`
- `--state-dir <path>`
- `--plugins <path-to-plugin.js>`

## Checkpoints

```bash
node dist/cli.js checkpoints list
node dist/cli.js checkpoints show <checkpoint-id>
node dist/cli.js checkpoints delete <checkpoint-id>
```

## Plugin shape

```js
module.exports = {
  name: "my-plugin",
  register(api) {
    api.registerTool({
      name: "upper",
      description: "Uppercases text",
      async execute(input) {
        return { text: String(input.text || "").toUpperCase() };
      }
    });
  }
};
```

## Code map

- `src/cli.ts` – CLI entrypoint
- `src/core/runtime.ts` – loop coordinator
- `src/tools/registry.ts` – tool registration/dispatch
- `src/context/manager.ts` – compression/checkpoint/discard
- `src/agents/localSpawner.ts` and `src/agents/worker.ts` – local process workers
- `src/plugins/loader.ts` – plugin loading

## Notes

This MVP uses a small rule-based adapter (`src/model/ruleBasedAdapter.ts`) as a stand-in model.
Swap it with a real model adapter while keeping the same `ModelAdapter` contract.
