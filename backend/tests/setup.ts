/**
 * Test ortam değişkenleri.
 *
 * `src/config/index.ts` açılışta Zod ile doğrular ve eksik değerde
 * `process.exit(1)` yapar — bu yüzden config'i import eden HERHANGİ bir modül
 * yüklenmeden önce bu değerlerin var olması gerekir. `vitest.config.ts`
 * `setupFiles` ile burayı en başta çalıştırır.
 *
 * Değerler sahtedir; testler gerçek bir DB/Redis/SMTP'ye bağlanmaz.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.REDIS_PASSWORD = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_characters_long';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_at_least_32_chars_long';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.SMTP_FROM = 'Test <test@test.local>';
process.env.APP_URL = 'http://localhost:1111';
process.env.CREDENTIALS_ENC_KEY = '0'.repeat(64);
