#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { createRevenueOpsServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { server } = createRevenueOpsServer(config);
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });
  process.stdout.write(
    `revenue-ops listening on http://${config.host}:${config.port} using ${config.provider}/${config.model}\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
