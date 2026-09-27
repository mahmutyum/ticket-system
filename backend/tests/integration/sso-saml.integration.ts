import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';

/**
 * SAML 2.0 girişi uçtan uca: test, IdP rolünü üstlenip gerçek bir X.509 anahtarıyla
 * imzalı assertion üretir; uygulama gerçek node-saml doğrulaması + Redis InResponseTo
 * önbelleğiyle işler.
 */

let app: FastifyInstance;
let prisma: PrismaClient;
let adminToken: string;
let keyPem: string;
let certPem: string;
let tmp: string;
const slug = `saml-${Date.now().toString(36)}`;
const email = `saml-user-${Date.now()}@example.com`;
const acsUrl = `http://localhost:1111/api/auth/sso/${slug}/acs`;
const spEntityId = `http://localhost:1111/api/auth/sso/${slug}/metadata`;
const idpEntityId = 'https://idp.example.com/saml';

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'saml-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test-idp',
    '-keyout', join(tmp, 'key.pem'), '-out', join(tmp, 'cert.pem'),
  ], { stdio: 'ignore' });
  keyPem = readFileSync(join(tmp, 'key.pem'), 'utf8');
  certPem = readFileSync(join(tmp, 'cert.pem'), 'utf8');

  const module = await import('../../src/app.js');
  app = await module.buildApp();
  await app.ready();
  prisma = (await import('../../src/db.js')).prisma;
  adminToken = (await app.inject({ method: 'POST', url: '/auth/staff/login', payload: { email: 'admin@company.com', password: 'admin123' } })).json().data.accessToken;

  const res = await app.inject({
    method: 'POST', url: '/auth/sso/admin/providers', headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      slug, name: 'Test SAML', type: 'saml', jitProvisioning: true,
      config: { entryPoint: 'https://idp.example.com/sso', idpCert: certPem },
      roleMappings: [{ group: 'IT', role: 'it_manager' }],
    },
  });
  expect(res.statusCode, res.body).toBe(200);
});

afterAll(async () => {
  await prisma.identityProvider.deleteMany({ where: { slug } });
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** /start'ın ürettiği AuthnRequest'in ID'si (InResponseTo için). */
async function startRequestId(): Promise<string> {
  const start = await app.inject({ method: 'GET', url: `/auth/sso/${slug}/start` });
  expect(start.statusCode).toBe(302);
  const samlRequest = new URL(start.headers.location as string).searchParams.get('SAMLRequest')!;
  const xml = inflateRawSync(Buffer.from(samlRequest, 'base64')).toString();
  return /ID="([^"]+)"/.exec(xml)![1];
}

function signedResponse(inResponseTo: string, groups: string[]): string {
  const now = new Date();
  const later = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const assertionId = `_a${Date.now()}`;
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">`
    + `<saml:Issuer>${idpEntityId}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later}" Recipient="${acsUrl}" InResponseTo="${inResponseTo}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${spEntityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement>`
    + `<saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="displayName"><saml:AttributeValue>SAML Kullanıcı</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="groups">${groups.map(g => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join('')}</saml:Attribute>`
    + `</saml:AttributeStatement></saml:Assertion>`;

  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.addReference({
    xpath: `//*[local-name(.)='Assertion']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(assertion, { location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' } });

  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${Date.now()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${acsUrl}" InResponseTo="${inResponseTo}">`
    + `<saml:Issuer>${idpEntityId}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
    + sig.getSignedXml()
    + `</samlp:Response>`;
  return Buffer.from(response).toString('base64');
}

const postAcs = (samlResponse: string) => app.inject({
  method: 'POST', url: `/auth/sso/${slug}/acs`,
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: 'x' }).toString(),
});

describe('SAML SSO — uçtan uca', () => {
  it('SP metadata yayınlanır', async () => {
    const res = await app.inject({ method: 'GET', url: `/auth/sso/${slug}/metadata` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(acsUrl);
  });

  it('imzalı yanıt kabul edilir, JIT ile hesap açılır ve rol gruptan gelir', async () => {
    const response = signedResponse(await startRequestId(), ['IT']);
    const res = await postAcs(response);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('http://localhost:1111/staff/login?sso=ok');
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email } });
    expect(staff).toMatchObject({ role: 'it_manager', externalSubject: email });

    // Aynı yanıt yeniden oynatılamaz (InResponseTo tek kullanımlık).
    const replay = await postAcs(response);
    expect(replay.headers.location).toContain('sso_error=');
  });

  it('istenmemiş (InResponseTo bilinmeyen) yanıt reddedilir', async () => {
    const res = await postAcs(signedResponse('_forged-request-id', ['IT']));
    expect(res.headers.location).toContain('sso_error=provider_rejected');
  });

  it('imzası bozulmuş yanıt reddedilir', async () => {
    const tampered = Buffer.from(Buffer.from(signedResponse(await startRequestId(), ['IT']), 'base64').toString()
      .replace('<saml:AttributeValue>IT</saml:AttributeValue>', '<saml:AttributeValue>Admins</saml:AttributeValue>')).toString('base64');
    const res = await postAcs(tampered);
    expect(res.headers.location).toContain('sso_error=provider_rejected');
  });
});
