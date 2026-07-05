# @micro-harnesses/cli

`mh` / `micro-harness` is the v2 interactive development assistant built on
`@micro-harnesses/core`.

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
- `--iterations <n>`
- `--snapshot-every <n>`
- `--max-tokens <n>`
- `--no-safety`

## TUI slash commands

- Modes: `/plan`, `/edits`, `/autopilot`, `/mode <...>`
- Model/provider: `/model <id>`, `/provider <id>`, `/effort <...>`
- Sessions: `/new`, `/sessions`, `/session <id>`, `/resume <id>`
- Screens: `/chat`, `/context`, `/telemetry`, `/help` (or `/commands`)
- Control: `/clear`, `/exit`

## Keybindings

- `Enter` send prompt
- `Shift+Tab` cycle mode (Plan → Accept-edits → Autopilot)
- `y / n / a` resolve pending approval (approve / reject / always allow tool)
- `Esc` or `Ctrl+C` interrupt current run
- `Ctrl+D` exit
