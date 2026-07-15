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

  /**
   * Kaç reverse proxy hop'una güvenilecek. Rate limiting'in TAMAMI buna bağlıdır.
   *
   * Daha önce kodda sabit `trustProxy: true` vardı: bu, X-Forwarded-For zincirinin
   * TAMAMINA güven demektir ve `request.ip` zincirin EN SOLUNU alır — yani
   * istemcinin gönderdiği değeri. nginx `$proxy_add_x_forwarded_for` ile
   * istemcininkine EKLEDİĞİ için sahte giriş hayatta kalıyordu. Sonuç: saldırgan
   * her istekte `X-Forwarded-For: <rastgele>` gönderip her seferinde taze bir
   * rate-limit kovası alıyordu — login 5/dk dahil TÜM limitler geçersizdi
   * (lockout da olmadığı için sessiz sınırsız brute force). Ters yönde de
   * kullanılabiliyordu: kurbanın IP'siyle kovayı doldurup onu kilitlemek.
   *
   * Doğru değer topolojiye bağlıdır — backend'e en yakından sayılır:
   *   1 → yalnızca frontend nginx var (dahili proxy profili veya doğrudan)
   *   2 → NPM/Coolify + frontend nginx (varsayılan production topolojisi)
   *
   * Fazla vermek tehlikelidir (istemcinin uydurduğu IP'ye güvenilir), az vermek
   * yalnızca hassasiyeti düşürür (herkes proxy'nin IP'sinden görünür). Bu yüzden
   * güvenli tarafa, 1'e varsayılıyor.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
})
  /**
   * Access ve refresh secret'ları FARKLI olmalı.
   *
   * Token türü artık JWT'de `type` claim'i ile zorlanıyor, ama secret ayrımı
   * ikinci savunma katmanıdır ve şimdiye kadar yalnızca .env.example'da bir
   * yorum olarak "isteniyordu". Tek bir kopyala-yapıştır ikisini eşitleyebilir
   * ve bunu hiçbir şey uyarmazdı.
   */
  .refine((d) => d.JWT_SECRET !== d.JWT_REFRESH_SECRET, {
    message: 'JWT_SECRET ve JWT_REFRESH_SECRET birbirinden FARKLI olmalı',
    path: ['JWT_REFRESH_SECRET'],
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
