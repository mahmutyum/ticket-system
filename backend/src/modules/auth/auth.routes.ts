import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import type Redis from 'ioredis';
import { staffLoginSchema, emailLookupSchema, refreshTokenSchema, changePasswordSchema } from './auth.schema.js';
import {
  generateTokens,
  verifyRefreshToken,
  newSessionId,
  refreshKey,
  invalidateAccessTokens,
} from '../../plugins/auth.js';
import { config } from '../../config/index.js';
import { createAuditLog } from '../../middleware/audit.js';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Hesap kilitleme.
 *
 * Rate limit IP başınadır ve `TRUST_PROXY` doğru ayarlansa bile birden fazla
 * IP'den gelen dağıtık bir denemeyi durdurmaz. Kilit HESAP başınadır: parola
 * denemesi kime yapılıyorsa onu korur. bcrypt cost 12 tek başına bir önlem
 * değildir — saldırganın deneme sayısı sınırsızsa yalnızca yavaşlatır.
 */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 15 * 60;
const failKey = (email: string) => `login:fail:${email}`;

async function sessionKeys(redis: Redis, staffId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', `refresh:${staffId}:*`, 'COUNT', 100);
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0');
  return keys;
}

/**
 * Kullanıcı sayımı (enumeration) için sabit maliyetli sahte hash.
 *
 * `bcrypt.compare` yalnızca kullanıcı VARSA çalıştırılırsa, olmayan bir e-posta
 * ~1 DB turunda, var olan bir e-posta ~250 ms'de (bcrypt cost 12) yanıt döner —
 * ölçülebilir bir sayım oracle'ı. Kullanıcı bulunamadığında da aynı işi yapmak
 * bu farkı kapatır. Değer önemsiz; yalnızca geçerli bir bcrypt hash olması yeter.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7iHW7hVQZ2Nl3xkZL8XxJvGqZ0hqZ0G';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Staff login
  app.post('/staff/login', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const body = staffLoginSchema.parse(request.body);
    const ip = (request.headers['x-real-ip'] as string) || request.ip;

    // Hesap kilitli mi?
    const fails = Number((await app.redis.get(failKey(body.email))) ?? 0);
    if (fails >= MAX_FAILED_LOGINS) {
      return reply.status(429).send({
        success: false,
        error: 'Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi, birazdan tekrar deneyin.',
      });
    }

    const staff = await app.prisma.staff.findUnique({
      where: { email: body.email },
    });

    // Kullanıcı yoksa da bcrypt çalıştır — yanıt süresi ayırt edici olmasın.
    const hash = staff?.passwordHash ?? DUMMY_HASH;
    const validPassword = await bcrypt.compare(body.password, hash);

    if (!staff || !staff.isActive || !validPassword) {
      const count = await app.redis.incr(failKey(body.email));
      if (count === 1) {
        await app.redis.expire(failKey(body.email), LOCKOUT_SECONDS);
      }

      // Başarısız giriş DENETİM KAYDINA yazılır — önceden hiçbir iz kalmıyordu,
      // yani bir brute force denemesi tamamen sessizdi.
      await createAuditLog({
        entityType: 'auth',
        entityId: body.email,
        action: 'login_failed',
        changes: {
          attempt: count,
          reason: !staff ? 'unknown_email' : !staff.isActive ? 'inactive' : 'bad_password',
        },
        performedBy: body.email,
        ipAddress: ip,
      });

      return reply.status(401).send({ success: false, error: 'Geçersiz email veya şifre' });
    }

    await app.redis.del(failKey(body.email));

    // Her giriş yeni bir OTURUM açar. Anahtar refresh:<staffId>:<sid> olduğu için
    // aynı kullanıcı laptop + telefonda eşzamanlı oturum tutabilir; önceden tek
    // anahtar vardı ve B'de giriş A'yı sessizce düşürüyordu.
    const sid = newSessionId();
    const tokens = generateTokens({ id: staff.id, email: staff.email, role: staff.role }, sid);

    await app.redis.set(refreshKey(staff.id, sid), tokens.refreshToken, 'EX', REFRESH_TTL_SECONDS);

    reply
      .setCookie('refresh_token', tokens.refreshToken, {
        httpOnly: true,
        // config.NODE_ENV kullanılır: ham process.env okunursa zod'un doğruladığı
        // enum baypas edilir ve NODE_ENV tanımsız/yanlış yazılmışsa cookie
        // Secure'suz gider.
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: REFRESH_TTL_SECONDS,
      })
      .send({
        success: true,
        data: {
          accessToken: tokens.accessToken,
          user: {
            id: staff.id,
            email: staff.email,
            fullName: staff.fullName,
            role: staff.role,
            department: staff.department,
            avatarUrl: staff.avatarUrl,
          },
        },
      });
  });

  // Refresh token
  app.post('/staff/refresh', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const bodyToken = refreshTokenSchema.safeParse(request.body);
    const token = request.cookies?.refresh_token ||
      (bodyToken.success ? bodyToken.data.refreshToken : undefined);

    if (!token) {
      return reply.status(401).send({ success: false, error: 'Refresh token gerekli' });
    }

    try {
      // verifyRefreshToken artık `type: 'refresh'` claim'ini de zorlar — bir
      // access token buraya getirilirse reddedilir (ve tersi).
      const payload = verifyRefreshToken(token);

      // Bu OTURUMUN saklı token'ı ile eşleşmeli.
      const storedToken = await app.redis.get(refreshKey(payload.id, payload.sid));
      if (storedToken !== token) {
        return reply.status(401).send({ success: false, error: 'Geçersiz refresh token' });
      }

      const staff = await app.prisma.staff.findUnique({
        where: { id: payload.id },
      });

      if (!staff || !staff.isActive) {
        return reply.status(401).send({ success: false, error: 'Hesap aktif değil' });
      }

      // Rol DB'den YENİDEN okunur. Rol değiştiğinde access token'lar
      // geçersizleştirilir; istemci buraya düşer ve GÜNCEL rolüyle devam eder.
      const tokens = generateTokens(
        { id: staff.id, email: staff.email, role: staff.role },
        payload.sid,
      );

      // Rotasyon: eski refresh token bu andan itibaren geçersiz.
      await app.redis.set(refreshKey(staff.id, payload.sid), tokens.refreshToken, 'EX', REFRESH_TTL_SECONDS);

      reply
        .setCookie('refresh_token', tokens.refreshToken, {
          httpOnly: true,
          secure: config.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: REFRESH_TTL_SECONDS,
        })
        .send({
          success: true,
          data: { accessToken: tokens.accessToken },
        });
    } catch {
      return reply.status(401).send({ success: false, error: 'Geçersiz refresh token' });
    }
  });

  // Staff logout — YALNIZCA bu oturumu kapatır, diğer cihazlar etkilenmez.
  app.post('/staff/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, sid } = request.staffUser!;
    await app.redis.del(refreshKey(id, sid));
    reply
      .clearCookie('refresh_token', { path: '/' })
      .send({ success: true });
  });

  app.get('/staff/sessions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, sid } = request.staffUser!;
    const keys = await sessionKeys(app.redis, id);
    const sessions = await Promise.all(keys.map(async (key) => ({
      sid: key.slice(key.lastIndexOf(':') + 1),
      current: key.endsWith(`:${sid}`),
      expiresInSeconds: await app.redis.ttl(key),
    })));
    reply.send({ success: true, data: sessions });
  });

  app.delete('/staff/sessions/others', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, sid } = request.staffUser!;
    const keys = (await sessionKeys(app.redis, id)).filter((key) => !key.endsWith(`:${sid}`));
    if (keys.length > 0) await app.redis.del(...keys);
    await createAuditLog({
      entityType: 'auth', entityId: id, action: 'sessions_revoked',
      changes: { count: keys.length }, performedBy: request.staffUser!.email,
      ipAddress: (request.headers['x-real-ip'] as string) || request.ip,
    });
    reply.send({ success: true, data: { revoked: keys.length } });
  });

  app.post('/staff/change-password', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const staff = await app.prisma.staff.findUnique({ where: { id: request.staffUser!.id } });
    if (!staff || !(await bcrypt.compare(body.currentPassword, staff.passwordHash))) {
      return reply.status(400).send({ success: false, error: 'Mevcut şifre yanlış' });
    }
    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await app.prisma.staff.update({ where: { id: staff.id }, data: { passwordHash } });
    const keys = await sessionKeys(app.redis, staff.id);
    if (keys.length > 0) await app.redis.del(...keys);
    await invalidateAccessTokens(app.redis, staff.id);
    await createAuditLog({
      entityType: 'auth', entityId: staff.id, action: 'password_changed',
      performedBy: staff.email,
      ipAddress: (request.headers['x-real-ip'] as string) || request.ip,
    });
    reply.clearCookie('refresh_token', { path: '/' }).send({ success: true });
  });

  /**
   * Kullanıcı bilgisi sorgulama — KİMLİK DOĞRULAMASI GEREKİR.
   *
   * Önceden kimliksizdi ve herhangi bir e-posta için `{id, email, fullName,
   * companyId}` döndürüyordu: bir e-posta sayım + PII oracle'ı. `ad.soyad@firma.com`
   * sözlüğüyle kimin nerede çalıştığı toplanabiliyor, ticket numaraları da sıralı
   * olduğu için `/public/track` ile zincirlenip accessToken hasadına kadar
   * gidiyordu.
   *
   * NOT: Bu uç, public ticket formundaki "önceki bilgilerini getir" kolaylığını
   * besliyordu ve o özellik bilinçli olarak KALDIRILDI — talep eden adını bir kez
   * yazar. Kimliği doğrulanmamış bir çağırana başkasının PII'sini döndürmenin
   * güvenli bir yolu yok.
   */
  app.post('/lookup', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const body = emailLookupSchema.parse(request.body);

    const user = await app.prisma.user.findUnique({
      where: { email: body.email },
      select: {
        id: true,
        email: true,
        fullName: true,
        companyId: true,
      },
    });

    reply.send({
      success: true,
      data: user,
    });
  });
};
