import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Staff } from '@prisma/client';
import { config } from '../../config/index.js';
import { generateTokens, newSessionId, refreshKey } from '../../plugins/auth.js';

export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Yanıtta dönen oturum kullanıcısı. */
export function sessionUser(staff: Staff) {
  return {
    id: staff.id,
    email: staff.email,
    fullName: staff.fullName,
    role: staff.role,
    department: staff.department,
    avatarUrl: staff.avatarUrl,
    mfaEnabled: staff.mfaEnabled,
    locale: staff.locale,
  };
}

/**
 * Yeni oturum açar: access + refresh token üretir, refresh'i Redis'e yazar ve
 * httpOnly cookie olarak set eder. Yerel giriş, MFA doğrulaması ve SSO aynı
 * yoldan geçer.
 *
 * Her giriş yeni bir OTURUM açar. Anahtar refresh:<staffId>:<sid> olduğu için
 * aynı kullanıcı laptop + telefonda eşzamanlı oturum tutabilir.
 */
export async function issueSession(app: FastifyInstance, reply: FastifyReply, staff: Staff) {
  const sid = newSessionId();
  const tokens = generateTokens({ id: staff.id, email: staff.email, role: staff.role }, sid);
  await app.redis.set(refreshKey(staff.id, sid), tokens.refreshToken, 'EX', REFRESH_TTL_SECONDS);
  reply.setCookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    // config.NODE_ENV kullanılır: ham process.env okunursa zod'un doğruladığı
    // enum baypas edilir ve NODE_ENV tanımsız/yanlış yazılmışsa cookie
    // Secure'suz gider.
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS,
  });
  return {
    accessToken: tokens.accessToken,
    user: sessionUser(staff),
    mfaWarningEnabled: config.MFA_WARNING_ENABLED,
  };
}
