import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Testler gerçek bir DB'ye bağlanmaz — Prisma sahte (stub) nesnelerle verilir.
    // Entegrasyon testleri eklenirse burada ayrı bir proje/setup tanımlanmalı.
    globals: false,
  },
});
