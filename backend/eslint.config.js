import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * ESLint — amaç GERÇEK HATA yakalamak, stil dayatmak değil.
 *
 * Kod tabanı tutarlı ama binlerce uyarı üretip herkesin `--no-verify` yazmasına
 * yol açan bir kurulum işe yaramaz. Bu yüzden:
 *  - Biçim kuralları tamamen kapalı (`eslint-config-prettier` en sonda) —
 *    biçimlendirme Prettier'ın işi.
 *  - `no-explicit-any` UYARI: kod tabanında bilinçli `any` kullanımı var
 *    (Prisma where nesneleri), hata yapmak katkıyı engellerdi.
 *  - Kullanılmayan değişkenler `_` önekiyle affedilir.
 *
 * Tip bilgisi gerektiren kurallar (`projectService`) açık: `no-floating-promises`
 * gibi kurallar asenkron kod tabanında gerçek bug yakalar.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.test.json hem src'yi hem tests'i kapsar. Ana tsconfig.json
        // `tests`'i exclude eder (rootDir: src ile derleme yapar), bu yüzden
        // onu kullanırsak ESLint test dosyalarını "projede değil" diye reddeder.
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Kod tabanında bilinçli any var (Prisma where fragment'leri) — engelleme, işaretle.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Gerçek bug yakalar: await unutulmuş promise.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // KAPALI: Fastify handler'ları ve plugin'leri sözleşme gereği async'tir,
      // içlerinde await olmasa bile (`app.get('/health', async () => ...)`).
      // Bu kural burada 30+ meşru kullanımı işaretliyor — sinyal değil gürültü.
      '@typescript-eslint/require-await': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { pass, ...rest } = row` — alan çıkarmak için yaygın ve
          // bilinçli bir desen; kullanılmayan değişken sayılmamalı.
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Testler: stub'lar ve mock'lar tip güvenliğini bilerek esnetir.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  // EN SONDA: Prettier ile çakışan tüm biçim kurallarını kapatır.
  prettier,
);
