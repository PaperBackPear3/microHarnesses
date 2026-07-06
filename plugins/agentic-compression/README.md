# @micro-harnesses/plugin-agentic-compression

Agentic context-compression plugin for [`@micro-harnesses/core`](../core).

Instead of scoring turns heuristically (like the core `defaultCompressor`), this
plugin compresses overflowed context turns by spawning two subagents in
parallel via `PluginApi.agents.spawn`:

| Subagent | Prompt persona (default) | Produces |
|---|---|---|
| Summarizer | `context-summarizer` | A short summary + highlight bullets |
| Goal-finder | `goal-finder` | The current, most accurate goal + sub-goals |

Both subagents run with `allowedTools: []` (pure reasoning, no side effects)
and inherit whatever model/provider/effort the host composition currently has
selected — they're built by the same `SubagentRuntimeFactory` the rest of the
app uses, so there's nothing extra to wire for that.

The plugin never lets compression break a run: if spawning fails for any
reason (no model/provider configured, transient error, etc.) it falls back to
a deterministic compressor (`defaultCompressor` by default).

## Install

```bash
npm install @micro-harnesses/core @micro-harnesses/plugin-agentic-compression
```

## Usage

```ts
import { AgenticCompressionPlugin } from "@micro-harnesses/plugin-agentic-compression";

await pluginHost.register([new AgenticCompressionPlugin()]);
```

The host app must provide prompt packs for the two subagent personas (default
names `context-summarizer` and `goal-finder`), instructing the model to reply
in the expected `SUMMARY:`/`HIGHLIGHTS:` and `GOAL:`/`SUBGOALS:` formats.

## Options

| Option | Default | Description |
|---|---|---|
| `summarizerPromptName` | `"context-summarizer"` | Prompt persona for the summarizer subagent |
| `goalFinderPromptName` | `"goal-finder"` | Prompt persona for the goal-finder subagent |
| `maxIterations` | `2` | Iteration cap for each subagent run |
| `maxTranscriptChars` | `6000` | Max transcript characters included per subagent prompt |
| `maxHighlights` | `8` | Max highlights kept in the final result |
| `fallback` | `defaultCompressor` | Compressor used when subagent spawning fails |

## `CompressionResult.refinedGoal`

The goal-finder subagent can rediscover a more accurate goal mid-run. When its
output differs from the goal `ContextManager` currently has, this plugin sets
`CompressionResult.refinedGoal`, which `ContextManager` adopts for later
compression cycles in the same run. `defaultCompressor` never sets this field.

## Capabilities

`["compressor", "agents"]` — declared for `PluginApi.setCompressor` and
`PluginApi.agents.spawn`.

## Swapping strategies

Compression stays pluggable at the library level: register this plugin to use
the agentic strategy, or omit it (and any other compressor plugin) to keep
`@micro-harnesses/core`'s default heuristic `defaultCompressor`. Only one
plugin may claim the `compressor` capability per composition.

## License

MIT
