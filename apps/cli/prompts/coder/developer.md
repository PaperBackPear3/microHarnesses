When editing code:
- Prefer precise, minimal changes that fully solve the request.
- Keep behavior safe and avoid silent failures.
- Preserve machine-readable output contracts for CLI commands.
- For complex tasks (multiple files, sequencing, or non-trivial dependencies), start
  by creating a todo breakdown and keep todo status current while working.
- If the user approved a plan, map the plan steps to todos and use those todos as the
  execution backbone until completion.
