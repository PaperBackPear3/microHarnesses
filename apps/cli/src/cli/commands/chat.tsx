import { render } from "ink";
import React from "react";
import type { CliComposition } from "../../runtime/composition";
import { App } from "../../app/App";

export async function chatCommand(composition: CliComposition): Promise<void> {
  await new Promise<void>((resolve) => {
    const app = render(
      <App
        composition={composition}
        onExit={() => {
          app.unmount();
          resolve();
        }}
      />,
    );
  });
}
