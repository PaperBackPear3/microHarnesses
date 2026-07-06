import { render } from "ink";
import React from "react";
import { App } from "../../app/App";
import type { CliConfig } from "../../config/config";
import { type CliComposition, buildComposition } from "../../runtime/composition";

export async function chatCommand(composition: CliComposition, config: CliConfig): Promise<void> {
  composition.approvalController.setInteractive(true);
  const buildForSession = async (sessionId: string): Promise<CliComposition> =>
    buildComposition(config, sessionId);

  await new Promise<void>((resolve) => {
    const app = render(
      <App
        composition={composition}
        buildForSession={buildForSession}
        onExit={() => {
          app.unmount();
          resolve();
        }}
      />,
    );
  });
}
