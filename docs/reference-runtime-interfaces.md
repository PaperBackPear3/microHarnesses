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

## 4) SessionStore filesystem model

State root:

`<stateDir>/sessions/<sessionId>/`

Important files:

- `manifest.json` (session metadata and latest pointers)
- `telemetry/` (`spans.jsonl` / `metrics.jsonl` / `logs.jsonl` — observability output when a `JsonlObservabilityExporter` is wired to the session dir)
- `support-history.jsonl` (support/debug entries)
- `snapshots/*.json` (periodic runtime snapshots)

`loadLatestSnapshot(...)` merges turns across snapshots by turn id to reconstruct latest state.

## 5) Prompt metadata + templating (`FsPromptSource`)

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

## 6) Provider setup matrix

| Provider | Required env | Optional env | Default base URL |
|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | provider default |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | provider default |
| `ollama` | none (`OLLAMA_API_KEY` optional) | `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` |

For local use, `ollama` is the quickest path because it works without mandatory API key configuration.
