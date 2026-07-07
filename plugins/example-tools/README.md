# @micro-harnesses/plugin-example-tools

Reference tool/channel plugins for [`@micro-harnesses/core`](../../packages/core). Doubles
as plugin-authoring examples — read
[`src/exampleToolsPlugin.ts`](src/exampleToolsPlugin.ts) and
[`src/exampleChannelsPlugin.ts`](src/exampleChannelsPlugin.ts) as templates for
writing your own.

## Latest updates

- Provides low-risk `echo` and `time` reference tools plus a webhook-backed
  example channel plugin.

## Ships

| Tool | Description | Risk |
|---|---|---|
| `echo` | Returns input text as-is | low |
| `time` | Returns current ISO time | low |

## Channel plugin

`ExampleWebhookChannelPlugin` registers a `ChannelAdapter` with transport
`http`, dry-run support, and optional delivery through `endpointUrl` or
`MH_EXAMPLE_WEBHOOK_URL`.

## Install

```bash
npm install @micro-harnesses/core @micro-harnesses/plugin-example-tools
```

## Usage

```ts
import {
  exampleToolsPlugin,
  exampleWebhookChannelPlugin,
} from "@micro-harnesses/plugin-example-tools";

await pluginHost.register([exampleToolsPlugin, exampleWebhookChannelPlugin]);
```

Or grab the raw tools:

```ts
import { echoTool, timeTool } from "@micro-harnesses/plugin-example-tools";

toolRegistry.register(echoTool);
toolRegistry.register(timeTool);
```

## Capabilities

`exampleToolsPlugin`: `["tools"]`.

`exampleWebhookChannelPlugin`: `["channels"]`.

## License

MIT
