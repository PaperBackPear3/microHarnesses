import { useSyncExternalStore } from "react";
import type { ChatStore } from "./chatStore.js";

export function useChatStore(store: ChatStore) {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  );
}
