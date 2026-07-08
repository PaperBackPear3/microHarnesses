import { spawnSync } from "node:child_process";

const CLIPBOARD_TIMEOUT_MS = 2_000;

export function copyToClipboard(text: string): void {
  if (trySystemClipboard(text)) {
    return;
  }
  writeOsc52(text);
}

function trySystemClipboard(text: string): boolean {
  if (process.platform === "darwin") {
    const result = spawnSync("pbcopy", [], {
      input: text,
      encoding: "utf8",
      timeout: CLIPBOARD_TIMEOUT_MS,
    });
    return result.status === 0;
  }
  if (process.platform === "linux") {
    const wl = spawnSync("wl-copy", [], {
      input: text,
      encoding: "utf8",
      timeout: CLIPBOARD_TIMEOUT_MS,
    });
    if (wl.status === 0) return true;
    const xclip = spawnSync("xclip", ["-selection", "clipboard"], {
      input: text,
      encoding: "utf8",
      timeout: CLIPBOARD_TIMEOUT_MS,
    });
    return xclip.status === 0;
  }
  return false;
}

function writeOsc52(text: string): void {
  const base64 = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\u001b]52;c;${base64}\u0007`);
}
