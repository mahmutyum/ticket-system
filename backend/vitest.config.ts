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
  },
});
