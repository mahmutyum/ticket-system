import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Sürüm tutarlılığı.
 *
 * Swagger'da yayınlanan API sürümü `src/version.ts` üzerinden
 * `backend/package.json`'dan gelir. Bu testin üç işi var:
 *
 * 1. `API_VERSION` gerçekten package.json sürümünü okuyor mu (duygusal
 *    sabit kalma regresyonu — bir dönem kodda elle yazılmıştı ve geride kaldı).
 * 2. backend ve frontend paket sürümleri aynı mı (release'de ikisi birlikte
 *    yükseltilir; ayrışması docs/rozet tutarsızlığı üretir).
 * 3. README rozetleri paket sürümüyle aynı mı (rozetler release script'iyle
 *    güncellenir: `scripts/update-readme-badges.sh`).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const backendPkg = JSON.parse(readFileSync(join(repoRoot, 'backend', 'package.json'), 'utf-8')) as {
  version: string;
};
const frontendPkg = JSON.parse(
  readFileSync(join(repoRoot, 'frontend', 'package.json'), 'utf-8'),
) as { version: string };

describe('sürüm tutarlılığı', () => {
  it('API_VERSION backend/package.json sürümünü okur', async () => {
    const { API_VERSION } = await import('../../src/version.js');
    expect(API_VERSION).toBe(backendPkg.version);
  });

  it('backend ve frontend sürümleri aynı', () => {
    expect(frontendPkg.version).toBe(backendPkg.version);
  });

  it('README rozetleri paket sürümüyle aynı', () => {
    for (const file of ['README.md', 'README.en.md']) {
      const readme = readFileSync(join(repoRoot, file), 'utf-8');
      expect(readme).toContain(`badge/version-${backendPkg.version}-blue`);
    }
  });
});
