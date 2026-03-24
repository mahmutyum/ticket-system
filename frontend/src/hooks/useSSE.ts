import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store';

interface SSEOptions {
  onTicketCreated?: (data: any) => void;
  onTicketUpdated?: (data: any) => void;
  onNoteAdded?: (data: any) => void;
  enabled?: boolean;
}

const MAX_RETRIES = 10;
const BASE_DELAY = 1000;

export function useStaffSSE(options: SSEOptions) {
  const { onTicketCreated, onTicketUpdated, onNoteAdded, enabled = true } = options;
  const eventSourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const token = useAuthStore((s) => s.accessToken);

  const connect = useCallback(() => {
    if (!token) return;

    // Pass token as query param since EventSource can't send headers
    const es = new EventSource(`/api/events/staff?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.addEventListener('ticket_created', (e) => {
      try { onTicketCreated?.(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('ticket_updated', (e) => {
      try { onTicketUpdated?.(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('note_added', (e) => {
      try { onNoteAdded?.(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('connected', () => {
      retriesRef.current = 0; // Reset on successful connection
    });

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      // Exponential backoff reconnect
      if (retriesRef.current < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retriesRef.current);
        retriesRef.current++;
        setTimeout(connect, delay);
      }
    };
  }, [token, onTicketCreated, onTicketUpdated, onNoteAdded]);

  useEffect(() => {
    if (!enabled || !token) return;

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      retriesRef.current = 0;
    };
  }, [enabled, token, connect]);
}

export function useTicketSSE(accessToken: string | undefined, onUpdate?: (data: any) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);

  const connect = useCallback(() => {
    if (!accessToken) return;

    const es = new EventSource(`/api/events/ticket/${accessToken}`);
    eventSourceRef.current = es;

    es.addEventListener('ticket_updated', (e) => {
      try { onUpdate?.(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('note_added', (e) => {
      try { onUpdate?.(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      if (retriesRef.current < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retriesRef.current);
        retriesRef.current++;
        setTimeout(connect, delay);
      }
    };
  }, [accessToken, onUpdate]);

  useEffect(() => {
    if (!accessToken) return;

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      retriesRef.current = 0;
    };
  }, [accessToken, connect]);
}
