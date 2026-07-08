const ENABLE_MODIFY_OTHER_KEYS = "\u001b[>4;2m";
const DISABLE_MODIFY_OTHER_KEYS = "\u001b[>4;0m";
const ENABLE_KITTY_KEYBOARD = "\u001b[>1u";
const DISABLE_KITTY_KEYBOARD = "\u001b[>0u";

export function enableKeyboardEnhancements(): void {
  process.stdout.write(`${ENABLE_MODIFY_OTHER_KEYS}${ENABLE_KITTY_KEYBOARD}`);
}

export function disableKeyboardEnhancements(): void {
  process.stdout.write(`${DISABLE_KITTY_KEYBOARD}${DISABLE_MODIFY_OTHER_KEYS}`);
}
