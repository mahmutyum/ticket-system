import { describe, expect, it } from 'vitest';
import { companyPayload, normalizeDomains } from '../src/pages/staff/company-management';

describe('şirket yönetimi veri dönüşümleri', () => {
  it('domainleri normalize eder, boş ve yinelenen değerleri kaldırır', () => {
    expect(normalizeDomains(' Example.COM, test.com, example.com, , TEST.com ')).toEqual([
      'example.com',
      'test.com',
    ]);
  });

  it('form metinlerini API yüküne güvenli biçimde dönüştürür', () => {
    expect(companyPayload({
      name: '  Acme  ',
      groupType: 'corporate',
      allowedDomains: ' ACME.COM ',
      portalDomains: '',
      notificationEmail: ' ',
      primaryColor: ' #2563eb ',
      logo: ' ',
    })).toEqual({
      name: 'Acme',
      groupType: 'corporate',
      allowedDomains: ['acme.com'],
      portalDomains: [],
      notificationEmail: null,
      primaryColor: '#2563eb',
      logo: null,
    });
  });
});
