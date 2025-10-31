import { nanoid } from "nanoid";
export class EventBus {
    listeners = new Set();
    emit(name, data, correlationId) {
        const event = {
            name,
            timestamp: new Date().toISOString(),
            data,
            correlationId,
            id: nanoid()
        };
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (error) {
                // eslint-disable-next-line no-console
                console.error("Event listener error", error);
            }
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
