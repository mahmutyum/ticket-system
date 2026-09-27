import { createHmac, randomBytes } from 'node:crypto';

/**
 * Webhook olayları ve kanal biçimleri (SAF fonksiyonlar).
 *
 * Gövdeye iç not metni, public erişim token'ı ya da takip bağlantısı KONMAZ: dış
 * kanallar (Teams/Slack/n8n) talep sahibinin bearer bağlantısını ve iç yazışmayı
 * görmemeli. Personel bağlantısı (oturum gerektirir) verilir.
 */

export const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.priority_changed',
  'ticket.note_added',
  'ticket.user_reply',
  'sla.warning',
  'sla.breached',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'ping';

export interface WebhookTicket {
  id: string;
  number: string;
  subject: string;
  status: string;
  priority: string;
  company: string;
  category: string | null;
  assignee: string | null;
  requester: string;
  url: string;
}

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  ticket: WebhookTicket | null;
  /** Olaya özgü ayrıntı: { from, to } / { kind } / { excerpt } … */
  data: Record<string, unknown>;
}

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** İmza: `sha256=` + HMAC-SHA256(secret, "<timestamp>.<gövde>") — zaman damgası tekrar oynatmayı sınırlar. */
export function signBody(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

const EVENT_TITLES: Record<WebhookEvent, string> = {
  'ticket.created': 'Yeni talep / New request',
  'ticket.status_changed': 'Durum değişti / Status changed',
  'ticket.assigned': 'Talep atandı / Request assigned',
  'ticket.priority_changed': 'Öncelik değişti / Priority changed',
  'ticket.note_added': 'IT yanıtı / IT reply',
  'ticket.user_reply': 'Kullanıcı yanıtı / User reply',
  'sla.warning': '⏳ SLA yaklaşıyor / SLA approaching',
  'sla.breached': '🚨 SLA ihlali / SLA breached',
  ping: 'Test bildirimi / Test notification',
};

/** Olay verisindeki değeri metne çevirir (nesneler JSON olarak). */
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return v === null || v === undefined ? '' : JSON.stringify(v);
}

function detailLine(payload: WebhookPayload): string {
  const d = payload.data;
  switch (payload.event) {
    case 'ticket.status_changed':
    case 'ticket.priority_changed':
      return `${str(d.from)} → ${str(d.to)}`;
    case 'ticket.assigned':
      return `→ ${str(d.to) || '—'}`;
    case 'ticket.note_added':
    case 'ticket.user_reply':
      return str(d.excerpt);
    case 'sla.warning':
    case 'sla.breached':
      return d.kind === 'response' ? 'Yanıt süresi / Response time' : 'Çözüm süresi / Resolution time';
    default:
      return '';
  }
}

/** Microsoft Teams (Workflows / Incoming Webhook) — Adaptive Card mesajı. */
export function teamsBody(payload: WebhookPayload): unknown {
  const t = payload.ticket;
  const detail = detailLine(payload);
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: EVENT_TITLES[payload.event], wrap: true },
          ...(t ? [
            { type: 'TextBlock', text: `**${t.number}** — ${t.subject}`, wrap: true },
            {
              type: 'FactSet',
              facts: [
                { title: 'Şirket', value: t.company },
                { title: 'Durum', value: t.status },
                { title: 'Öncelik', value: t.priority },
                { title: 'Atanan', value: t.assignee ?? '—' },
              ],
            },
          ] : []),
          ...(detail ? [{ type: 'TextBlock', text: detail, wrap: true, isSubtle: true }] : []),
        ],
        actions: t ? [{ type: 'Action.OpenUrl', title: 'Talebi aç / Open', url: t.url }] : [],
      },
    }],
  };
}

/** Slack incoming webhook — Block Kit. Slack biçimlendirme karakterleri kaçışlanır. */
export function slackBody(payload: WebhookPayload): unknown {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const t = payload.ticket;
  const detail = detailLine(payload);
  const headline = t ? `*${EVENT_TITLES[payload.event]}* — <${t.url}|${esc(t.number)}> ${esc(t.subject)}` : `*${EVENT_TITLES[payload.event]}*`;
  return {
    text: t ? `${EVENT_TITLES[payload.event]}: ${t.number} ${t.subject}` : EVENT_TITLES[payload.event],
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headline } },
      ...(t ? [{
        type: 'context',
        elements: [{ type: 'mrkdwn', text: esc(`${t.company} · ${t.status} · ${t.priority} · ${t.assignee ?? '—'}`) }],
      }] : []),
      ...(detail ? [{ type: 'section', text: { type: 'mrkdwn', text: esc(detail) } }] : []),
    ],
  };
}
