import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/**
 * ESLint — amaç GERÇEK HATA yakalamak, stil dayatmak değil.
 *
 * En değerli kural burada `react-hooks/exhaustive-deps`: eksik bağımlılık
 * React'te sessiz bayat-state bug'ları üretir ve `tsc` bunu yakalayamaz.
 *
 * `no-explicit-any` uyarı seviyesinde: kod tabanı API yanıtları için bilinçli
 * `any` kullanıyor, hata yapmak katkıyı engellerdi. Biçim kuralları kapalı
 * (`eslint-config-prettier` en sonda) — biçimlendirme Prettier'ın işi.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  prettier,
);
