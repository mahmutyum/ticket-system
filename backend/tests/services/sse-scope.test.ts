import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { addClient, broadcastToStaff, broadcastToTicket, getClientCount } from '../../src/services/sse.service.js';

/**
 * SSE şirket kapsamı.
 *
 * REST katmanı kapsamı titizlikle uygularken bu kanalın tek filtresi
 * `type === 'staff'` idi: her personel her şirketin yayınını alıyordu — ticket
 * konuları, müşteri e-postaları ve yanıt gövdeleri dahil. Yani rol
 * kapsamlandırmasının tamamı gerçek zamanlı kanalda baypas ediliyordu.
 *
 * Bu testler o kapıyı tutar. Kırılıyorlarsa çapraz şirket sızıntısı geri gelmiştir.
 */

/** Yazılan SSE çerçevelerini toplayan sahte reply. */
function fakeReply() {
  const written: string[] = [];
  const handlers: Record<string, () => void> = {};
  return {
    written,
    reply: {
      raw: {
        writeHead: () => {},
        write: (chunk: string) => written.push(chunk),
        on: (ev: string, cb: () => void) => { handlers[ev] = cb; },
      },
    } as unknown as FastifyReply,
    close: () => handlers.close?.(),
  };
}

/** Bağlantı anındaki "connected" çerçevesini sayma. */
const events = (written: string[]) => written.filter((w) => !w.startsWith('event: connected'));

function connectStaff(scope: string[] | null) {
  const f = fakeReply();
  addClient(f.reply, 'staff', {
    staff: { staffId: 's1', companyScope: scope, resolveScope: async () => scope },
  });
  return f;
}

beforeEach(() => {
  // Her testte bağlantıları kapat — modül seviyesindeki map paylaşılıyor.
  vi.useRealTimers();
});

describe('broadcastToStaff — şirket kapsamı', () => {
  it('kapsam içindeki şirketin yayınını gönderir', () => {
    const f = connectStaff(['co-1']);
    broadcastToStaff('ticket_created', { subject: 'gizli' }, 'co-1');
    expect(events(f.written)).toHaveLength(1);
    expect(events(f.written)[0]).toContain('gizli');
    f.close();
  });

  it('kapsam DIŞI şirketin yayınını GÖNDERMEZ', () => {
    // Regresyon: eskiden tek filtre type==='staff' idi, bu yayın giderdi.
    const f = connectStaff(['co-1']);
    broadcastToStaff('user_reply', { email: 'musteri@baska.com', content: 'gizli mesaj' }, 'co-9');
    expect(events(f.written)).toHaveLength(0);
    f.close();
  });

  it('admin (scope=null) her şirketin yayınını alır', () => {
    const f = connectStaff(null);
    broadcastToStaff('ticket_created', { subject: 'x' }, 'co-1');
    broadcastToStaff('ticket_created', { subject: 'y' }, 'co-9');
    expect(events(f.written)).toHaveLength(2);
    f.close();
  });

  it('admin şirketsiz (companyId=null) yayını alır', () => {
    const f = connectStaff(null);
    broadcastToStaff('task_created', { taskId: 't1' }, null);
    expect(events(f.written)).toHaveLength(1);
    f.close();
  });

  it('kapsamlı kullanıcı şirketsiz (companyId=null) yayını ALMAZ', () => {
    // Global kayıt politikasıyla tutarlı: şirkete bağlı olmayan olay admin'e özel.
    const f = connectStaff(['co-1']);
    broadcastToStaff('task_created', { taskId: 't1' }, null);
    expect(events(f.written)).toHaveLength(0);
    f.close();
  });

  it('ataması olmayan personel (boş kapsam) hiçbir yayın almaz', () => {
    const f = connectStaff([]);
    broadcastToStaff('ticket_created', { subject: 'x' }, 'co-1');
    broadcastToStaff('ticket_created', { subject: 'y' }, null);
    expect(events(f.written)).toHaveLength(0);
    f.close();
  });

  it('iki personeli birbirinden ayırır', () => {
    const a = connectStaff(['co-1']);
    const b = connectStaff(['co-2']);
    broadcastToStaff('ticket_created', { subject: 'sadece-co1' }, 'co-1');

    expect(events(a.written)).toHaveLength(1);
    expect(events(a.written)[0]).toContain('sadece-co1');
    expect(events(b.written)).toHaveLength(0);
    a.close();
    b.close();
  });

  it('public istemciye staff yayını gitmez', () => {
    const p = fakeReply();
    addClient(p.reply, 'public', { ticketAccessToken: 'tok' });
    broadcastToStaff('ticket_created', { subject: 'x' }, 'co-1');
    expect(events(p.written)).toHaveLength(0);
    p.close();
  });
});

describe('broadcastToTicket — public kanal', () => {
  it('yalnızca eşleşen accessToken sahibine gider', () => {
    const a = fakeReply();
    const b = fakeReply();
    addClient(a.reply, 'public', { ticketAccessToken: 'tok-a' });
    addClient(b.reply, 'public', { ticketAccessToken: 'tok-b' });

    broadcastToTicket('tok-a', 'ticket_updated', { status: 'resolved' });

    expect(events(a.written)).toHaveLength(1);
    expect(events(b.written)).toHaveLength(0);
    a.close();
    b.close();
  });
});

describe('bağlantı yönetimi', () => {
  it('kapanan bağlantı listeden düşer', () => {
    const before = getClientCount().staff;
    const f = connectStaff(['co-1']);
    expect(getClientCount().staff).toBe(before + 1);
    f.close();
    expect(getClientCount().staff).toBe(before);
  });
});
