import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store';
import api from '../api/client';

interface SSEOptions {
  onTicketCreated?: (data: unknown) => void;
  onTicketUpdated?: (data: unknown) => void;
  onNoteAdded?: (data: unknown) => void;
  enabled?: boolean;
}

const MAX_RETRIES = 10;
const BASE_DELAY = 1000;

export function useStaffSSE(options: SSEOptions) {
  const { onTicketCreated, onTicketUpdated, onNoteAdded, enabled = true } = options;
  const eventSourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const token = useAuthStore((s) => s.accessToken);

  const connect = useCallback(async () => {
    if (!token) return;

    // EventSource header gönderemez, bu yüzden kimlik URL'den geçmek zorunda.
    // JWT'yi doğrudan koymak yerine tek kullanımlık, 30 sn ömürlü bir BİLET
    // alınır: URL nginx access_log'una düşer ve oraya 15 dakikalık bir oturum
    // token'ı yazmak istemiyoruz. Bilet sunucuda okunduğu anda silinir.
    let ticket: string;
    try {
      ticket = (await api.post('/events/ticket-grant')).data.data.ticket;
    } catch {
      // Yetki yoksa/başarısızsa sessizce vazgeç — SSE bir kolaylıktır,
      // sayfanın çalışması ona bağlı değil.
      return;
    }

    const es = new EventSource(`/api/events/staff?ticket=${encodeURIComponent(ticket)}`);
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
        setTimeout(() => void connect(), delay);
      }
    };
  }, [token, onTicketCreated, onTicketUpdated, onNoteAdded]);

  useEffect(() => {
    if (!enabled || !token) return;

    void connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      retriesRef.current = 0;
    };
  }, [enabled, token, connect]);
}

export function useTicketSSE(accessToken: string | undefined, onUpdate?: (data: unknown) => void) {
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
