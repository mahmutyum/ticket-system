import { describe, it, expect, vi } from 'vitest';
import { GmailSource, GraphSource, exchangeGoogleCode, googleAuthorizeUrl, type FetchLike } from '../../src/services/mail/sources.js';

/** Sağlayıcı HTTP sözleşmeleri: doğru uç, yetki başlığı, token önbelleği, hata iletimi. */

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Array<[RegExp, () => Response]>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = url instanceof Request ? url.url : url.toString();
    calls.push({ url: u, init });
    const route = routes.find(([re]) => re.test(u));
    if (!route) throw new Error(`unexpected ${u}`);
    return route[1]();
  });
  return { impl: impl as unknown as FetchLike, calls };
}

/** Form gövdeleri URLSearchParams olarak gönderilir. */
const bodyText = (c: Call) => (c.init?.body instanceof URLSearchParams ? c.init.body.toString() : '');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GraphSource (Microsoft 365)', () => {
  const cfg = { tenantId: 'tenant-1', clientId: 'cid', clientSecret: 'sec', address: 'destek@acme.com' };

  it('client credentials ile token alır, okunmamışları ham MIME olarak getirir, okundu işaretler', async () => {
    const { impl, calls } = fakeFetch([
      [/login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/token/, () => json({ access_token: 'AT' })],
      [/\/mailFolders\/inbox\/messages\?/, () => json({ value: [{ id: 'm1' }] })],
      [/\/messages\/m1\/\$value$/, () => new Response('From: a@b.c\r\n\r\nx')],
      [/\/messages\/m1$/, () => new Response(null, { status: 200 })],
    ]);
    const source = new GraphSource(cfg, impl);
    const mails = await source.fetchUnread(10);
    await source.markProcessed('m1');

    expect(mails).toEqual([{ id: 'm1', raw: Buffer.from('From: a@b.c\r\n\r\nx') }]);
    const tokenCall = calls[0];
    expect(bodyText(tokenCall)).toContain('grant_type=client_credentials');
    expect(bodyText(tokenCall)).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
    expect(calls[1].url).toContain('/users/destek%40acme.com/mailFolders/inbox/messages?$filter=isRead%20eq%20false');
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe('Bearer AT');
    // Token bir kez alınır.
    expect(calls.filter(c => c.url.includes('oauth2')).length).toBe(1);
    expect(calls.at(-1)?.init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ isRead: true }) });
  });

  it('sağlayıcı hatasını durum koduyla iletir', async () => {
    const { impl } = fakeFetch([[/oauth2/, () => json({ error: 'invalid_client' }, 401)]]);
    await expect(new GraphSource(cfg, impl).fetchUnread(1)).rejects.toThrow(/HTTP 401 login\.microsoftonline\.com.*invalid_client/);
  });
});

describe('GmailSource', () => {
  const cfg = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'RT' };

  it('refresh token ile erişim alır, raw iletiyi base64url çözer, UNREAD etiketini kaldırır', async () => {
    const raw = 'From: a@b.c\r\nSubject: ü\r\n\r\nx';
    const { impl, calls } = fakeFetch([
      [/oauth2\.googleapis\.com\/token/, () => json({ access_token: 'GT' })],
      [/\/messages\?q=/, () => json({ messages: [{ id: 'g1' }] })],
      [/\/messages\/g1\?format=raw/, () => json({ raw: Buffer.from(raw).toString('base64url') })],
      [/\/messages\/g1\/modify/, () => json({})],
    ]);
    const source = new GmailSource(cfg, impl);
    const mails = await source.fetchUnread(5);
    await source.markProcessed('g1');

    expect(mails[0].raw.toString()).toBe(raw);
    expect(bodyText(calls[0])).toContain('grant_type=refresh_token');
    expect(calls[1].url).toContain(`q=${encodeURIComponent('in:inbox is:unread')}&maxResults=5`);
    expect(calls.at(-1)?.init?.body).toBe(JSON.stringify({ removeLabelIds: ['UNREAD'] }));
  });

  it('ileti yoksa boş liste', async () => {
    const { impl } = fakeFetch([
      [/token/, () => json({ access_token: 'GT' })],
      [/\/messages\?q=/, () => json({ resultSizeEstimate: 0 })],
    ]);
    expect(await new GmailSource(cfg, impl).fetchUnread(5)).toEqual([]);
  });
});

describe('Google OAuth', () => {
  it('onay adresi offline erişim + consent + gmail.modify kapsamı ister', () => {
    const url = new URL(googleAuthorizeUrl('cid', 'https://t.acme.com/api/cb', 'st', 'destek@acme.com'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid', redirect_uri: 'https://t.acme.com/api/cb', response_type: 'code', access_type: 'offline',
      prompt: 'consent', state: 'st', scope: 'https://www.googleapis.com/auth/gmail.modify', login_hint: 'destek@acme.com',
    });
  });

  it('refresh token dönmezse hata verir', async () => {
    const { impl } = fakeFetch([[/token/, () => json({ access_token: 'x' })]]);
    await expect(exchangeGoogleCode({ clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'k' }, impl)).rejects.toThrow('refresh token');
  });
});
