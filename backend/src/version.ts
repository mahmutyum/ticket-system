import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// API sürümü tek doğruluk kaynağı olarak backend/package.json'dan okunur.
// Geliştirmede src/, derlemede dist/ altında yaşadığımız için dosya her iki
// düzende de bir üst dizindeki package.json'a işaret eder; rootDir dışına
// import yapmadan (TS6059) sürüme ulaşmanın güvenli yolu budur.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

export const API_VERSION: string = pkg.version;
