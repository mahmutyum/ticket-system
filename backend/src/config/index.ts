import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  // Redis kimlik doğrulaması REDIS_URL içinde taşınır (redis://:<şifre>@host).
  // REDIS_PASSWORD backend tarafından OKUNMAZ — yalnızca docker-compose redis
  // container'ını `--requirepass` ile başlatırken kullanır. Burada zorunlu
  // tutulması okuyanı "backend bunu kullanıyor" sanmaya itiyordu.
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().transform(v => v === 'true').default('false'),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  SMTP_FROM: z.string(),
  SMS_GATEWAY_URL: z.string().optional(),
  SMS_GATEWAY_API_KEY: z.string().optional(),
  SMS_SENDER: z.string().optional(),
  // Primary canonical URL (tracking link e-postalarında, vs. kullanılır).
  // Birden fazla FQDN destekliyorsan virgülle ayır; ilk değer canonical sayılır,
  // tamamı CORS whitelist'ine eklenir.
  APP_URL: z.string(),
  APP_NAME: z.string().default('IT Destek Sistemi'),
  MAX_FILE_SIZE: z.coerce.number().default(26214400),
  UPLOAD_DIR: z.string().default('/app/uploads'),
  CREDENTIALS_ENC_KEY: z.string().length(64, 'CREDENTIALS_ENC_KEY 64 karakterlik hex olmalı (32 byte)'),
  // Swagger UI (/docs) tüm endpoint listesini yayınlar. İç ağda kabul edilebilir;
  // internete açık bir kurulumda kapatılabilsin diye bayrağa bağlı.
  ENABLE_API_DOCS: z.string().transform((v) => v !== 'false').default('true'),
});

export type Env = z.infer<typeof envSchema>;

export type AppConfig = Env & {
  /** Tüm kabul edilen FQDN origin'leri (CORS whitelist için). */
  APP_ORIGINS: string[];
  /** Canonical URL — e-posta tracking link'lerinde kullanılır. */
  CANONICAL_URL: string;
};

function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  const origins = result.data.APP_URL
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (origins.length === 0) {
    console.error('APP_URL must contain at least one URL');
    process.exit(1);
  }
  return {
    ...result.data,
    APP_ORIGINS: origins,
    CANONICAL_URL: origins[0],
  };
}

export const config = loadConfig();
