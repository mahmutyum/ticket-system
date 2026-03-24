import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    staffUser?: JwtPayload;
  }
}

const authPluginFn: FastifyPluginAsync = async (app) => {
  // Verify JWT from Authorization header or cookie
  const extractToken = (request: FastifyRequest): string | null => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return request.cookies?.access_token || null;
  };

  const verifyToken = (token: string): JwtPayload => {
    return jwt.verify(token, config.JWT_SECRET) as JwtPayload;
  };

  // Required authentication
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send({ success: false, error: 'Yetkilendirme gerekli' });
    }
    try {
      request.staffUser = verifyToken(token);
    } catch {
      return reply.status(401).send({ success: false, error: 'Geçersiz veya süresi dolmuş token' });
    }
  });

  // Optional authentication (doesn't fail if no token)
  app.decorate('authenticateOptional', async (request: FastifyRequest) => {
    const token = extractToken(request);
    if (token) {
      try {
        request.staffUser = verifyToken(token);
      } catch {
        // Ignore invalid tokens for optional auth
      }
    }
  });

  // Role-based authorization
  app.decorate('requireRole', (...roles: string[]) => {
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

// Helper to generate tokens
export function generateTokens(payload: JwtPayload) {
  const accessToken = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_EXPIRY,
  });
  const refreshToken = jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.REFRESH_TOKEN_EXPIRY,
  });
  return { accessToken, refreshToken };
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as JwtPayload;
}
