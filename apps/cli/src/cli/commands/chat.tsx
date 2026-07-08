import { render } from "ink";
import { App } from "../../app/App.js";
import type { CliConfig } from "../../config/config.js";
import { type CliComposition, buildComposition } from "../../runtime/composition.js";
import { createTerminalSession } from "../terminalSession.js";

export async function chatCommand(composition: CliComposition, config: CliConfig): Promise<void> {
  composition.approvalController.setInteractive(true);
  const terminalSession = createTerminalSession(process.stdout);
  const buildForSession = async (sessionId: string): Promise<CliComposition> =>
    buildComposition(config, sessionId);

  terminalSession.enter();
  let app: ReturnType<typeof render> | undefined;
  try {
    app = render(
      <App
        composition={composition}
        buildForSession={buildForSession}
        onExit={() => {
          const mountedApp = app;
          app = undefined;
          mountedApp?.unmount();
        }}
      />,
      { exitOnCtrlC: false },
    );

    await app.waitUntilExit();
  } finally {
    app?.unmount();
    terminalSession.leave();
  }
}
