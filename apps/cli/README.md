# @micro-harnesses/cli

`mh` / `micro-harness` is the v2 interactive development assistant built on
`@micro-harnesses/core`.

The running version is shown in the TUI footer and via:

```bash
npx mh --version
```

## Install

```bash
npm install @micro-harnesses/cli
```

## After install

Run the CLI from the project that installed it:

```bash
npx mh
```

Or run a one-off prompt:

```bash
npx mh -p "list apps/cli/src/app"
```

If you want the binary on every shell without `npx`, add a script or install it globally.

## Update

If you already installed the CLI, update it with:

```bash
npm install @micro-harnesses/cli@latest
```

Then re-run `npx mh` (or your local script) to pick up the new version.

If `npx mh` behaves differently than your local build, force latest to bypass
stale npx cache entries:

```bash
npx @micro-harnesses/cli@latest
```

## UX notes

- Chat input/composer is anchored at the bottom of the terminal.
- Runtime status (mode/model/context/usage/subagents/compression) is rendered in a footer below input to keep the typing area clean.
- Running and recently completed subagents are shown in the transcript so delegated work is not hidden.
- In autopilot mode, prompts are augmented with an execution contract that pushes the agent to continue until the requested goal is finished.

## Context compression

The CLI compacts based on **estimated context usage**, not only turn count.
At each iteration, `ContextManager.buildWorkingTurns(...)` estimates token usage
for what is actually sent (summary + working turns + tool feedback text), then
triggers compaction when either condition is exceeded:

- turn window overflow (`maxWorkingTurns`, currently `16`)
- token utilization over the trigger threshold (default **85%**)

Compaction uses hysteresis (target default **70%**) so it drops enough history
in one batch and avoids recompacting every new turn.

### Ollama context window sizing

For `--provider ollama`, the CLI resolves context window tokens dynamically from
the selected model by calling Ollama `POST /api/show` and parsing context-length
metadata. If detection is unavailable, it falls back to a conservative local
default (`8192`) instead of assuming a very large window.

For non-Ollama providers, the CLI uses the default window (`128000`) unless you
customize core composition.

### Token counting quality

Context usage is estimated with provider-aware token counters:

- OpenAI-compatible providers use `js-tiktoken`.
- Providers can register custom counters via adapter `createTokenCounter(...)`.
- Runtime usage (`model.usage.inputTokens`) continuously calibrates estimates,
  so compaction/utilization converge even when tokenizer coverage is imperfect.

### Default vs agentic compressor

- **Default compressor** (`@micro-harnesses/core`): deterministic heuristic
  scoring (recency/impact/goal-keyword match), no model calls.
- **Agentic compressor** (`@micro-harnesses/plugin-agentic-compression`, used by
  this CLI): spawns two subagents in parallel:
  - `context-summarizer` for `SUMMARY` + `HIGHLIGHTS`
  - `goal-finder` for refined `GOAL` + `SUBGOALS`

Both subagents inherit the CLI's currently selected provider/model/effort.
If subagent compression fails, it falls back to the default deterministic
compressor.

## Commands

- `mh` — start chat TUI
- `mh -p "prompt"` — headless single prompt
- `mh -p "prompt" --json` — machine-readable output
- `mh sessions list` — list saved sessions (JSON)
- `mh sessions show <session-id>` — show one session (JSON)

## Runtime flags

- `--provider <openai|anthropic|ollama>`
- `--model <model-id>`
- `--effort <low|medium|high>`
- `--mode <plan|accept-edits|autopilot>`
- `--session <id>`
- `--state-dir <path>`
- `--skills-dir <path>` — directory of FS skills (`<name>/SKILL.md` bundles); default `<state-dir>/skills`
- `--iterations <n>`
- `--snapshot-every <n>`
- `--max-tokens <n>`
- `--compaction-trigger <0..1>`
- `--compaction-target <0..1>`
- `--turn-compaction-target <0..1>`
- `--non-turn-token-reserve <n>`
- `--no-safety`

## TUI slash commands

- Modes: `/plan`, `/edits`, `/autopilot`, `/mode <...>`
- Model/provider: `/model <id>`, `/provider <id>`, `/effort <...>`
- Sessions: `/new`, `/sessions`, `/session <id>`, `/resume <id>`
- Screens: `/chat`, `/context`, `/telemetry`, `/help` (or `/commands`)
- Compression: `/compact` (force a compaction pass for the active session)
- Subagents: `/wait` (user-facing wait-all over currently running subagents; models use the `wait_subagents` tool)
- Control: `/clear`, `/exit`

## Keybindings

- `Enter` send prompt
- `Shift+Tab` cycle mode (Plan → Accept-edits → Autopilot)
- `Ctrl+T` toggle latest thinking collapse
- `y / n / a` resolve pending approval (approve / reject / always allow tool)
- `Esc` or `Ctrl+C` interrupt current run
- `Ctrl+D` exit
- `/help` (or `/commands`) shows the complete command + shortcut list
