# @micro-harnesses/plugin-example-tools

Reference tool plugin for [`@micro-harnesses/core`](../core). Doubles as a
plugin-authoring example — read the source
([`src/exampleToolsPlugin.ts`](src/exampleToolsPlugin.ts)) as a template for
writing your own.

## Ships

| Tool | Description | Risk |
|---|---|---|
| `echo` | Returns input text as-is | low |
| `time` | Returns current ISO time | low |

## Install

```bash
npm install @micro-harnesses/core @micro-harnesses/plugin-example-tools
```

## Usage

```ts
import { exampleToolsPlugin } from "@micro-harnesses/plugin-example-tools";

await pluginHost.register([exampleToolsPlugin]);
```

Or grab the raw tools:

```ts
import { echoTool, timeTool } from "@micro-harnesses/plugin-example-tools";

toolRegistry.register(echoTool);
toolRegistry.register(timeTool);
```

## Capabilities

`["tools"]`.

## License

MIT
