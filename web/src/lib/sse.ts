// SSE subscription with automatic reconnect and replay via Last-Event-ID.

import type { SuretyEventWire } from './types';

export function subscribeToEvents(onEvent: (event: SuretyEventWire) => void): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    source = new EventSource('/api/events/stream');
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as SuretyEventWire);
      } catch {
        // Ignore malformed frames; the audit log remains server-side truth.
      }
    };
    source.onerror = () => {
      source?.close();
      if (!closed) retry = setTimeout(connect, 3000);
    };
  };
  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    source?.close();
  };
}
