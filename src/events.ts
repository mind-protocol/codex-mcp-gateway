import { nanoid } from "nanoid";

export type EventName =
  | "codex.task.requested"
  | "codex.task.accepted"
  | "codex.task.completed"
  | "pr.reviewed"
  | "pr.gated"
  | "pr.merged";

export interface EventPayload {
  name: EventName;
  timestamp: string;
  data: Record<string, unknown>;
  correlationId?: string;
  id: string;
}

export type EventListener = (event: EventPayload) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  public emit(name: EventName, data: Record<string, unknown>, correlationId?: string) {
    const event: EventPayload = {
      name,
      timestamp: new Date().toISOString(),
      data,
      correlationId,
      id: nanoid()
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Event listener error", error);
      }
    }
  }

  public subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
