// defineConfig vitest/config'ten gelmeli — vite'ınki `test` alanını tanımaz.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Frontend test yapılandırması.
 *
 * Frontend'de hiç test runner'ı yoktu — bir React SPA'da bu, sessiz bayat-state
 * ve render bug'larının hiçbir şey tarafından yakalanmaması demek.
 *
 * Odak: SAF MANTIK ve GÜVENLİK KARARLARI. Sayfaların tamamını render etmek
 * (TanStack Query + router + zustand mock'lamak) bakım maliyeti yüksek ve kırılgan
 * testler üretir; asıl değer kuralların doğruluğundadır.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
