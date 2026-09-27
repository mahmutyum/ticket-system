import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { buildTrustProxy, isInternalAddress } from '../../src/utils/trust-proxy.js';

/** Gerçek Fastify request.ip hesaplamasıyla — rate limit ve denetim kaydı buna dayanır. */
async function ipFor(setting: string, remoteAddress: string, xff?: string) {
  const app = Fastify({ trustProxy: buildTrustProxy(setting) });
  app.get('/', async (request) => ({ ip: request.ip }));
  const res = await app.inject({ method: 'GET', url: '/', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} });
  await app.close();
  return res.json().ip as string;
}

describe('TRUST_PROXY', () => {
  it('2 hop (NPM + frontend nginx): gerçek istemci IP\'si alınır', async () => {
    expect(await ipFor('2', '172.18.0.5', '1.2.3.4, 10.0.0.9')).toBe('1.2.3.4');
  });

  it('istemcinin uydurduğu fazladan XFF girdisi yok sayılır', async () => {
    expect(await ipFor('2', '172.18.0.5', '6.6.6.6, 1.2.3.4, 10.0.0.9')).toBe('1.2.3.4');
  });

  it('doğrudan bağlanan public istemci proxy sayılmaz (Fastify 5.12 güvenlik düzeltmesinin gerekçesi)', async () => {
    expect(await ipFor('2', '8.8.8.8', '1.1.1.1')).toBe('8.8.8.8');
  });

  it('0 → hiçbir proxy\'ye güvenilmez', async () => {
    expect(await ipFor('0', '172.18.0.5', '1.2.3.4')).toBe('172.18.0.5');
  });

  it('CIDR listesi olduğu gibi uygulanır', async () => {
    expect(await ipFor('172.18.0.0/16', '172.18.0.5', '1.2.3.4')).toBe('1.2.3.4');
    expect(await ipFor('172.18.0.0/16', '10.0.0.5', '1.2.3.4')).toBe('10.0.0.5');
  });

  it('iç adres tespiti', () => {
    expect(isInternalAddress('127.0.0.1')).toBe(true);
    expect(isInternalAddress('::ffff:10.1.2.3')).toBe(true);
    expect(isInternalAddress('192.168.1.1')).toBe(true);
    expect(isInternalAddress('8.8.8.8')).toBe(false);
  });
});
