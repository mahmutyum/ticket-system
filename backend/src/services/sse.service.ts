import { FastifyReply } from 'fastify';
import { isCompanyInScope } from '../utils/staff-scope.js';

interface SSEClient {
  id: string;
  reply: FastifyReply;
  type: 'staff' | 'public';
  /** public istemciler için: yalnızca bu ticket'ın olaylarını alır. */
  ticketAccessToken?: string;

  // --- staff istemciler için ---
  staffId?: string;
  /**
   * Şirket kapsamı. `null` = admin (sınırsız), dizi = yalnızca bu şirketler,
   * boş dizi = hiçbir şey. `undefined` asla olmamalı — olursa fail-closed
   * davranıp hiçbir şey gönderilmez.
   */
  companyScope?: string[] | null;
  /**
   * Kapsamı DB'den yeniden çözer. Bağlantı uzun ömürlüdür ve kapsam her istekte
   * DB'den okunacak şekilde tasarlanmıştır (bkz. staff-scope.ts) — bu yüzden
   * keep-alive turunda tazelenir, yoksa bir personelin şirket ataması
   * kaldırıldığında açık SSE bağlantısı veri akıtmaya devam ederdi.
   */
  resolveScope?: () => Promise<string[] | null>;
}

const clients: Map<string, SSEClient> = new Map();

let clientIdCounter = 0;

export interface StaffClientContext {
  staffId: string;
  companyScope: string[] | null;
  resolveScope: () => Promise<string[] | null>;
}

export function addClient(
  reply: FastifyReply,
  type: 'staff' | 'public',
  options?: { ticketAccessToken?: string; staff?: StaffClientContext },
): string {
  const id = `sse-${++clientIdCounter}`;

  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx buffering off
  });

  // Send initial connection event
  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

  clients.set(id, {
    id,
    reply,
    type,
    ticketAccessToken: options?.ticketAccessToken,
    staffId: options?.staff?.staffId,
    companyScope: options?.staff?.companyScope,
    resolveScope: options?.staff?.resolveScope,
  });

  // Remove on close
  reply.raw.on('close', () => {
    clients.delete(id);
  });

  return id;
}

/**
 * Staff kanalına yayın yapar — YALNIZCA olayın şirketine yetkili olanlara.
 *
 * `companyId` ZORUNLUDUR ve bilinçli olarak öyle tasarlanmıştır: yeni bir yayın
 * eklendiğinde derleyici çağıranı olayın hangi şirkete ait olduğunu söylemeye
 * zorlar. Önceden tek filtre `type === 'staff'` idi ve her personel her şirketin
 * yayınını alıyordu — REST katmanındaki kapsam denetimi sessizce baypas
 * ediliyordu (müşteri e-postaları ve mesaj gövdeleri dahil).
 *
 * `companyId = null` → şirkete bağlı olmayan olay; yalnızca admin görür.
 * Bu, kasadaki/kategorilerdeki "global kayıt yalnızca admin" politikasıyla aynıdır.
 */
export function broadcastToStaff(event: string, data: unknown, companyId: string | null): void {
  for (const client of clients.values()) {
    if (client.type !== 'staff') continue;

    // companyScope undefined ise (olmamalı) fail-closed: hiçbir şey gönderme.
    const scope = client.companyScope === undefined ? [] : client.companyScope;
    if (!isCompanyInScope(scope, companyId)) continue;

    try {
      client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function broadcastToTicket(accessToken: string, event: string, data: unknown): void {
  for (const client of clients.values()) {
    if (client.type === 'public' && client.ticketAccessToken === accessToken) {
      try {
        client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clients.delete(client.id);
      }
    }
  }
}

export function getClientCount(): { staff: number; public: number } {
  let staff = 0;
  let publicCount = 0;
  for (const client of clients.values()) {
    if (client.type === 'staff') staff++;
    else publicCount++;
  }
  return { staff, public: publicCount };
}

/**
 * Bağlı staff istemcilerinin kapsamını DB'den tazeler.
 *
 * Kapsam bağlantı anında çözülür ama bağlantı saatlerce açık kalabilir. Tazeleme
 * olmasa, bir personelin şirket ataması kaldırıldığında açık bağlantısı o şirketin
 * verisini almaya devam ederdi. Tazeleme başarısız olursa fail-closed: kapsam boş
 * diziye çekilir, yani o istemci yayın almaz.
 */
async function refreshStaffScopes(): Promise<void> {
  for (const client of clients.values()) {
    if (client.type !== 'staff' || !client.resolveScope) continue;
    try {
      client.companyScope = await client.resolveScope();
    } catch {
      client.companyScope = [];
    }
  }
}

// Keep-alive ping every 30 seconds — kapsam da bu turda tazelenir, yani bir
// yetki değişikliğinin açık bağlantıya yansıması en fazla 30 saniye sürer.
setInterval(() => {
  void refreshStaffScopes();
  for (const client of clients.values()) {
    try {
      client.reply.raw.write(`:ping\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }
}, 30000);
