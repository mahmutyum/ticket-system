import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import type { StringValue } from 'ms';
import type { StaffRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import { config } from '../config/index.js';

/** Token türü — access ve refresh AYRIMI bu claim'e dayanır, secret'a değil. */
export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  id: string;
  email: string;
  role: StaffRole;
  /**
   * Token türü.
   *
   * Önceden access ve refresh payload'ları BİREBİR aynıydı ve ayrım yalnızca
   * farklı secret kullanılmasına dayanıyordu — bu da zorlanmıyordu. Operatör
   * JWT_SECRET ile JWT_REFRESH_SECRET'i aynı verirse (tek bir kopyala-yapıştır)
   * 7 günlük refresh cookie'si geçerli bir access token'a dönüşürdü. Artık tür
   * doğrulamada açıkça kontrol edilir; secret'ların farklılığı ikinci katmandır
   * (config'te `.refine` ile de zorlanır).
   */
  type: TokenType;
  /**
   * Oturum kimliği. Refresh anahtarı `refresh:<staffId>:<sid>` biçimindedir,
   * böylece aynı kullanıcı birden fazla cihazda oturum açabilir ve birinden
   * çıkmak diğerini düşürmez.
   */
  sid: string;
  /** jsonwebtoken tarafından eklenir (saniye). */
  iat?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: StaffRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    staffUser?: JwtPayload;
  }
}

/** Redis: bu andan ÖNCE üretilmiş access token'lar geçersizdir (saniye). */
const invalidatedKey = (staffId: string) => `staff:invalidated:${staffId}`;

/** Redis: bir oturumun refresh token'ı. */
export const refreshKey = (staffId: string, sid: string) => `refresh:${staffId}:${sid}`;

/**
 * Bir personelin TÜM access token'larını geçersiz kılar.
 *
 * `authenticate` JWT'yi saf doğrulamayla kabul ediyordu ve DB'ye bakmıyordu:
 * rolü düşürülen bir kullanıcı access token'ı dolana kadar (15 dk) eski rolüyle
 * çalışmaya devam ediyordu. Her istekte DB okumak yerine burada bir "geçersizlik
 * anı" tutulur ve `authenticate` tek bir Redis GET ile token'ın tazeliğini
 * ölçer.
 *
 * Rol değişiminde çağrıldığında: access token ölür → istemci otomatik refresh
 * yapar → refresh rolü DB'den yeniden okur → kullanıcı kesintisiz devam eder,
 * ama YENİ rolüyle.
 */
export async function invalidateAccessTokens(redis: Redis, staffId: string): Promise<void> {
  // TTL, en uzun access token ömründen uzun olmalı; 1 gün fazlasıyla yeter.
  await redis.set(invalidatedKey(staffId), String(Math.floor(Date.now() / 1000)), 'EX', 24 * 60 * 60);
}

const authPluginFn: FastifyPluginAsync = async (app) => {
  // Verify JWT from Authorization header
  //
  // Cookie fallback KALDIRILDI. Frontend token'ı yalnızca Authorization
  // header'ıyla gönderir (api/client.ts); `access_token` cookie'sini ne
  // frontend ne backend set eder. Fallback ölü koddu ama ambient credential
  // kapısı açık bırakıyordu: o cookie bir gün herhangi bir yolla tarayıcıya
  // düşerse (subdomain, MITM, "kolaylık" commit'i) CSRF token'ı olmayan tüm
  // durum değiştiren uçlar CSRF'e açılırdı.
  const extractToken = (request: FastifyRequest): string | null => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  };

  const verifyAccessToken = (token: string): JwtPayload => {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    if (payload.type !== 'access') {
      throw new Error('Bu uç nokta access token bekler');
    }
    return payload;
  };

  /** Token, sahibinin geçersizlik anından sonra mı üretilmiş? */
  const isFresh = async (payload: JwtPayload): Promise<boolean> => {
    const raw = await app.redis.get(invalidatedKey(payload.id));
    if (!raw) return true;
    const invalidatedAt = Number(raw);
    if (!Number.isFinite(invalidatedAt)) return true;
    return (payload.iat ?? 0) >= invalidatedAt;
  };

  // Required authentication
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send({ success: false, error: 'Yetkilendirme gerekli' });
    }
    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return reply.status(401).send({ success: false, error: 'Geçersiz veya süresi dolmuş token' });
    }
    if (!(await isFresh(payload))) {
      // Rol/durum değişmiş — istemci refresh yapıp taze bir token alacak.
      return reply.status(401).send({ success: false, error: 'Oturum yenilenmeli' });
    }
    request.staffUser = payload;
  });

  // Optional authentication (doesn't fail if no token)
  app.decorate('authenticateOptional', async (request: FastifyRequest) => {
    const token = extractToken(request);
    if (!token) return;
    try {
      const payload = verifyAccessToken(token);
      if (await isFresh(payload)) {
        request.staffUser = payload;
      }
    } catch {
      // Ignore invalid tokens for optional auth
    }
  });

  // Role-based authorization
  app.decorate('requireRole', (...roles: StaffRole[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      if (reply.sent) return;

      if (!request.staffUser || !roles.includes(request.staffUser.role)) {
        return reply.status(403).send({ success: false, error: 'Bu işlem için yetkiniz yok' });
      }
    };
  });
};

export const authPlugin = fp(authPluginFn, {
  name: 'auth',
});

/** Yeni bir oturum kimliği. */
export function newSessionId(): string {
  return nanoid(16);
}

/** Access + refresh token çifti üretir. */
export function generateTokens(
  payload: { id: string; email: string; role: StaffRole },
  sid: string,
) {
  const accessToken = jwt.sign({ ...payload, type: 'access', sid }, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_EXPIRY as StringValue,
  });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh', sid }, config.JWT_REFRESH_SECRET, {
    expiresIn: config.REFRESH_TOKEN_EXPIRY as StringValue,
  });
  return { accessToken, refreshToken };
}

export function verifyRefreshToken(token: string): JwtPayload {
  const payload = jwt.verify(token, config.JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
  }) as JwtPayload;
  if (payload.type !== 'refresh') {
    throw new Error('Refresh token bekleniyordu');
  }
  return payload;
}
