import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INPUT_LIMITS } from '../src/types';

/**
 * Frontend `INPUT_LIMITS` ile backend `LIMITS` HİZALI olmalı.
 *
 * İkisi ayrı paketler ve aralarında derleyici bağı yok. Ayrışırlarsa hata sessiz
 * ve kötüdür: kullanıcı forma yazar, gönderir ve sunucudan 400 alır — uyarı
 * alanın yanında değil, ağ katmanında çıkar.
 *
 * Bu test backend dosyasını METİN olarak okur (import edemez: ayrı tsconfig,
 * ayrı node_modules) ve sayıları karşılaştırır. Kaba ama işe yarar — asıl amaç
 * birini değiştirip diğerini unutmayı yakalamak.
 */

const BACKEND_VALIDATION = join(__dirname, '../../backend/src/utils/validation.ts');

/** Backend LIMITS bloğunu ayrıştırır: `key: { min?: n, max: n }` */
function parseBackendLimits(): Record<string, { min?: number; max: number }> {
  const src = readFileSync(BACKEND_VALIDATION, 'utf8');
  const block = /export const LIMITS = \{([\s\S]*?)\n\} as const;/.exec(src);
  if (!block) throw new Error('backend LIMITS bloğu bulunamadı — dosya yapısı değişti mi?');

  const out: Record<string, { min?: number; max: number }> = {};
  const entry = /(\w+):\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(block[1])) !== null) {
    const [, key, body] = m;
    const min = /min:\s*(\d+)/.exec(body);
    const max = /max:\s*(\d+)/.exec(body);
    if (!max) continue;
    out[key] = { ...(min ? { min: Number(min[1]) } : {}), max: Number(max[1]) };
  }
  return out;
}

/** Frontend adı → backend adı (birebir aynı değiller). */
const NAME_MAP: Record<keyof typeof INPUT_LIMITS, string> = {
  subject: 'ticketSubject',
  description: 'ticketDescription',
  noteContent: 'noteContent',
  customFieldValue: 'customFieldValue',
  fullName: 'fullName',
  shortLabel: 'shortLabel',
  taskTitle: 'taskTitle',
  taskDescription: 'taskDescription',
  taskComment: 'taskComment',
  notes: 'notes',
};

describe('INPUT_LIMITS ↔ backend LIMITS', () => {
  const backend = parseBackendLimits();

  it('backend LIMITS okunabiliyor', () => {
    expect(Object.keys(backend).length).toBeGreaterThan(5);
  });

  for (const [feKey, beKey] of Object.entries(NAME_MAP)) {
    it(`${feKey} sınırları backend ile aynı`, () => {
      const fe = INPUT_LIMITS[feKey as keyof typeof INPUT_LIMITS] as {
        min?: number;
        max: number;
      };
      const be = backend[beKey];
      expect(be, `backend'de '${beKey}' yok`).toBeDefined();
      expect(fe.max, `${feKey}.max hizasız`).toBe(be.max);
      expect(fe.min, `${feKey}.min hizasız`).toBe(be.min);
    });
  }
});
