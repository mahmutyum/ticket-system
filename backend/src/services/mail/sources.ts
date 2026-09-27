import { ImapFlow } from 'imapflow';

/**
 * Posta kutusu kaynakları — IMAP, Microsoft 365 (Graph) ve Gmail (Gmail API).
 *
 * Üçü de aynı sözleşmeyi uygular: okunmamış iletileri HAM MIME olarak getir,
 * işlenmiş olanı okundu işaretle. Ayrıştırma ve iş kuralları kaynaktan bağımsızdır
 * (`parse.ts`, `jobs/mail-fetch.ts`).
 *
 * Microsoft 365 ve Gmail uçları sabit, bilinen host'lardır (SSRF yüzeyi yok).
 * IMAP host'u admin tarafından girildiği için kaydedilirken `assertPublicHost`
 * ile denetlenir (SMTP ile aynı kural).
 */

export interface FetchedMail {
  id: string;
  raw: Buffer;
}

export interface MailSource {
  fetchUnread(limit: number): Promise<FetchedMail[]>;
  markProcessed(id: string): Promise<void>;
  close(): Promise<void>;
}

export type FetchLike = typeof fetch;

const HTTP_TIMEOUT_MS = 20_000;

async function httpJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<T> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) {
    // Yanıt gövdesi hata ayıklama için kısaltılarak iletilir (sır içermez: token uçları
    // yalnızca hata kodu/açıklaması döner).
    const text = (await res.text()).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${new URL(url).host}: ${text}`);
  }
  // Bazı uçlar (Graph PATCH, 204) gövdesiz döner.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ==================== IMAP ====================

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export class ImapSource implements MailSource {
  private client: ImapFlow | null = null;
  private release: (() => void) | null = null;

  constructor(private readonly config: ImapConfig) {}

  private async open(): Promise<ImapFlow> {
    if (this.client) return this.client;
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      socketTimeout: 60_000,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    this.client = client;
    this.release = () => lock.release();
    return client;
  }

  async fetchUnread(limit: number): Promise<FetchedMail[]> {
    const client = await this.open();
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    const result: FetchedMail[] = [];
    for (const uid of uids.slice(0, limit)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (msg && msg.source) result.push({ id: String(uid), raw: msg.source });
    }
    return result;
  }

  async markProcessed(id: string): Promise<void> {
    const client = await this.open();
    await client.messageFlagsAdd(id, ['\\Seen'], { uid: true });
  }

  async close(): Promise<void> {
    this.release?.();
    if (this.client) await this.client.logout().catch(() => undefined);
    this.client = null;
    this.release = null;
  }
}

// ==================== Microsoft 365 (Graph) ====================

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  address: string;
}

/**
 * Uygulama izniyle (client credentials, `Mail.ReadWrite` application permission)
 * paylaşılan/servis posta kutusunu okur. Kullanıcı etkileşimi gerekmez.
 * Kurulumda Exchange "Application Access Policy" ile uygulama yalnızca bu posta
 * kutusuna kısıtlanmalıdır (bkz. docs/kullanim.md).
 */
export class GraphSource implements MailSource {
  private token: string | null = null;

  constructor(private readonly config: GraphConfig, private readonly fetchImpl: FetchLike = fetch) {}

  private get base() {
    return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.address)}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const data = await httpJson<{ access_token: string }>(
      this.fetchImpl,
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } },
    );
    this.token = data.access_token;
    return this.token;
  }

  private async authHeaders() {
    return { authorization: `Bearer ${await this.accessToken()}` };
  }

  async fetchUnread(limit: number): Promise<FetchedMail[]> {
    const list = await httpJson<{ value: Array<{ id: string }> }>(
      this.fetchImpl,
      `${this.base}/mailFolders/inbox/messages?$filter=isRead%20eq%20false&$select=id&$top=${limit}`,
      { headers: await this.authHeaders() },
    );
    const result: FetchedMail[] = [];
    for (const { id } of list.value) {
      const res = await this.fetchImpl(`${this.base}/messages/${encodeURIComponent(id)}/$value`, {
        headers: await this.authHeaders(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} graph.microsoft.com: message ${id}`);
      result.push({ id, raw: Buffer.from(await res.arrayBuffer()) });
    }
    return result;
  }

  async markProcessed(id: string): Promise<void> {
    await httpJson(this.fetchImpl, `${this.base}/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...(await this.authHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    });
  }

  async close(): Promise<void> {
    this.token = null;
  }
}

// ==================== Gmail ====================

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class GmailSource implements MailSource {
  private token: string | null = null;
  private static readonly base = 'https://gmail.googleapis.com/gmail/v1/users/me';

  constructor(private readonly config: GmailConfig, private readonly fetchImpl: FetchLike = fetch) {}

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const data = await httpJson<{ access_token: string }>(this.fetchImpl, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    this.token = data.access_token;
    return this.token;
  }

  private async authHeaders() {
    return { authorization: `Bearer ${await this.accessToken()}` };
  }

  async fetchUnread(limit: number): Promise<FetchedMail[]> {
    const q = encodeURIComponent('in:inbox is:unread');
    const list = await httpJson<{ messages?: Array<{ id: string }> }>(
      this.fetchImpl,
      `${GmailSource.base}/messages?q=${q}&maxResults=${limit}`,
      { headers: await this.authHeaders() },
    );
    const result: FetchedMail[] = [];
    for (const { id } of list.messages ?? []) {
      const msg = await httpJson<{ raw: string }>(
        this.fetchImpl,
        `${GmailSource.base}/messages/${encodeURIComponent(id)}?format=raw`,
        { headers: await this.authHeaders() },
      );
      result.push({ id, raw: Buffer.from(msg.raw, 'base64url') });
    }
    return result;
  }

  async markProcessed(id: string): Promise<void> {
    await httpJson(this.fetchImpl, `${GmailSource.base}/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      headers: { ...(await this.authHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    });
  }

  async close(): Promise<void> {
    this.token = null;
  }
}

/** Gmail OAuth onay ekranı adresi. `prompt=consent` → her seferinde refresh token döner. */
export function googleAuthorizeUrl(clientId: string, redirectUri: string, state: string, loginHint: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    login_hint: loginHint,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  config: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const data = await httpJson<{ refresh_token?: string }>(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code: config.code,
      grant_type: 'authorization_code',
    }),
  });
  if (!data.refresh_token) throw new Error('Google refresh token dönmedi');
  return data.refresh_token;
}
