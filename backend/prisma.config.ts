import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 CLI artık .env dosyalarını otomatik yüklemez: repo kökündeki .env
// burada elle yüklenir. Gerçek env değişkenleri (CI, Docker compose env_file)
// dotenv tarafından EZİLMEZ — dosya yalnızca lokal geliştirme için bir düşüş.
dotenvConfig({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });

export default defineConfig({
  schema: path.resolve(import.meta.dirname, 'prisma/schema.prisma'),
  migrations: {
    path: path.resolve(import.meta.dirname, 'prisma/migrations'),
    seed: 'npx tsx prisma/seed.ts',
  },
  // `migrate deploy` / `migrate diff` gibi komutların veritabanı bağlantısı.
  // GETTER ŞART: `env()` config YÜKLENİRKEN çözülür ve `prisma generate`
  // gibi DB gerektirmeyen komutlarda (ör. Docker builder stage'inde
  // DATABASE_URL yokken) PrismaConfigEnvError ile patlar.
  datasource: {
    get url() {
      return process.env.DATABASE_URL ?? '';
    },
  },
});
