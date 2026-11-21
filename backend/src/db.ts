import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config/index.js';

// Prisma 7: Rust query engine kaldırıldı — bağlantı pg driver adapter'ı üzerinden
// kurulur. (prisma/ altındaki script'ler config modülünün TAM env doğrulamasına
// girmemek için kendi adapter'ını kurar; buradaki fabrika yalnızca uygulama içindir.)
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
});
