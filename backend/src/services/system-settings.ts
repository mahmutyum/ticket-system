import type { PrismaClient } from '@prisma/client';
import { authSettingsSchema, type AuthSettings } from './sso/config.js';

/** `system_settings.auth` — bozuk/eksik değer varsayılanlara iner. */
export async function getAuthSettings(prisma: Pick<PrismaClient, 'systemSetting'>): Promise<AuthSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'auth' } });
  const parsed = authSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : authSettingsSchema.parse({});
}
