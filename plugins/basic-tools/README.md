# @micro-harnesses/plugin-basic-tools

Workspace-scoped filesystem mutation and shell execution plugin for [`@micro-harnesses/core`](../../packages/core).

## Ships

| Tool | Description | Risk |
|---|---|---|
| `fs_write` | Write/overwrite text file | high |
| `fs_append` | Append text to file | high |
| `fs_mkdir` | Create directory | high |
| `fs_move` | Move/rename path | high |
| `fs_remove` | Remove file/directory | high |
| `shell_exec` | Execute shell command in workspace with timeout and bounded output | high |

## Install

```bash
npm install @micro-harnesses/core @micro-harnesses/plugin-basic-tools
```

## Usage

```ts
import { BasicToolsPlugin } from "@micro-harnesses/plugin-basic-tools";

await pluginHost.register([
  new BasicToolsPlugin({
    rootDir: process.cwd(),
    defaultShellTimeoutMs: 20_000,
    maxShellTimeoutMs: 120_000,
  }),
]);
```

## Options

| Option | Default | Description |
|---|---|---|
| `rootDir` | `process.cwd()` | Restricts all file/shell tool paths |
| `maxReadChars` | `100000` | File read cap used by helper internals |
| `maxListEntries` | `1000` | Directory listing cap |
| `maxTraversalDepth` | `8` | Max traversal depth |
| `maxSearchFiles` | `300` | Search file cap |
| `maxSearchMatches` | `300` | Search match cap |
| `defaultShellTimeoutMs` | `20000` | Default command timeout |
| `maxShellTimeoutMs` | `120000` | Max allowed timeout override |
| `maxShellOutputChars` | `80000` | Combined stdout/stderr cap |

## Safety notes

- All paths are resolved relative to `rootDir`.
- `shell_exec` supports abort signals and timeout-based termination.
- Tools are intentionally `high` risk so policy engines can enforce approvals/denials.

## Capabilities

`["tools"]`.

## License

MIT
