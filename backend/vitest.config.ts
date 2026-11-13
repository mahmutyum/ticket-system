import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // config/index.ts import anında env'i doğrulayıp eksikse process.exit(1)
    // yapar — setup dosyası her şeyden önce çalışıp sahte değerleri koyar.
    setupFiles: ['tests/setup.ts'],
    // Testler gerçek bir DB'ye bağlanmaz — Prisma sahte (stub) nesnelerle verilir.
    // Entegrasyon testleri eklenirse burada ayrı bir proje/setup tanımlanmalı.
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**'],
      reporter: ['text', 'html'],
      // Bu ölçüm YALNIZCA birim testleri kapsar — route/worker kapsamının
      // önemli kısmı gerçek Postgres+Redis isteyen entegrasyon testlerinde
      // (vitest.integration.config.ts) ve o suite bu ölçüme girmez. Eşikler
      // mevcut birim tabanının hemen altındadır: amaç gerilemeyi yakalamak,
      // sayı büyütmek değil. Birim kapsamı büyüdükçe kademeli yükselt.
      thresholds: {
        lines: 50,
        functions: 50,
        statements: 50,
        branches: 40,
      },
    },
  },
});
