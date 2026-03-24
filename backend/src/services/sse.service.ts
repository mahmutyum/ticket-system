import { FastifyReply } from 'fastify';

interface SSEClient {
  id: string;
  reply: FastifyReply;
  type: 'staff' | 'public';
  ticketAccessToken?: string;
}

const clients: Map<string, SSEClient> = new Map();

let clientIdCounter = 0;

export function addClient(reply: FastifyReply, type: 'staff' | 'public', ticketAccessToken?: string): string {
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

  clients.set(id, { id, reply, type, ticketAccessToken });

  // Remove on close
  reply.raw.on('close', () => {
    clients.delete(id);
  });

  return id;
}

export function broadcastToStaff(event: string, data: any): void {
  for (const client of clients.values()) {
    if (client.type === 'staff') {
      try {
        client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clients.delete(client.id);
      }
    }
  }
}

export function broadcastToTicket(accessToken: string, event: string, data: any): void {
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

// Keep-alive ping every 30 seconds
setInterval(() => {
  for (const client of clients.values()) {
    try {
      client.reply.raw.write(`:ping\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }
}, 30000);
