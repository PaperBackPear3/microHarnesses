import type { EventSink, ExecutionEventType } from "../events/types";
import type { SessionStore } from "../session/sessionStore";

export interface RunEmitterDeps {
  eventSink: EventSink;
  sessionStore?: SessionStore;
}

export interface RunEmitterBinding {
  runId: string;
  sessionId?: string;
}

/**
 * Emits execution events and support-history entries for a single run,
 * fanning out to the event sink and, when a session exists, the session store.
 */
export class RunEmitter {
  private readonly deps: RunEmitterDeps;
  private readonly binding: RunEmitterBinding;

  constructor(deps: RunEmitterDeps, binding: RunEmitterBinding) {
    this.deps = deps;
    this.binding = binding;
  }

  get runId(): string {
    return this.binding.runId;
  }

  get sessionId(): string | undefined {
    return this.binding.sessionId;
  }

  async emit(type: ExecutionEventType, payload: Record<string, unknown>): Promise<void> {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      runId: this.binding.runId,
      payload,
    };
    await this.deps.eventSink.push(event);
    if (this.deps.sessionStore && this.binding.sessionId) {
      await this.deps.sessionStore.appendEvent(this.binding.sessionId, event);
    }
  }

  async support(data: Record<string, unknown>): Promise<void> {
    if (this.deps.sessionStore && this.binding.sessionId) {
      await this.deps.sessionStore.appendSupportHistory(this.binding.sessionId, {
        runId: this.binding.runId,
        ...data,
      });
    }
  }
}
