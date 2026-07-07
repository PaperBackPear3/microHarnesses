# Runtime interfaces reference

This page documents important runtime contracts and how library consumers should use them.

## 1) Policy + approval flow

For each tool call:

1. `ToolPolicyEngine.evaluate(...)` returns one of `allow`, `deny`, `require_approval`.
2. If `deny`: tool is blocked and a failed tool result is recorded.
3. If `require_approval`: `approvalHandler` is invoked.
4. If approved: tool executes.
5. If denied or no handler configured: tool is blocked.

Design implication: use `require_approval` for actions that may be valid but should be user-mediated.

## 2) Tool authoring contract

Recommended `ToolDefinition` fields for production tools:

- `name`, `description`, `risk`
- `inputSchema` for model-native structured calling
- `inputAnnotations` (`shell_command`, `file_path`, `url`, `text`) to improve policy screening
- optional governance metadata (`riskProfile`, `governance`, tags/capabilities)

Execution expectations:

- respect `context.signal` for abort/timeout behavior
- throw explicit errors (runtime captures them as `{ ok: false, error }`)
- avoid silent fallbacks for invalid inputs

## 3) Channels vs skills vs tools

- **Tools**: action-oriented capabilities called by model plans (filesystem, shell, APIs, etc.)
- **Skills**: reusable higher-level behaviors loaded/executed via skill registry/engine
- **Channels**: message transport primitives for in-process or external communication patterns

Use tools for direct task execution, skills for reusable behavior bundles, and channels when your architecture needs explicit message pathways.

## 4) Declarative agents

`defineAgent(options)` builds an `Agent` from common runtime parts:

- `name`, `role`, `prompt`, `model`
- optional `tools`, `skills`, `prompts`, `context`, `policy`, `modelSelector`,
  `observability`, `sessionStore`, `approvalHandler`
- optional declarative `subagents`

Use `promptFromFile(path, { variables, strictVariables })` to load a markdown
prompt with optional frontmatter (`role`, `modelHint`, `taskTypeHint`,
`safetyMode`) and `{{variable}}` substitution.

Use `defineAgentAsync(options)` when `mcp` servers are configured. MCP tools are
discovered and registered as `mcp__<server>__<tool>` high-risk tools.

## 5) SessionStore filesystem model

State root:

`<stateDir>/sessions/<sessionId>/`

Important files:

- `manifest.json` (session metadata and latest pointers)
- `telemetry/` (`spans.jsonl` / `metrics.jsonl` / `logs.jsonl` — observability output when a `JsonlObservabilityExporter` is wired to the session dir)
- `support-history.jsonl` (support/debug entries)
- `snapshots/*.json` (periodic runtime snapshots)

`loadLatestSnapshot(...)` merges turns across snapshots by turn id to reconstruct latest state.

## 6) Prompt metadata + templating (`FsPromptSource`)

Prompt pack directory:

`<rootDir>/<promptName>/`

Files:

- required: `system.md`
- optional sections: defaults to `developer.md` and `tools.md`
- optional metadata: `prompt.meta.json`

`prompt.meta.json` fields:

- `name`
- `modelHint`
- `taskTypeHint` (`default` | `reasoning` | `fast`)
- `safetyMode`
- `tags`

Templating:

- `{{variable_name}}` placeholders are substituted from provided variables
- `strictVariables: true` throws on missing variables
- `strictVariables: false` emits warning and replaces with empty string

## 7) Provider setup matrix

| Provider | Required env | Optional env | Default base URL |
|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | provider default |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | provider default |
| `ollama` | none (`OLLAMA_API_KEY` optional) | `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` |

For local use, `ollama` is the quickest path because it works without mandatory API key configuration.

Provider adapters may optionally implement `createTokenCounter(model, auth?)`
to supply high-quality model-specific token estimation for context-window
metrics and compaction thresholds.

## 8) Model routing contracts

`ModelRoute` describes a provider/model candidate with optional availability,
max tokens, context window, pricing, and relative cost/speed/intelligence
metadata. `DefaultModelRouter` honors explicit provider/model overrides, filters
available routes and constraints, then scores by `cost`, `speed`,
`intelligence`, `balanced`, or `auto`.

Compositions can expose the catalog to models with `list_model_routes`, which
returns only currently available routes and includes real pricing/context fields
when known.

## 9) Subagent lifecycle

Core exposes two in-process delegation contracts:

- `SubagentRunner.run(options)` blocks until the child agent finishes and returns
  its final summary.
- `SubagentSupervisor.spawn(options)` launches a tracked child and returns a
  handle; `wait(options)` returns completed child summaries and the remaining
  running children.

`wait({ mode: "next" })` is intended for model-facing incremental joins: the
parent run stays open, receives one completed child result, and can decide
whether to wait again. `wait({ mode: "all" })` joins the selected running
snapshot, which is useful for user-facing commands such as CLI `/wait`.

## 10) Tool output artifacts

Large tool output can be stored outside the inline model feedback. Tools use
`captureToolText(...)` to return a truncated preview plus artifact metadata.
The default `tool_output_read` tool reads an artifact by id/path with
offset/max-char or line-range controls.
